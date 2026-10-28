// Builds the Express app: JSON API under /api and the website from /public
const path = require('node:path');
const express = require('express');
const { createApiRouter } = require('./routes/api');
const { classifyWithGemini } = require('./services/gemini');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=()'
  });
  next();
}

function createApp({ repo, config, classifyImage = classifyWithGemini }) {
  const app = express();
  app.disable('x-powered-by');
  // Hosting platforms (Render, Railway...) sit behind one proxy; needed for per-IP rate limits
  app.set('trust proxy', 1);
  app.use(securityHeaders);

  app.use('/api', express.json({ limit: '100kb' }), createApiRouter({ repo, config, classifyImage }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found' }));

  app.use(express.static(PUBLIC_DIR));

  // Errors created on purpose carry a status; anything else is an unexpected bug
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode;
    if (!status) {
      console.error(err);
      return res.status(500).json({ error: 'Something went wrong on the server' });
    }
    const message = err.type === 'entity.parse.failed' ? 'Request body is not valid JSON' : err.message;
    res.status(status).json({ error: message });
  });

  return app;
}

module.exports = { createApp };
