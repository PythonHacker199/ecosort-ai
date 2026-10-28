// Postgres storage, used when DATABASE_URL is set (e.g. Neon on Vercel).
// Same methods as the SQLite store. `query(text, params)` must return rows.
const { HISTORY_LIMIT, toIso } = require('./limits');

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS scans (
    id             SERIAL PRIMARY KEY,
    client_id      TEXT        NOT NULL,
    item_id        TEXT,
    name           TEXT        NOT NULL,
    category       TEXT        NOT NULL,
    bin_id         TEXT        NOT NULL,
    is_recyclable  BOOLEAN     NOT NULL,
    is_compostable BOOLEAN     NOT NULL,
    source         TEXT        NOT NULL,
    confidence     REAL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  'CREATE INDEX IF NOT EXISTS idx_scans_client ON scans (client_id, id DESC)',
  `CREATE TABLE IF NOT EXISTS quiz_sessions (
    id             TEXT        PRIMARY KEY,
    question_keys  TEXT        NOT NULL,
    current_index  INTEGER     NOT NULL DEFAULT 0,
    score          INTEGER     NOT NULL DEFAULT 0,
    streak         INTEGER     NOT NULL DEFAULT 0,
    best_streak    INTEGER     NOT NULL DEFAULT 0,
    correct        INTEGER     NOT NULL DEFAULT 0,
    finished       BOOLEAN     NOT NULL DEFAULT false,
    submitted      BOOLEAN     NOT NULL DEFAULT false,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS leaderboard (
    id           SERIAL PRIMARY KEY,
    name         TEXT        NOT NULL,
    score        INTEGER     NOT NULL,
    correct      INTEGER     NOT NULL,
    total        INTEGER     NOT NULL,
    best_streak  INTEGER     NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  'CREATE INDEX IF NOT EXISTS idx_leaderboard_score ON leaderboard (score DESC, id ASC)'
];

function toScan(row) {
  return {
    id: row.id,
    itemId: row.item_id,
    name: row.name,
    category: row.category,
    binId: row.bin_id,
    isRecyclable: row.is_recyclable,
    isCompostable: row.is_compostable,
    source: row.source,
    confidence: row.confidence,
    createdAt: toIso(row.created_at)
  };
}

function toSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    questionKeys: JSON.parse(row.question_keys),
    currentIndex: row.current_index,
    score: row.score,
    streak: row.streak,
    bestStreak: row.best_streak,
    correct: row.correct,
    finished: row.finished,
    submitted: row.submitted
  };
}

function countsToObject(rows) {
  const byBin = {};
  let total = 0;
  for (const row of rows) {
    byBin[row.bin_id] = row.n;
    total += row.n;
  }
  return { total, byBin };
}

function createPostgresStore(query) {
  let ready = null;

  // Create tables once per server instance. Two cold starts at the same moment
  // can race on CREATE TABLE IF NOT EXISTS, so one retry covers that case.
  function ensureSchema() {
    if (!ready) {
      ready = (async () => {
        for (const statement of SCHEMA) {
          try {
            await query(statement, []);
          } catch {
            await query(statement, []);
          }
        }
      })();
      ready.catch(() => {
        ready = null;
      });
    }
    return ready;
  }

  async function run(text, params = []) {
    await ensureSchema();
    return query(text, params);
  }

  return {
    async addScan(clientId, scan) {
      const [row] = await run(
        `INSERT INTO scans (client_id, item_id, name, category, bin_id, is_recyclable, is_compostable, source, confidence)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [clientId, scan.itemId ?? null, scan.name, scan.category, scan.binId,
          Boolean(scan.isRecyclable), Boolean(scan.isCompostable), scan.source, scan.confidence ?? null]
      );
      await run(
        `DELETE FROM scans WHERE client_id = $1 AND id NOT IN (
           SELECT id FROM scans WHERE client_id = $1 ORDER BY id DESC LIMIT $2
         )`,
        [clientId, HISTORY_LIMIT]
      );
      return toScan(row);
    },

    async listScans(clientId, limit = HISTORY_LIMIT) {
      const rows = await run('SELECT * FROM scans WHERE client_id = $1 ORDER BY id DESC LIMIT $2', [clientId, limit]);
      return rows.map(toScan);
    },

    async clearScans(clientId) {
      const rows = await run('DELETE FROM scans WHERE client_id = $1 RETURNING id', [clientId]);
      return rows.length;
    },

    async stats(clientId) {
      const community = await run('SELECT bin_id, COUNT(*)::int AS n FROM scans GROUP BY bin_id');
      const mine = clientId
        ? await run('SELECT bin_id, COUNT(*)::int AS n FROM scans WHERE client_id = $1 GROUP BY bin_id', [clientId])
        : [];
      return { community: countsToObject(community), mine: countsToObject(mine) };
    },

    async createSession(id, questionKeys) {
      await run(`DELETE FROM quiz_sessions WHERE created_at < now() - interval '1 day'`);
      const [row] = await run(
        'INSERT INTO quiz_sessions (id, question_keys) VALUES ($1, $2) RETURNING *',
        [id, JSON.stringify(questionKeys)]
      );
      return toSession(row);
    },

    async getSession(id) {
      const [row] = await run('SELECT * FROM quiz_sessions WHERE id = $1', [id]);
      return toSession(row);
    },

    // Returns false if another request already advanced this session (double click)
    async saveSessionProgress(session, expectedIndex) {
      const rows = await run(
        `UPDATE quiz_sessions
         SET current_index = $1, score = $2, streak = $3, best_streak = $4, correct = $5, finished = $6
         WHERE id = $7 AND current_index = $8 RETURNING id`,
        [session.currentIndex, session.score, session.streak, session.bestStreak,
          session.correct, session.finished, session.id, expectedIndex]
      );
      return rows.length === 1;
    },

    async submitScore(session, name) {
      const claimed = await run(
        'UPDATE quiz_sessions SET submitted = true WHERE id = $1 AND submitted = false RETURNING id',
        [session.id]
      );
      if (claimed.length !== 1) return null;
      const [{ id }] = await run(
        'INSERT INTO leaderboard (name, score, correct, total, best_streak) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [name, session.score, session.correct, session.questionKeys.length, session.bestStreak]
      );
      const [{ better }] = await run(
        'SELECT COUNT(*)::int AS better FROM leaderboard WHERE score > $1 OR (score = $1 AND id < $2)',
        [session.score, id]
      );
      return { id, rank: better + 1 };
    },

    async leaderboard(limit = 10) {
      const rows = await run('SELECT * FROM leaderboard ORDER BY score DESC, id ASC LIMIT $1', [limit]);
      return rows.map(row => ({
        id: row.id,
        name: row.name,
        score: row.score,
        correct: row.correct,
        total: row.total,
        bestStreak: row.best_streak,
        createdAt: toIso(row.created_at)
      }));
    },

    async close() {}
  };
}

// Neon's serverless driver talks to Postgres over HTTPS, which suits serverless functions
function openPostgresStore(connectionString) {
  const { neon } = require('@neondatabase/serverless');
  const sql = neon(connectionString);
  return createPostgresStore((text, params) => sql.query(text, params));
}

module.exports = { createPostgresStore, openPostgresStore };
