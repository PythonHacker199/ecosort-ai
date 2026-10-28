// Values shared by both storage backends
const HISTORY_LIMIT = 50;

// SQLite returns ISO strings, Postgres returns Date objects: normalize both
function toIso(value) {
  return new Date(value).toISOString();
}

module.exports = { HISTORY_LIMIT, toIso };
