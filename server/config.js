// Reads settings from environment variables (and an optional .env file)
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

try {
  process.loadEnvFile(path.join(ROOT_DIR, '.env'));
} catch {
  // No .env file - fall back to real environment variables and defaults
}

function resolveDbPath(value) {
  if (!value) return path.join(ROOT_DIR, 'data', 'ecosort.db');
  if (value === ':memory:') return value;
  return path.resolve(ROOT_DIR, value);
}

module.exports = {
  ROOT_DIR,
  port: Number(process.env.PORT) || 3000,
  dbPath: resolveDbPath(process.env.DB_PATH),
  geminiApiKey: (process.env.GEMINI_API_KEY || '').trim(),
  geminiModel: (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim()
};
