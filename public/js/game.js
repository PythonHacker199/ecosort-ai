// EcoSort Challenge quiz UI. The server keeps score (see /api/quiz),
// this file only renders questions, feedback and the leaderboard.

const Quiz = (() => {
  let binsById = {};
  let state = null;          // latest round state from the server
  let pendingState = null;   // state to show after the player clicks "Next"
  let awaitingNext = false;
  let busy = false;
  let started = false;

  const $ = id => document.getElementById(id);

  function init(bins) {
    binsById = bins;

    document.querySelectorAll('.game-bin-btn').forEach(btn => {
      btn.addEventListener('click', () => answer(btn.dataset.bin));
    });
    $('game-next-btn').addEventListener('click', next);
    $('game-reset-btn').addEventListener('click', startRound);
    $('leaderboard-form').addEventListener('submit', submitScore);
  }

  // Called when the quiz tab is opened, so we only create a round for players
  function ensureStarted() {
    loadLeaderboard();
    if (!started) startRound();
  }

  async function startRound() {
    started = true;
    awaitingNext = false;
    pendingState = null;
    $('game-feedback-card').classList.add('hidden');
    $('game-over-view').classList.add('hidden');
    $('game-play-view').classList.remove('hidden');
    $('leaderboard-form').classList.remove('hidden');
    $('leaderboard-form-status').textContent = '';
    $('game-item-display').textContent = 'Loading…';
    clearHighlights();

    try {
      state = await Api.startQuiz();
      render();
    } catch (err) {
      started = false;
      $('game-item-display').textContent = 'Could not start the quiz';
      App.toast(err.message);
    }
  }

  function render() {
    $('game-score-display').textContent = state.score;
    $('game-streak-display').textContent = `${state.streak}🔥`;
    $('game-progress').textContent = state.question
      ? `Question ${state.question.number} / ${state.total}`
      : `Finished · ${state.correct} / ${state.total} correct`;
    if (state.question) $('game-item-display').textContent = state.question.text;

    document.querySelectorAll('.game-bin-btn').forEach(btn => {
      btn.disabled = awaitingNext;
      btn.classList.toggle('opacity-50', awaitingNext);
    });
    $('game-next-btn').disabled = !awaitingNext;
    $('game-next-btn').classList.toggle('hidden', state.finished);
    $('game-next-btn').textContent = pendingState?.finished ? 'See Results →' : 'Next Waste Item →';
  }

  async function answer(binId) {
    if (!state || busy || awaitingNext || state.finished) return;
    busy = true;
    try {
      const { result, state: newState } = await Api.answerQuiz(state.sessionId, binId);
      pendingState = newState;
      awaitingNext = true;

      // Show the new score immediately, keep the current question on screen
      state = { ...state, score: newState.score, streak: newState.streak };
      render();
      showFeedback(result, newState.streak);
      highlight(result);
    } catch (err) {
      App.toast(err.message);
      if (err.status === 404 || err.status === 409) startRound();
    } finally {
      busy = false;
    }
  }

  function showFeedback(result, streak) {
    const card = $('game-feedback-card');
    const correctBin = binsById[result.correctBinId];
    card.classList.remove('hidden');

    if (result.isCorrect) {
      if (typeof playSound === 'function') playSound('correct');
      if (typeof confetti === 'function' && streak > 0 && streak % 3 === 0) {
        confetti({ particleCount: 60, spread: 70, origin: { y: 0.8 } });
      }
      card.className = 'mt-6 p-5 rounded-2xl bg-emerald-50 border border-emerald-200 text-left';
      card.innerHTML = `
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center flex-shrink-0">
            <i data-lucide="check" class="w-6 h-6"></i>
          </div>
          <div>
            <h4 class="font-black text-emerald-900 text-base">Spot on! +${result.pointsEarned} points 🎉</h4>
            <p class="text-xs text-emerald-800 mt-1">${escapeHtml(result.explanation)}</p>
          </div>
        </div>`;
    } else {
      if (typeof playSound === 'function') playSound('warn');
      card.className = 'mt-6 p-5 rounded-2xl bg-red-50 border border-red-200 text-left';
      card.innerHTML = `
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-full bg-red-600 text-white flex items-center justify-center flex-shrink-0">
            <i data-lucide="alert-circle" class="w-6 h-6"></i>
          </div>
          <div>
            <h4 class="font-black text-red-900 text-base">Oops! This goes in the ${escapeHtml(correctBin?.name || result.correctBinId)}</h4>
            <p class="text-xs text-red-800 mt-1">${escapeHtml(result.explanation)}</p>
          </div>
        </div>`;
    }
    App.refreshIcons();
  }

  function highlight(result) {
    document.querySelectorAll('.game-bin-btn').forEach(btn => {
      if (btn.dataset.bin === result.correctBinId) btn.classList.add('ring-4', 'ring-emerald-400', '!opacity-100');
      else if (btn.dataset.bin === result.chosenBinId) btn.classList.add('ring-4', 'ring-red-400');
    });
  }

  function clearHighlights() {
    document.querySelectorAll('.game-bin-btn').forEach(btn => {
      btn.classList.remove('ring-4', 'ring-emerald-400', 'ring-red-400', '!opacity-100');
    });
  }

  function next() {
    if (!awaitingNext) return;
    state = pendingState;
    pendingState = null;
    awaitingNext = false;
    clearHighlights();
    $('game-feedback-card').classList.add('hidden');

    if (state.finished) {
      showGameOver();
    }
    render();
  }

  function showGameOver() {
    $('game-play-view').classList.add('hidden');
    $('game-over-view').classList.remove('hidden');
    $('game-over-summary').textContent =
      `You got ${state.correct} of ${state.total} right and scored ${state.score} points (best streak: ${state.bestStreak}).`;
    if (typeof confetti === 'function' && state.correct >= state.total * 0.7) {
      confetti({ particleCount: 120, spread: 90, origin: { y: 0.6 } });
    }
    $('player-name-input').focus();
  }

  async function submitScore(event) {
    event.preventDefault();
    const name = $('player-name-input').value.trim();
    if (!name || !state?.finished) return;

    const status = $('leaderboard-form-status');
    try {
      const saved = await Api.submitQuiz(state.sessionId, name);
      status.textContent = `Saved! You're #${saved.rank} on the leaderboard.`;
      status.className = 'text-xs mt-2 text-emerald-700 font-semibold';
      $('leaderboard-form').classList.add('hidden');
      loadLeaderboard();
    } catch (err) {
      status.textContent = err.message;
      status.className = 'text-xs mt-2 text-red-600';
    }
  }

  async function loadLeaderboard() {
    const list = $('leaderboard-list');
    try {
      const { leaderboard } = await Api.leaderboard();
      if (leaderboard.length === 0) {
        list.innerHTML = '<li class="text-xs text-gray-500">No scores yet. Finish a round to be the first!</li>';
        return;
      }
      const medals = ['🥇', '🥈', '🥉'];
      list.innerHTML = leaderboard.map((entry, i) => `
        <li class="flex items-center justify-between gap-2 px-3 py-2 rounded-xl ${i === 0 ? 'bg-amber-50 border border-amber-200' : 'bg-gray-50'}">
          <span class="flex items-center gap-2 min-w-0">
            <span class="w-6 text-center font-bold text-gray-500">${medals[i] || i + 1}</span>
            <span class="font-semibold text-gray-800 truncate">${escapeHtml(entry.name)}</span>
          </span>
          <span class="text-right flex-shrink-0">
            <span class="font-black text-emerald-700">${entry.score}</span>
            <span class="block text-[10px] text-gray-400">${entry.correct}/${entry.total} correct</span>
          </span>
        </li>`).join('');
    } catch {
      list.innerHTML = '<li class="text-xs text-red-600">Could not load the leaderboard.</li>';
    }
  }

  return { init, ensureStarted };
})();
