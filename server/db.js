// SQLite storage for scan history, quiz sessions and the leaderboard
// Uses Node's built-in node:sqlite module, so there is nothing to compile.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS scans (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id      TEXT    NOT NULL,
    item_id        TEXT,
    name           TEXT    NOT NULL,
    category       TEXT    NOT NULL,
    bin_id         TEXT    NOT NULL,
    is_recyclable  INTEGER NOT NULL,
    is_compostable INTEGER NOT NULL,
    source         TEXT    NOT NULL,
    confidence     REAL,
    created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_scans_client ON scans (client_id, id DESC);

  CREATE TABLE IF NOT EXISTS quiz_sessions (
    id             TEXT    PRIMARY KEY,
    question_keys  TEXT    NOT NULL,
    current_index  INTEGER NOT NULL DEFAULT 0,
    score          INTEGER NOT NULL DEFAULT 0,
    streak         INTEGER NOT NULL DEFAULT 0,
    best_streak    INTEGER NOT NULL DEFAULT 0,
    correct        INTEGER NOT NULL DEFAULT 0,
    finished       INTEGER NOT NULL DEFAULT 0,
    submitted      INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS leaderboard (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    score        INTEGER NOT NULL,
    correct      INTEGER NOT NULL,
    total        INTEGER NOT NULL,
    best_streak  INTEGER NOT NULL,
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_leaderboard_score ON leaderboard (score DESC, id ASC);
`;

const HISTORY_LIMIT = 50;

function openDatabase(dbPath) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return createRepository(db);
}

function toScan(row) {
  return {
    id: row.id,
    itemId: row.item_id,
    name: row.name,
    category: row.category,
    binId: row.bin_id,
    isRecyclable: Boolean(row.is_recyclable),
    isCompostable: Boolean(row.is_compostable),
    source: row.source,
    confidence: row.confidence,
    createdAt: row.created_at
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
    finished: Boolean(row.finished),
    submitted: Boolean(row.submitted)
  };
}

function createRepository(db) {
  const stmts = {
    insertScan: db.prepare(`
      INSERT INTO scans (client_id, item_id, name, category, bin_id, is_recyclable, is_compostable, source, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getScan: db.prepare('SELECT * FROM scans WHERE id = ?'),
    listScans: db.prepare('SELECT * FROM scans WHERE client_id = ? ORDER BY id DESC LIMIT ?'),
    trimScans: db.prepare(`
      DELETE FROM scans WHERE client_id = ? AND id NOT IN (
        SELECT id FROM scans WHERE client_id = ? ORDER BY id DESC LIMIT ?
      )
    `),
    clearScans: db.prepare('DELETE FROM scans WHERE client_id = ?'),
    countByBin: db.prepare('SELECT bin_id, COUNT(*) AS n FROM scans GROUP BY bin_id'),
    countByBinForClient: db.prepare('SELECT bin_id, COUNT(*) AS n FROM scans WHERE client_id = ? GROUP BY bin_id'),

    insertSession: db.prepare('INSERT INTO quiz_sessions (id, question_keys) VALUES (?, ?)'),
    getSession: db.prepare('SELECT * FROM quiz_sessions WHERE id = ?'),
    updateSession: db.prepare(`
      UPDATE quiz_sessions
      SET current_index = ?, score = ?, streak = ?, best_streak = ?, correct = ?, finished = ?
      WHERE id = ? AND current_index = ?
    `),
    markSubmitted: db.prepare('UPDATE quiz_sessions SET submitted = 1 WHERE id = ? AND submitted = 0'),
    deleteOldSessions: db.prepare(`DELETE FROM quiz_sessions WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')`),

    insertScore: db.prepare('INSERT INTO leaderboard (name, score, correct, total, best_streak) VALUES (?, ?, ?, ?, ?)'),
    topScores: db.prepare('SELECT * FROM leaderboard ORDER BY score DESC, id ASC LIMIT ?'),
    rankOf: db.prepare('SELECT COUNT(*) AS better FROM leaderboard WHERE score > ? OR (score = ? AND id < ?)')
  };

  function countsToObject(rows) {
    const byBin = {};
    let total = 0;
    for (const row of rows) {
      byBin[row.bin_id] = row.n;
      total += row.n;
    }
    return { total, byBin };
  }

  return {
    addScan(clientId, scan) {
      const info = stmts.insertScan.run(
        clientId,
        scan.itemId ?? null,
        scan.name,
        scan.category,
        scan.binId,
        scan.isRecyclable ? 1 : 0,
        scan.isCompostable ? 1 : 0,
        scan.source,
        scan.confidence ?? null
      );
      stmts.trimScans.run(clientId, clientId, HISTORY_LIMIT);
      return toScan(stmts.getScan.get(info.lastInsertRowid));
    },

    listScans(clientId, limit = HISTORY_LIMIT) {
      return stmts.listScans.all(clientId, limit).map(toScan);
    },

    clearScans(clientId) {
      return stmts.clearScans.run(clientId).changes;
    },

    stats(clientId) {
      return {
        community: countsToObject(stmts.countByBin.all()),
        mine: clientId ? countsToObject(stmts.countByBinForClient.all(clientId)) : { total: 0, byBin: {} }
      };
    },

    createSession(id, questionKeys) {
      stmts.deleteOldSessions.run();
      stmts.insertSession.run(id, JSON.stringify(questionKeys));
      return toSession(stmts.getSession.get(id));
    },

    getSession(id) {
      return toSession(stmts.getSession.get(id));
    },

    // Returns false if another request already advanced this session (double click)
    saveSessionProgress(session, expectedIndex) {
      const info = stmts.updateSession.run(
        session.currentIndex,
        session.score,
        session.streak,
        session.bestStreak,
        session.correct,
        session.finished ? 1 : 0,
        session.id,
        expectedIndex
      );
      return info.changes === 1;
    },

    submitScore(session, name) {
      const claimed = stmts.markSubmitted.run(session.id).changes === 1;
      if (!claimed) return null;
      const info = stmts.insertScore.run(name, session.score, session.correct, session.questionKeys.length, session.bestStreak);
      const id = Number(info.lastInsertRowid);
      const { better } = stmts.rankOf.get(session.score, session.score, id);
      return { id, rank: better + 1 };
    },

    leaderboard(limit = 10) {
      return stmts.topScores.all(limit).map(row => ({
        id: row.id,
        name: row.name,
        score: row.score,
        correct: row.correct,
        total: row.total,
        bestStreak: row.best_streak,
        createdAt: row.created_at
      }));
    },

    close() {
      db.close();
    }
  };
}

module.exports = { openDatabase, HISTORY_LIMIT };
