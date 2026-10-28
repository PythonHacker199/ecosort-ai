// Picks the storage backend: Postgres when a database URL is configured
// (Vercel + Neon), otherwise a local SQLite file.
function openStore(config) {
  if (config.databaseUrl) {
    return require('./postgres').openPostgresStore(config.databaseUrl);
  }
  return require('./sqlite').openSqliteStore(config.dbPath);
}

function storeName(config) {
  return config.databaseUrl ? 'Postgres (DATABASE_URL)' : `SQLite (${config.dbPath})`;
}

module.exports = { openStore, storeName };
