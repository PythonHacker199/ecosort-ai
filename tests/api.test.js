// API tests: `npm test`
// Starts the app on a random port with an in-memory database.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../server/db');
const { createApp } = require('../server/app');

const CLIENT = 'test-client-0001';
let server;
let baseUrl;
let repo;
let fakeGeminiCalls = 0;

before(async () => {
  repo = openDatabase(':memory:');
  const app = createApp({
    repo,
    config: { geminiApiKey: 'fake-key', geminiModel: 'fake-model' },
    classifyImage: async ({ mimeType }) => {
      fakeGeminiCalls += 1;
      return { item: { name: 'Glass Jar', binId: 'blue', mimeType }, confidence: 0.9, source: 'gemini' };
    }
  });
  await new Promise(resolve => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  repo.close();
});

async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, body: await res.json() };
}

test('health and config', async () => {
  assert.equal((await api('/api/health')).body.status, 'ok');
  const { body } = await api('/api/config');
  assert.equal(body.geminiEnabled, true);
  assert.equal(body.questionsPerRound, 10);
});

test('bins include item counts', async () => {
  const { body } = await api('/api/bins');
  assert.equal(body.bins.length, 5);
  const blue = body.bins.find(b => b.id === 'blue');
  assert.ok(blue.itemCount > 0);

  const items = await api('/api/bins/blue/items');
  assert.ok(items.body.items.every(it => it.binId === 'blue'));
  assert.equal((await api('/api/bins/purple/items')).status, 404);
  assert.equal((await api('/api/bins/__proto__/items')).status, 404);
});

test('search finds exact, fuzzy and rule-based matches', async () => {
  const exact = await api('/api/search?q=Banana%20Peel');
  assert.equal(exact.body.match.item.id, 'banana-peel');
  assert.equal(exact.body.match.matchType, 'exact');

  const fuzzy = await api('/api/search?q=soda%20can');
  assert.equal(fuzzy.body.match.item.binId, 'blue');

  const rule = await api('/api/search?q=mango%20seed');
  assert.equal(rule.body.match.item.binId, 'green');
  assert.equal(rule.body.match.matchType, 'heuristic');

  const none = await api('/api/search?q=zzzz');
  assert.equal(none.body.match, null);

  assert.equal((await api('/api/search')).status, 400);
});

test('suggest returns up to five items', async () => {
  const { body } = await api('/api/suggest?q=bottle');
  assert.ok(body.suggestions.length > 0 && body.suggestions.length <= 5);
  assert.deepEqual((await api('/api/suggest?q=b')).body.suggestions, []);
});

test('MobileNet labels map onto waste items', async () => {
  const { body } = await api('/api/classify/labels', {
    method: 'POST',
    body: { predictions: [{ className: 'water bottle', probability: 0.8 }, { className: 'banana', probability: 0.1 }] }
  });
  assert.equal(body.result.primary.item.id, 'pet-bottle');
  assert.equal(body.result.alternatives[0].item.id, 'banana-peel');

  const bad = await api('/api/classify/labels', { method: 'POST', body: { predictions: 'nope' } });
  assert.equal(bad.status, 400);
});

test('image upload goes to the configured photo classifier', async () => {
  const form = new FormData();
  form.append('image', new Blob([Buffer.from([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), 'photo.jpg');
  const res = await fetch(`${baseUrl}/api/classify/image`, { method: 'POST', body: form });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.result.item.name, 'Glass Jar');
  assert.equal(fakeGeminiCalls, 1);

  const textForm = new FormData();
  textForm.append('image', new Blob(['hello'], { type: 'text/plain' }), 'notes.txt');
  const rejected = await fetch(`${baseUrl}/api/classify/image`, { method: 'POST', body: textForm });
  assert.equal(rejected.status, 415);
});

test('history is stored per client and can be cleared', async () => {
  const headers = { 'X-Client-Id': CLIENT };

  assert.equal((await api('/api/history')).status, 400);

  const known = await api('/api/history', { method: 'POST', headers, body: { itemId: 'pet-bottle', source: 'search', confidence: 1 } });
  assert.equal(known.status, 201);
  assert.equal(known.body.scan.binId, 'blue');

  const custom = await api('/api/history', {
    method: 'POST',
    headers,
    body: { item: { name: 'Mango Seed', category: 'Organic / Wet Waste', binId: 'green', isCompostable: true }, source: 'heuristic' }
  });
  assert.equal(custom.status, 201);

  const invalid = await api('/api/history', { method: 'POST', headers, body: { item: { name: 'X', category: 'Y', binId: 'pink' } } });
  assert.equal(invalid.status, 400);

  const other = await api('/api/history', { headers: { 'X-Client-Id': 'someone-else-01' } });
  assert.equal(other.body.history.length, 0);

  const mine = await api('/api/history', { headers });
  assert.deepEqual(mine.body.history.map(s => s.name), ['Mango Seed', 'Plastic Water / Soda Bottle (PET #1)']);

  const stats = await api('/api/stats', { headers });
  assert.equal(stats.body.mine.total, 2);
  assert.equal(stats.body.community.byBin.green, 1);

  await api('/api/history', { method: 'DELETE', headers });
  assert.equal((await api('/api/history', { headers })).body.history.length, 0);
});

test('a full quiz round can be played and submitted to the leaderboard', async () => {
  const { QUESTION_POOL } = require('../server/services/quiz');
  const start = await api('/api/quiz', { method: 'POST' });
  assert.equal(start.status, 201);
  const { sessionId, total } = start.body;
  assert.equal(total, 10);

  const early = await api(`/api/quiz/${sessionId}/submit`, { method: 'POST', body: { name: 'Early' } });
  assert.equal(early.status, 409);

  let state = start.body;
  for (let i = 0; i < total; i++) {
    const question = [...QUESTION_POOL.values()].find(q => q.text === state.question.text);
    const res = await api(`/api/quiz/${sessionId}/answer`, { method: 'POST', body: { binId: question.targetBin } });
    assert.equal(res.status, 200);
    assert.equal(res.body.result.isCorrect, true);
    state = res.body.state;
  }
  assert.equal(state.finished, true);
  assert.equal(state.correct, 10);
  // 10 + 15 + 20 + ... + 55 with the streak bonus
  assert.equal(state.score, 325);

  const extra = await api(`/api/quiz/${sessionId}/answer`, { method: 'POST', body: { binId: 'blue' } });
  assert.equal(extra.status, 409);

  const submitted = await api(`/api/quiz/${sessionId}/submit`, { method: 'POST', body: { name: '  Asha  ' } });
  assert.equal(submitted.status, 201);
  assert.equal(submitted.body.rank, 1);

  const again = await api(`/api/quiz/${sessionId}/submit`, { method: 'POST', body: { name: 'Asha' } });
  assert.equal(again.status, 409);

  const board = await api('/api/leaderboard');
  assert.equal(board.body.leaderboard[0].name, 'Asha');
  assert.equal(board.body.leaderboard[0].score, 325);
});

test('unknown API routes and bad JSON return JSON errors', async () => {
  assert.equal((await api('/api/nope')).status, 404);
  const res = await fetch(`${baseUrl}/api/history`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Client-Id': CLIENT },
    body: '{not json'
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'Request body is not valid JSON');
});
