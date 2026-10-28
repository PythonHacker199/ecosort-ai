// Entry point: `npm start`
const os = require('node:os');
const config = require('./config');
const { openStore, storeName } = require('./store');
const { createApp } = require('./app');

const repo = openStore(config);
const app = createApp({ repo, config });

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(net => net && net.family === 'IPv4' && !net.internal)
    .map(net => net.address);
}

const server = app.listen(config.port, () => {
  console.log('\n  EcoSort AI is running!\n');
  console.log(`  On this computer:   http://localhost:${config.port}`);
  for (const ip of lanAddresses()) {
    console.log(`  On your Wi-Fi:      http://${ip}:${config.port}`);
  }
  console.log(`\n  Database:           ${storeName(config)}`);
  console.log(`  Gemini photo AI:    ${config.geminiApiKey ? `enabled (${config.geminiModel})` : 'off (add GEMINI_API_KEY to .env to enable)'}`);
  console.log('\n  Press Ctrl+C to stop.\n');
});

function shutdown() {
  server.close(() => {
    repo.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
