// Client for the EcoSort REST API + small shared helpers

// Escape text before putting it into innerHTML (search queries, AI output, names...)
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const Api = (() => {
  const CLIENT_ID_KEY = 'ecosort_client_id';
  let cachedClientId = null;

  // Random anonymous id so the server can keep this browser's history.
  // Uses getRandomValues because randomUUID only exists on https/localhost.
  function newClientId() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }

  function clientId() {
    if (cachedClientId) return cachedClientId;
    try {
      cachedClientId = localStorage.getItem(CLIENT_ID_KEY);
      if (!cachedClientId) {
        cachedClientId = newClientId();
        localStorage.setItem(CLIENT_ID_KEY, cachedClientId);
      }
    } catch {
      cachedClientId = newClientId();
    }
    return cachedClientId;
  }

  async function request(path, { method = 'GET', json, formData } = {}) {
    const headers = { 'X-Client-Id': clientId() };
    let body;
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    } else if (formData) {
      body = formData;
    }

    let res;
    try {
      res = await fetch(`/api${path}`, { method, headers, body });
    } catch {
      const err = new Error('Cannot reach the EcoSort server');
      err.offline = true;
      throw err;
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  const q = value => encodeURIComponent(value);

  return {
    config: () => request('/config'),
    bins: () => request('/bins'),
    binItems: binId => request(`/bins/${q(binId)}/items`),
    item: id => request(`/items/${q(id)}`),
    search: text => request(`/search?q=${q(text)}`),
    suggest: text => request(`/suggest?q=${q(text)}`),
    classifyLabels: predictions => request('/classify/labels', { method: 'POST', json: { predictions } }),
    classifyImage: (blob, filename = 'photo.jpg') => {
      const form = new FormData();
      form.append('image', blob, filename);
      return request('/classify/image', { method: 'POST', formData: form });
    },
    history: () => request('/history'),
    addHistory: entry => request('/history', { method: 'POST', json: entry }),
    clearHistory: () => request('/history', { method: 'DELETE' }),
    stats: () => request('/stats'),
    startQuiz: () => request('/quiz', { method: 'POST' }),
    answerQuiz: (sessionId, binId) => request(`/quiz/${q(sessionId)}/answer`, { method: 'POST', json: { binId } }),
    submitQuiz: (sessionId, name) => request(`/quiz/${q(sessionId)}/submit`, { method: 'POST', json: { name } }),
    leaderboard: () => request('/leaderboard?limit=10')
  };
})();
