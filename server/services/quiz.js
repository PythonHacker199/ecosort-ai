// EcoSort Challenge quiz: rounds are tracked on the server so leaderboard
// scores can't be edited in the browser.
const crypto = require('node:crypto');
const { DUSTBINS, WASTE_ITEMS, QUIZ_ITEMS } = require('../data/wasteData');

const QUESTIONS_PER_ROUND = 10;
const MAX_NAME_LENGTH = 24;

// Question pool = hand-written quiz items + every item in the knowledge base
const QUESTION_POOL = new Map();
const seenTexts = new Set();
QUIZ_ITEMS.forEach((q, i) => {
  QUESTION_POOL.set(`quiz-${i}`, { text: q.item, targetBin: q.targetBin, explanation: q.explanation });
  seenTexts.add(q.item.toLowerCase());
});
for (const item of WASTE_ITEMS) {
  if (seenTexts.has(item.name.toLowerCase())) continue;
  QUESTION_POOL.set(`item-${item.id}`, { text: item.name, targetBin: item.binId, explanation: item.preparationTip });
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function pickQuestionKeys(count) {
  const keys = [...QUESTION_POOL.keys()];
  for (let i = keys.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  return keys.slice(0, count);
}

function publicState(session) {
  const total = session.questionKeys.length;
  const question = session.finished
    ? null
    : { number: session.currentIndex + 1, text: QUESTION_POOL.get(session.questionKeys[session.currentIndex]).text };

  return {
    sessionId: session.id,
    total,
    score: session.score,
    streak: session.streak,
    bestStreak: session.bestStreak,
    correct: session.correct,
    finished: session.finished,
    submitted: session.submitted,
    question
  };
}

function startQuiz(repo) {
  const session = repo.createSession(crypto.randomUUID(), pickQuestionKeys(QUESTIONS_PER_ROUND));
  return publicState(session);
}

function getQuiz(repo, sessionId) {
  const session = repo.getSession(sessionId);
  if (!session) throw httpError(404, 'Quiz session not found. Start a new round.');
  return publicState(session);
}

function answerQuestion(repo, sessionId, binId) {
  if (!Object.hasOwn(DUSTBINS, binId)) throw httpError(400, 'Unknown dustbin');

  const session = repo.getSession(sessionId);
  if (!session) throw httpError(404, 'Quiz session not found. Start a new round.');
  if (session.finished) throw httpError(409, 'This round is already finished.');

  const expectedIndex = session.currentIndex;
  const question = QUESTION_POOL.get(session.questionKeys[expectedIndex]);
  const isCorrect = question.targetBin === binId;

  let pointsEarned = 0;
  if (isCorrect) {
    session.streak += 1;
    session.correct += 1;
    pointsEarned = 10 + (session.streak - 1) * 5;
    session.score += pointsEarned;
    session.bestStreak = Math.max(session.bestStreak, session.streak);
  } else {
    session.streak = 0;
  }

  session.currentIndex += 1;
  session.finished = session.currentIndex >= session.questionKeys.length;

  if (!repo.saveSessionProgress(session, expectedIndex)) {
    throw httpError(409, 'That question was already answered.');
  }

  return {
    result: {
      item: question.text,
      isCorrect,
      pointsEarned,
      chosenBinId: binId,
      correctBinId: question.targetBin,
      explanation: question.explanation
    },
    state: publicState(session)
  };
}

function cleanPlayerName(name) {
  if (typeof name !== 'string') return '';
  return name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
}

function submitScore(repo, sessionId, rawName) {
  const name = cleanPlayerName(rawName);
  if (!name) throw httpError(400, 'Please enter a name for the leaderboard.');

  const session = repo.getSession(sessionId);
  if (!session) throw httpError(404, 'Quiz session not found.');
  if (!session.finished) throw httpError(409, 'Finish the round before submitting your score.');

  const saved = repo.submitScore(session, name);
  if (!saved) throw httpError(409, 'This score was already submitted.');

  return { rank: saved.rank, score: session.score, name };
}

module.exports = {
  QUESTIONS_PER_ROUND,
  startQuiz,
  getQuiz,
  answerQuestion,
  submitScore,
  // exported for tests
  QUESTION_POOL
};
