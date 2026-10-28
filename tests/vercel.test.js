// Checks the Vercel entry point (api/index.js) boots and serves the API
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

test('api/index.js exports a working request handler', async () => {
  process.env.DB_PATH = ':memory:';
  const handler = require('../api/index.js');
  assert.equal(typeof handler, 'function');

  // Vercel keeps the original URL when it rewrites /api/* to this function
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const health = await fetch(`${base}/api/health`).then(r => r.json());
    assert.equal(health.status, 'ok');
    const search = await fetch(`${base}/api/search?q=banana%20peel`).then(r => r.json());
    assert.equal(search.match.item.binId, 'green');
  } finally {
    server.close();
  }
});

test('vercel.json routes /api/* to the function and serves public/', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  assert.equal(config.outputDirectory, 'public');
  assert.deepEqual(config.rewrites, [{ source: '/api/(.*)', destination: '/api' }]);
});
