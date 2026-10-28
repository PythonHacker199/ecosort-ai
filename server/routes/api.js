// REST API for EcoSort AI. Every route lives under /api.
const express = require('express');
const multer = require('multer');
const { DUSTBINS, WASTE_ITEMS } = require('../data/wasteData');
const classifier = require('../services/classifier');
const quiz = require('../services/quiz');
const { HISTORY_LIMIT } = require('../db');

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const CLIENT_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

// Lets async route handlers pass errors to the Express error handler
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

// Small fixed-window limiter, enough to stop one visitor burning the Gemini quota
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const entry = hits.get(req.ip);
    if (!entry || now - entry.start > windowMs) {
      hits.set(req.ip, { start: now, count: 1 });
      if (hits.size > 10000) hits.clear();
      return next();
    }
    entry.count += 1;
    if (entry.count > max) return next(httpError(429, 'Too many photo scans. Please wait a minute and try again.'));
    next();
  };
}

// Each browser gets a random anonymous id (stored in its localStorage) so
// history is kept per person without needing accounts.
function requireClient(req, res, next) {
  const clientId = req.get('x-client-id');
  if (!clientId || !CLIENT_ID_PATTERN.test(clientId)) {
    return next(httpError(400, 'Missing or invalid X-Client-Id header'));
  }
  req.clientId = clientId;
  next();
}

function boundedString(value, maxLength) {
  return typeof value === 'string' && value.trim() && value.length <= maxLength ? value.trim() : null;
}

function parseConfidence(value) {
  const n = Number(value);
  return value != null && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null;
}

function binsWithCounts() {
  return Object.values(DUSTBINS).map(bin => ({
    ...bin,
    itemCount: WASTE_ITEMS.filter(it => it.binId === bin.id).length
  }));
}

