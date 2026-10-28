// Vercel serverless entry point. vercel.json routes every /api/* request here;
// the website itself is served as static files from public/.
const config = require('../server/config');
const { openStore } = require('../server/store');
const { createApp } = require('../server/app');

module.exports = createApp({ repo: openStore(config), config });
