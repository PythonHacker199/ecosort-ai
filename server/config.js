// Reads settings from environment variables (and an optional .env file)
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

try {
  process.loadEnvFile(path.join(ROOT_DIR, '.env'));
} catch {
  // No .env file - fall back to real environment variables and defaults
}

function resolveDbPath(value) {
  // On Vercel only /tmp is writable (and it is wiped often); set DATABASE_URL there instead
  if (!value) return process.env.VERCEL ? '/tmp/ecosort.db' : path.join(ROOT_DIR, 'data', 'ecosort.db');
  if (value === ':memory:') return value;
  return path.resolve(ROOT_DIR, value);
}

module.exports = {
  ROOT_DIR,
  port: Number(process.env.PORT) || 3000,
  // Vercel's Neon integration sets DATABASE_URL (older Vercel Postgres used POSTGRES_URL)
  databaseUrl: (process.env.DATABASE_URL || process.env.POSTGRES_URL || '').trim(),
  dbPath: resolveDbPath(process.env.DB_PATH),
  geminiApiKey: (process.env.GEMINI_API_KEY || '').trim(),
  geminiModel: (process.env.GEMINI_MODEL || 'gemini-flash-latest').trim()
};