function createApiRouter({ repo, config, classifyImage }) {
  const router = express.Router();
  const geminiEnabled = Boolean(config.geminiApiKey);

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
    fileFilter: (req, file, cb) => {
      if (ALLOWED_IMAGE_TYPES.has(file.mimetype)) return cb(null, true);
      cb(httpError(415, 'Please upload a JPG, PNG, WEBP or HEIC image.'));
    }
  });

  function uploadImage(req, res, next) {
    upload.single('image')(req, res, err => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') return next(httpError(413, 'Image is too large (max 5 MB).'));
      if (err.status) return next(err);
      next(httpError(400, err.message));
    });
  }

  // ---------- Meta ----------
  router.get('/health', (req, res) => {
    res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
  });

  router.get('/config', (req, res) => {
    res.json({
      geminiEnabled,
      questionsPerRound: quiz.QUESTIONS_PER_ROUND,
      historyLimit: HISTORY_LIMIT
    });
  });

  // ---------- Knowledge base ----------
  router.get('/bins', (req, res) => {
    res.json({ bins: binsWithCounts() });
  });

  router.get('/bins/:binId/items', (req, res, next) => {
    const bin = DUSTBINS[req.params.binId];
    if (!Object.hasOwn(DUSTBINS, req.params.binId)) return next(httpError(404, 'Unknown dustbin'));
    res.json({ bin, items: WASTE_ITEMS.filter(it => it.binId === bin.id) });
  });

  router.get('/items', (req, res) => {
    res.json({ items: WASTE_ITEMS });
  });

  router.get('/items/:id', (req, res, next) => {
    const item = classifier.getItemById(req.params.id);
    if (!item) return next(httpError(404, 'Item not found'));
    res.json({ item });
  });

  // ---------- Search ----------
  router.get('/search', (req, res, next) => {
    const q = boundedString(req.query.q, 100);
    if (!q) return next(httpError(400, 'Query "q" is required (max 100 characters)'));
    const match = classifier.searchWasteByText(q);
    res.json({ query: q, match });
  });

  router.get('/suggest', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 100) : '';
    res.json({ suggestions: classifier.suggestItems(q) });
  });

  // ---------- Image classification ----------
  // The browser runs MobileNet locally and sends us its labels to map onto waste items.
  router.post('/classify/labels', (req, res, next) => {
    const predictions = req.body?.predictions;
    if (!Array.isArray(predictions) || predictions.length === 0 || predictions.length > 10) {
      return next(httpError(400, '"predictions" must be an array of 1-10 items'));
    }
    const clean = [];
    for (const p of predictions) {
      const className = boundedString(p?.className, 200);
      const probability = parseConfidence(p?.probability);
      if (!className || probability === null) {
        return next(httpError(400, 'Each prediction needs a className and a probability'));
      }
      clean.push({ className, probability });
    }
    res.json({ result: classifier.classifyFromLabels(clean) });
  });

  // With GEMINI_API_KEY set, the server sends the photo to Gemini for a richer answer.
  router.post(
    '/classify/image',
    rateLimit({ windowMs: 60_000, max: 15 }),
    uploadImage,
    asyncRoute(async (req, res) => {
      if (!geminiEnabled) throw httpError(503, 'Photo AI is not configured on this server');
      if (!req.file) throw httpError(400, 'Attach an image in the "image" field');

      try {
        const result = await classifyImage({
          imageBuffer: req.file.buffer,
          mimeType: req.file.mimetype,
          apiKey: config.geminiApiKey,
          model: config.geminiModel
        });
        res.json({ result });
      } catch (err) {
        console.warn('[gemini]', err.message);
        throw httpError(502, 'AI photo analysis failed. Falling back to on-device recognition.');
      }
    })
  );

  // ---------- Scan history (per browser) ----------
  router.get('/history', requireClient, (req, res) => {
    res.json({ history: repo.listScans(req.clientId) });
  });

  router.post('/history', requireClient, (req, res, next) => {
    const { itemId, item, source, confidence } = req.body || {};
    const known = typeof itemId === 'string' ? classifier.getItemById(itemId) : null;

    let snapshot;
    if (known) {
      snapshot = { ...known, itemId: known.id };
    } else {
      const name = boundedString(item?.name, 120);
      const category = boundedString(item?.category, 120);
      if (!name || !category || !Object.hasOwn(DUSTBINS, item?.binId)) {
        return next(httpError(400, 'Provide a known "itemId" or an "item" with name, category and binId'));
      }
      snapshot = {
        itemId: null,
        name,
        category,
        binId: item.binId,
        isRecyclable: item.isRecyclable === true,
        isCompostable: item.isCompostable === true
      };
    }

    const scan = repo.addScan(req.clientId, {
      ...snapshot,
      source: boundedString(source, 40) || 'search',
      confidence: parseConfidence(confidence)
    });
    res.status(201).json({ scan });
  });

  router.delete('/history', requireClient, (req, res) => {
    res.json({ deleted: repo.clearScans(req.clientId) });
  });

  router.get('/stats', (req, res) => {
    const clientId = req.get('x-client-id');
    res.json(repo.stats(clientId && CLIENT_ID_PATTERN.test(clientId) ? clientId : null));
  });

  // ---------- Quiz & leaderboard ----------
  router.post('/quiz', (req, res) => {
    res.status(201).json(quiz.startQuiz(repo));
  });

  router.get('/quiz/:sessionId', (req, res) => {
    res.json(quiz.getQuiz(repo, req.params.sessionId));
  });

  router.post('/quiz/:sessionId/answer', (req, res) => {
    res.json(quiz.answerQuestion(repo, req.params.sessionId, req.body?.binId));
  });

  router.post('/quiz/:sessionId/submit', (req, res) => {
    res.status(201).json(quiz.submitScore(repo, req.params.sessionId, req.body?.name));
  });

  router.get('/leaderboard', (req, res) => {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
    res.json({ leaderboard: repo.leaderboard(limit) });
  });

  return router;
}

module.exports = { createApiRouter };
