// Main UI for EcoSort AI: tabs, search, photo/camera scanning, result card,
// dustbin guide, and history. All data comes from the server via Api (api.js).

const App = (() => {
  const TABS = ['classifier', 'explorer', 'game', 'history'];
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const MATCH_LABELS = {
    exact: 'Exact match',
    keyword_exact: 'Keyword match',
    fuzzy: 'Smart match',
    heuristic: 'Best guess (rules)'
  };
  const QUICK_PICKS = [
    { label: '🧴 Plastic Bottle', query: 'plastic bottle' },
    { label: '🍌 Banana Peel', query: 'banana peel' },
    { label: '📦 Cardboard Box', query: 'cardboard box' },
    { label: '🥫 Soda Can', query: 'soda can' },
    { label: '🍟 Chips Packet', query: 'chips packet' },
    { label: '🔋 AA Battery', query: 'battery' },
    { label: '☕ Coffee Grounds', query: 'coffee grounds' },
    { label: '💊 Expired Medicine', query: 'expired medicine' },
    { label: '🥤 Paper Coffee Cup', query: 'paper coffee cup' },
    { label: '📱 Old Phone', query: 'smartphone' }
  ];

  let serverConfig = { geminiEnabled: false };
  let bins = [];
  let binsById = {};
  let currentStream = null;
  let previewUrl = null;
  let suggestToken = 0;
  let suggestTimer = null;
  let toastTimer = null;

  const $ = id => document.getElementById(id);

  // ----------------------------------------------------
  // Startup
  // ----------------------------------------------------
  async function start() {
    refreshIcons();
    initNavigation();
    initSearch();
    initQuickPicks();
    initImageInput();
    initCamera();
    initVoice();
    initModals();
    $('clear-history-btn').addEventListener('click', clearHistory);

    try {
      const [config, binsResponse] = await Promise.all([Api.config(), Api.bins()]);
      serverConfig = config;
      bins = binsResponse.bins;
      binsById = Object.fromEntries(bins.map(b => [b.id, b]));
    } catch (err) {
      $('offline-banner').classList.remove('hidden');
      setStatusBadge('error', 'Server offline');
      return;
    }

    Quiz.init(binsById);
    updatePhotoAiStatus();
    switchTab(tabFromHash(), { updateHash: false });
    window.addEventListener('hashchange', () => switchTab(tabFromHash(), { updateHash: false }));
  }

  function refreshIcons() {
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 4000);
  }

  function setStatusBadge(kind, text) {
    const styles = {
      loading: ['bg-amber-50 text-amber-700 border-amber-200', 'bg-amber-400 animate-pulse'],
      ready: ['bg-emerald-50 text-emerald-700 border-emerald-200', 'bg-emerald-500'],
      info: ['bg-blue-50 text-blue-700 border-blue-200', 'bg-blue-500'],
      error: ['bg-red-50 text-red-700 border-red-200', 'bg-red-500']
    }[kind];
    const badge = $('model-status-badge');
    badge.className = `hidden sm:inline-flex text-xs px-2.5 py-1 rounded-full border items-center ${styles[0]}`;
    badge.innerHTML = `<span class="inline-block w-2 h-2 rounded-full mr-1.5 ${styles[1]}"></span>${escapeHtml(text)}`;
  }

  function updatePhotoAiStatus() {
    if (serverConfig.geminiEnabled) {
      setStatusBadge('ready', 'Gemini Photo AI Ready');
      $('photo-privacy-note').textContent = '✨ Photos are analyzed by Gemini AI on the server (not stored)';
      return;
    }
    $('photo-privacy-note').textContent = '⚡ Photos are analyzed on your device and never uploaded';
    setStatusBadge('loading', 'Loading on-device AI…');
    Vision.load()
      .then(() => setStatusBadge('ready', 'On-device AI Ready'))
      .catch(() => setStatusBadge('info', 'Text search ready'));
  }

  // ----------------------------------------------------
  // Tabs (linkable via #explorer, #game, #history)
  // ----------------------------------------------------
  function tabFromHash() {
    const tab = location.hash.replace('#', '');
    return TABS.includes(tab) ? tab : 'classifier';
  }

  function initNavigation() {
    document.querySelectorAll('[data-nav-target]').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.navTarget));
    });
  }

  function switchTab(tabId, { updateHash = true } = {}) {
    TABS.forEach(id => $(`${id}-section`).classList.toggle('hidden', id !== tabId));
    document.querySelectorAll('.nav-btn').forEach(btn => {
      if (btn.dataset.navTarget === tabId) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });

    if (updateHash) {
      history.replaceState(null, '', tabId === 'classifier' ? location.pathname : `#${tabId}`);
    }

    if (tabId === 'explorer') renderExplorer();
    else if (tabId === 'history') renderHistory();
    else if (tabId === 'game') Quiz.ensureStarted();
  }

  // ----------------------------------------------------
  // Text search + autocomplete
  // ----------------------------------------------------
  function initSearch() {
    const input = $('waste-search-input');
    const box = $('search-suggestions');

    input.addEventListener('input', () => {
      clearTimeout(suggestTimer);
      suggestTimer = setTimeout(() => loadSuggestions(input.value), 150);
    });

    input.addEventListener('keydown', e => {
      const options = [...box.querySelectorAll('.suggestion-item')];
      const active = box.querySelector('[aria-selected="true"]');
      const index = options.indexOf(active);

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (box.classList.contains('hidden') || options.length === 0) return;
        e.preventDefault();
        const nextIndex = e.key === 'ArrowDown' ? (index + 1) % options.length : (index - 1 + options.length) % options.length;
        options.forEach((opt, i) => opt.setAttribute('aria-selected', String(i === nextIndex)));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (active) active.click();
        else executeSearch(input.value);
      } else if (e.key === 'Escape') {
        hideSuggestions();
      }
    });

    $('waste-search-btn').addEventListener('click', () => executeSearch(input.value));

    document.addEventListener('click', e => {
      if (!box.contains(e.target) && e.target !== input) hideSuggestions();
    });
  }

  function hideSuggestions() {
    $('search-suggestions').classList.add('hidden');
    $('waste-search-input').setAttribute('aria-expanded', 'false');
  }

  async function loadSuggestions(value) {
    const box = $('search-suggestions');
    const token = ++suggestToken;
    if (value.trim().length < 2) return hideSuggestions();

    let suggestions;
    try {
      ({ suggestions } = await Api.suggest(value));
    } catch {
      return;
    }
    if (token !== suggestToken) return; // a newer keystroke already answered
    if (suggestions.length === 0) return hideSuggestions();

    box.innerHTML = suggestions.map(s => {
      const bin = binsById[s.binId] || {};
      return `
        <div role="option" aria-selected="false" data-id="${escapeHtml(s.id)}"
             class="suggestion-item px-4 py-2.5 hover:bg-emerald-50 aria-selected:bg-emerald-50 cursor-pointer flex items-center justify-between gap-2 border-b border-gray-100 last:border-b-0">
          <span class="flex items-center gap-2 min-w-0">
            <span class="w-3 h-3 rounded-full flex-shrink-0" style="background-color: ${bin.colorHex}"></span>
            <span class="font-medium text-gray-800 text-sm truncate">${escapeHtml(s.name)}</span>
          </span>
          <span class="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0" style="background-color: ${bin.lightBg}; color: ${bin.colorHex};">
            ${escapeHtml(bin.name)}
          </span>
        </div>`;
    }).join('');
    box.classList.remove('hidden');
    $('waste-search-input').setAttribute('aria-expanded', 'true');

    box.querySelectorAll('.suggestion-item').forEach(el => {
      el.addEventListener('click', async () => {
        hideSuggestions();
        try {
          const { item } = await Api.item(el.dataset.id);
          $('waste-search-input').value = item.name;
          displayVerdict(item, 1.0, 'Database');
        } catch (err) {
          toast(err.message);
        }
      });
    });
  }

  async function executeSearch(query) {
    hideSuggestions();
    if (!query || !query.trim()) return;
    try {
      const { match } = await Api.search(query.trim());
      if (match) displayVerdict(match.item, match.confidence, MATCH_LABELS[match.matchType] || 'Search');
      else showNotFound(query.trim());
    } catch (err) {
      toast(err.message);
    }
  }

  function initQuickPicks() {
    const container = $('quick-pills-container');
    container.innerHTML = QUICK_PICKS.map(p => `
      <button type="button" class="quick-pill text-xs font-medium px-3 py-1.5 rounded-full bg-gray-100 hover:bg-emerald-100 hover:text-emerald-800 border border-gray-200 transition-colors" data-query="${escapeHtml(p.query)}">
        ${escapeHtml(p.label)}
      </button>`).join('');

    container.querySelectorAll('.quick-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        $('waste-search-input').value = btn.dataset.query;
        playSound('pop');
        executeSearch(btn.dataset.query);
      });
    });
  }

  // ----------------------------------------------------
  // Voice search
  // ----------------------------------------------------
  function initVoice() {
    const micBtn = $('voice-search-btn');
    const status = $('voice-status-indicator');

    const voice = initVoiceSearch(
      spoken => {
        $('waste-search-input').value = spoken;
        executeSearch(spoken);
      },
      (state, message) => {
        const listening = state === 'listening';
        status.classList.toggle('hidden', !listening);
        micBtn.classList.toggle('animate-pulse', listening);
        micBtn.classList.toggle('text-red-500', listening);
        if (state === 'error') {
          toast(message.includes('not-allowed')
            ? 'Microphone blocked. Allow mic access (voice needs https or localhost).'
            : message);
        }
      }
    );

    micBtn.addEventListener('click', () => {
      if (!voice) return toast('Voice search is not supported in this browser. Try Chrome or Edge.');
      if (voice.isListening()) voice.stop();
      else voice.start();
    });
  }

  // ----------------------------------------------------
  // Photo upload & classification
  // ----------------------------------------------------
  function initImageInput() {
    const dropZone = $('drop-zone');
    const fileInput = $('image-file-input');

    dropZone.addEventListener('click', e => {
      if (e.target !== fileInput) fileInput.click();
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) handleImageFile(fileInput.files[0]);
      fileInput.value = '';
    });

    ['dragenter', 'dragover'].forEach(type => dropZone.addEventListener(type, e => {
      e.preventDefault();
      dropZone.classList.add('border-emerald-500', 'bg-emerald-50');
    }));
    ['dragleave', 'drop'].forEach(type => dropZone.addEventListener(type, e => {
      e.preventDefault();
      dropZone.classList.remove('border-emerald-500', 'bg-emerald-50');
    }));
    dropZone.addEventListener('drop', e => {
      const file = e.dataTransfer.files[0];
      if (file) handleImageFile(file);
    });
  }

  function handleImageFile(file) {
    if (!file.type.startsWith('image/')) return toast('Please choose an image file (JPG, PNG, WEBP).');
    if (file.size > MAX_IMAGE_BYTES) return toast('That image is larger than 5 MB. Please pick a smaller one.');
    classifyImageBlob(file);
  }

  function showImagePreview(blob) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(blob);
    $('image-preview-element').src = previewUrl;
    $('image-preview-container').classList.remove('hidden');
    $('drop-zone-prompt').classList.add('hidden');
    return previewUrl;
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not read that image'));
      img.src = url;
    });
  }

  function setAnalyzing(on, detail = '') {
    $('classification-loading').classList.toggle('hidden', !on);
    $('scanning-laser-line').classList.toggle('hidden', !on);
    if (detail) $('classification-loading-detail').textContent = detail;
  }

  async function classifyImageBlob(blob) {
    const url = showImagePreview(blob);

    try {
      if (serverConfig.geminiEnabled) {
        setAnalyzing(true, 'Asking Gemini AI on the server…');
        try {
          const { result } = await Api.classifyImage(blob, blob.name || 'photo.jpg');
          displayVerdict(result.item, result.confidence, 'Gemini Photo AI');
          return;
        } catch (err) {
          toast(`${err.message} Trying on-device AI…`);
        }
      }

      setAnalyzing(true, 'Running on-device AI model…');
      const img = await loadImage(url);
      let predictions;
      try {
        predictions = await Vision.predict(img);
      } catch {
        showNotFound('this photo', 'The image AI could not load (are you offline?). Please type the item name instead.');
        return;
      }

      const { result } = await Api.classifyLabels(predictions.map(p => ({ className: p.className, probability: p.probability })));
      if (result) {
        displayVerdict(result.primary.item, result.primary.confidence, `Photo AI · ${result.primary.rawLabel.split(',')[0]}`, result.alternatives);
      } else {
        const guess = predictions[0]?.className.split(',')[0];
        showNotFound('this photo', guess
          ? `The AI thinks it sees "${guess}", but that isn't in our waste guide. Try typing the item name.`
          : undefined);
      }
    } catch (err) {
      toast(err.message);
    } finally {
      setAnalyzing(false);
    }
  }

  // ----------------------------------------------------
  // Live camera
  // ----------------------------------------------------
  function initCamera() {
    $('camera-start-btn').addEventListener('click', openCamera);
    $('camera-close-btn').addEventListener('click', closeCamera);
    $('camera-capture-btn').addEventListener('click', captureFromCamera);
  }

  async function openCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      return toast(window.isSecureContext
        ? 'This browser does not support camera access.'
        : 'Camera needs a secure page (https or localhost). Upload a photo instead.');
    }
    $('camera-modal').classList.remove('hidden');
    try {
      currentStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
      const video = $('camera-video-feed');
      video.srcObject = currentStream;
      await video.play();
    } catch (err) {
      closeCamera();
      toast(`Unable to access the camera: ${err.message}`);
    }
  }

  function closeCamera() {
    if (currentStream) currentStream.getTracks().forEach(t => t.stop());
    currentStream = null;
    $('camera-video-feed').srcObject = null;
    $('camera-modal').classList.add('hidden');
  }

  function captureFromCamera() {
    const video = $('camera-video-feed');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    closeCamera();
    canvas.toBlob(blob => {
      if (!blob) return toast('Could not capture a photo. Please try again.');
      classifyImageBlob(new File([blob], 'camera.jpg', { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.9);
  }

  // ----------------------------------------------------
  // Result card
  // ----------------------------------------------------
  function recyclabilityBadge(item) {
    const status = escapeHtml(item.recyclabilityStatus);
    if (item.isRecyclable) {
      return `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-200"><i data-lucide="recycle" class="w-3.5 h-3.5"></i> ${status || 'Recyclable'}</span>`;
    }
    if (item.isCompostable) {
      return `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200"><i data-lucide="leaf" class="w-3.5 h-3.5"></i> ${status || 'Compostable'}</span>`;
    }
    if (item.binId === 'red') {
      return `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-red-100 text-red-800 border border-red-200"><i data-lucide="alert-triangle" class="w-3.5 h-3.5"></i> ${status || 'Hazardous'}</span>`;
    }
    return `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-800 border border-gray-300"><i data-lucide="x-circle" class="w-3.5 h-3.5"></i> ${status || 'Non-Recyclable'}</span>`;
  }

  function displayVerdict(item, confidence = 1, sourceLabel = 'Search', alternatives = []) {
    const dustbin = binsById[item.binId] || binsById.grey;
    $('verdict-empty-state').classList.add('hidden');
    const card = $('verdict-result-card');
    card.classList.remove('hidden');
    playSound(dustbin.id);

    const summary = item.isRecyclable
      ? 'This item can be reprocessed into new raw materials.'
      : item.isCompostable
        ? 'Breaks down naturally into nutrient-rich compost.'
        : 'Cannot be recycled in standard facilities. It goes to landfill or energy recovery.';

    card.innerHTML = `
      <div class="relative overflow-hidden rounded-3xl p-6 sm:p-8 text-white shadow-xl"
           style="background: linear-gradient(135deg, ${dustbin.colorHex}dd 0%, ${dustbin.colorHex} 100%);">
        <div class="absolute -right-12 -top-12 w-48 h-48 rounded-full bg-white/10 blur-xl"></div>
        <div class="absolute -left-12 -bottom-12 w-48 h-48 rounded-full bg-black/10 blur-xl"></div>
        <div class="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div class="min-w-0">
            <div class="flex items-center gap-2 mb-2 flex-wrap">
              <span class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-white/20 backdrop-blur-md border border-white/20">${escapeHtml(sourceLabel)}</span>
              <span class="text-xs text-white/80">Confidence: ${Math.round(confidence * 100)}%</span>
            </div>
            <h2 class="text-2xl sm:text-4xl font-extrabold tracking-tight break-words">${escapeHtml(item.name)}</h2>
            <p class="text-white/90 text-sm sm:text-base mt-1 font-medium">${escapeHtml(item.category)}</p>
          </div>
          <div class="bg-white/95 text-gray-900 rounded-2xl p-4 shadow-lg flex items-center gap-4 md:min-w-[240px]">
            <div class="w-14 h-14 rounded-xl flex items-center justify-center text-white shadow-md flex-shrink-0" style="background-color: ${dustbin.colorHex};">
              <i data-lucide="${escapeHtml(dustbin.icon)}" class="w-8 h-8"></i>
            </div>
            <div>
              <div class="text-xs uppercase tracking-wider font-bold text-gray-500">Put in this dustbin</div>
              <div class="text-xl font-black" style="color: ${dustbin.colorHex};">${escapeHtml(dustbin.name)}</div>
              <div class="text-xs text-gray-600">${escapeHtml(dustbin.subtitle)}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
        <div class="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm flex flex-col justify-between">
          <div>
            <div class="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Recyclability Status</div>
            <div class="mb-3">${recyclabilityBadge(item)}</div>
            <p class="text-xs text-gray-600 leading-relaxed">${summary}</p>
          </div>
          <div class="mt-4 pt-3 border-t border-gray-100 text-xs text-gray-500">
            <span class="font-semibold text-gray-700">Decomposition time:</span>
            <span class="font-bold text-amber-600 ml-1">${escapeHtml(item.decompositionTime || 'Unknown')}</span>
          </div>
        </div>

        <div class="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm flex flex-col justify-between">
          <div>
            <div class="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Disposal &amp; Preparation Tip</div>
            <div class="flex items-start gap-2.5">
              <div class="p-1.5 rounded-lg bg-emerald-50 text-emerald-600 flex-shrink-0 mt-0.5"><i data-lucide="check-circle" class="w-4 h-4"></i></div>
              <p class="text-sm font-medium text-gray-800 leading-snug">${escapeHtml(item.preparationTip)}</p>
            </div>
          </div>
          <div class="mt-4 pt-3 border-t border-gray-100 text-xs text-gray-500">
            <span class="font-semibold text-gray-700">Material:</span>
            <span class="text-gray-600 ml-1">${escapeHtml(item.material)}</span>
          </div>
        </div>

        <div class="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm flex flex-col justify-between">
          <div>
            <div class="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Eco Fact &amp; Impact</div>
            <div class="flex items-start gap-2.5">
              <div class="p-1.5 rounded-lg bg-blue-50 text-blue-600 flex-shrink-0 mt-0.5"><i data-lucide="globe" class="w-4 h-4"></i></div>
              <p class="text-xs text-gray-700 leading-relaxed">${escapeHtml(item.ecoFact)}</p>
            </div>
          </div>
          <div class="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between">
            <button id="speak-verdict-card-btn" type="button" class="text-xs font-semibold text-emerald-700 hover:text-emerald-800 flex items-center gap-1.5 py-1">
              <i data-lucide="volume-2" class="w-3.5 h-3.5"></i> Read Aloud
            </button>
            <span class="text-[11px] text-gray-400">Save our planet 🌍</span>
          </div>
        </div>
      </div>

      <div id="alternatives-container"></div>`;

    $('speak-verdict-card-btn').addEventListener('click', () => speakWasteResult(item, dustbin));
    renderAlternatives(alternatives);
    refreshIcons();
    saveToHistory(item, confidence, sourceLabel);
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderAlternatives(alternatives) {
    const container = $('alternatives-container');
    if (!alternatives || alternatives.length === 0) return;

    container.innerHTML = `
      <div class="mt-4 pt-4 border-t border-gray-100">
        <p class="text-xs text-gray-500 mb-2">Not quite right? Did you mean:</p>
        <div class="flex flex-wrap gap-2">
          ${alternatives.map((alt, i) => `
            <button type="button" class="alt-btn text-xs px-2.5 py-1 bg-gray-100 hover:bg-emerald-100 text-gray-700 hover:text-emerald-800 rounded-lg border border-gray-200 transition-colors" data-index="${i}">
              ${escapeHtml(alt.item.name)} (${Math.round((alt.confidence || 0.5) * 100)}%)
            </button>`).join('')}
        </div>
      </div>`;

    container.querySelectorAll('.alt-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const alt = alternatives[Number(btn.dataset.index)];
        displayVerdict(alt.item, alt.confidence, 'Your correction');
      });
    });
  }

  function showNotFound(query, detail) {
    $('verdict-empty-state').classList.add('hidden');
    const card = $('verdict-result-card');
    card.classList.remove('hidden');
    card.innerHTML = `
      <div class="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
        <div class="w-12 h-12 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-3">
          <i data-lucide="help-circle" class="w-6 h-6"></i>
        </div>
        <h3 class="text-lg font-bold text-gray-800">We couldn't identify ${query === 'this photo' ? 'this photo' : `"${escapeHtml(query)}"`} precisely</h3>
        <p class="text-sm text-gray-600 mt-2 max-w-md mx-auto">${escapeHtml(detail || 'Here is a quick rule of thumb for safe waste segregation:')}</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 text-left max-w-md mx-auto">
          <div class="p-3 bg-white rounded-lg border border-emerald-200 text-xs"><span class="font-bold text-emerald-700">🌱 Organic / Wet:</span> If it was once food or plant, or rots naturally, use the <strong>Green Bin</strong>.</div>
          <div class="p-3 bg-white rounded-lg border border-blue-200 text-xs"><span class="font-bold text-blue-700">♻️ Dry Recyclable:</span> Clean paper, rigid plastics, metal cans and glass go in the <strong>Blue Bin</strong>.</div>
          <div class="p-3 bg-white rounded-lg border border-gray-300 text-xs"><span class="font-bold text-gray-700">🗑️ Landfill:</span> Greasy wrappers, chip packets and styrofoam go in the <strong>Grey Bin</strong>.</div>
          <div class="p-3 bg-white rounded-lg border border-amber-300 text-xs"><span class="font-bold text-amber-700">⚡ E-Waste:</span> Wires, batteries and electronics go to the <strong>E-Waste Bin</strong>.</div>
        </div>
      </div>`;
    refreshIcons();
  }

  function saveToHistory(item, confidence, source) {
    Api.addHistory({
      itemId: item.id || undefined,
      item: {
        name: item.name,
        category: item.category,
        binId: item.binId,
        isRecyclable: item.isRecyclable,
        isCompostable: item.isCompostable
      },
      source,
      confidence
    }).catch(err => console.warn('Could not save history:', err.message));
  }

  // ----------------------------------------------------
  // Dustbin guide
  // ----------------------------------------------------
  function renderExplorer() {
    const container = $('bins-explorer-container');
    container.innerHTML = bins.map(bin => `
      <div class="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm hover:shadow-lg transition-all duration-300 flex flex-col justify-between">
        <div>
          <div class="flex items-center gap-3 mb-4">
            <div class="w-12 h-12 rounded-2xl flex items-center justify-center text-white shadow-md" style="background-color: ${bin.colorHex};">
              <i data-lucide="${escapeHtml(bin.icon)}" class="w-6 h-6"></i>
            </div>
            <div>
              <h3 class="text-lg font-black text-gray-900">${escapeHtml(bin.name)}</h3>
              <span class="text-xs font-semibold px-2 py-0.5 rounded-full" style="background-color: ${bin.lightBg}; color: ${bin.colorHex};">${escapeHtml(bin.subtitle)}</span>
            </div>
          </div>
          <p class="text-xs text-gray-600 leading-relaxed mb-4">${escapeHtml(bin.description)}</p>
          <div class="mb-4">
            <div class="text-[11px] uppercase tracking-wider font-bold text-gray-400 mb-2">Examples that go in:</div>
            <div class="flex flex-wrap gap-1.5">
              ${bin.examples.map(ex => `<span class="text-xs px-2.5 py-1 rounded-lg bg-gray-50 border border-gray-200 text-gray-700">${escapeHtml(ex)}</span>`).join('')}
            </div>
          </div>
        </div>
        <div class="pt-4 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
          <span>${bin.itemCount} items cataloged</span>
          <button type="button" class="explore-bin-items-btn font-semibold text-emerald-700 hover:text-emerald-800" data-bin-id="${escapeHtml(bin.id)}">View All Items →</button>
        </div>
      </div>`).join('');
    refreshIcons();

    container.querySelectorAll('.explore-bin-items-btn').forEach(btn => {
      btn.addEventListener('click', () => openBinItems(btn.dataset.binId));
    });
  }

  function initModals() {
    $('bin-items-close-btn').addEventListener('click', closeBinItems);
    $('bin-items-modal').addEventListener('click', e => {
      if (e.target.id === 'bin-items-modal') closeBinItems();
    });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      closeBinItems();
      if (currentStream) closeCamera();
    });
  }

  function closeBinItems() {
    $('bin-items-modal').classList.add('hidden');
  }

  async function openBinItems(binId) {
    try {
      const { bin, items } = await Api.binItems(binId);
      $('bin-items-title').textContent = `${bin.name} · ${items.length} items`;
      const list = $('bin-items-list');
      list.innerHTML = items.map((item, i) => `
        <button type="button" data-index="${i}" class="bin-item-row w-full text-left px-3 py-2.5 rounded-xl hover:bg-gray-50 flex items-center justify-between gap-3">
          <span class="flex items-center gap-2 min-w-0">
            <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background-color: ${bin.colorHex}"></span>
            <span class="text-sm font-semibold text-gray-800 truncate">${escapeHtml(item.name)}</span>
          </span>
          <span class="text-[11px] text-gray-400 flex-shrink-0">${escapeHtml(item.decompositionTime)}</span>
        </button>`).join('');
      list.querySelectorAll('.bin-item-row').forEach(row => {
        row.addEventListener('click', () => {
          closeBinItems();
          switchTab('classifier');
          displayVerdict(items[Number(row.dataset.index)], 1.0, 'Dustbin Guide');
        });
      });
      $('bin-items-modal').classList.remove('hidden');
    } catch (err) {
      toast(err.message);
    }
  }

  // ----------------------------------------------------
  // History & stats
  // ----------------------------------------------------
  function binBars(byBin, total) {
    return bins.map(bin => {
      const count = byBin[bin.id] || 0;
      const pct = total ? Math.round((count / total) * 100) : 0;
      return `
        <div class="flex items-center gap-2 text-[11px]">
          <span class="w-16 text-gray-500 truncate">${escapeHtml(bin.id[0].toUpperCase() + bin.id.slice(1))}</span>
          <span class="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
            <span class="block h-full rounded-full" style="width: ${pct}%; background-color: ${bin.colorHex};"></span>
          </span>
          <span class="w-6 text-right font-semibold text-gray-700">${count}</span>
        </div>`;
    }).join('');
  }

  function statCard(title, subtitle, counts) {
    return `
      <div class="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
        <div class="flex items-baseline justify-between mb-3">
          <div>
            <div class="text-xs font-bold text-gray-400 uppercase tracking-wider">${title}</div>
            <div class="text-[11px] text-gray-400">${subtitle}</div>
          </div>
          <div class="text-3xl font-black text-emerald-700">${counts.total}</div>
        </div>
        <div class="space-y-1.5">${binBars(counts.byBin, counts.total)}</div>
      </div>`;
  }

  async function renderHistory() {
    const container = $('history-items-container');
    try {
      const [{ history }, stats] = await Promise.all([Api.history(), Api.stats()]);

      $('stats-panel').innerHTML =
        statCard('Your scans', 'Items sorted on this device', stats.mine) +
        statCard('Community', 'Everyone using this server', stats.community);

      $('history-empty').classList.toggle('hidden', history.length > 0);
      container.innerHTML = history.map(entry => {
        const bin = binsById[entry.binId] || binsById.grey;
        const label = entry.isRecyclable ? 'Recyclable' : entry.isCompostable ? 'Compostable' : 'Residual';
        const labelClass = entry.isRecyclable ? 'bg-blue-50 text-blue-700' : entry.isCompostable ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-700';
        const when = new Date(entry.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
        return `
          <div class="bg-white rounded-xl p-4 border border-gray-100 shadow-sm flex items-center justify-between gap-3 hover:shadow-md transition-shadow">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-1.5 h-10 rounded-full flex-shrink-0" style="background-color: ${bin.colorHex};"></div>
              <div class="min-w-0">
                <h4 class="font-bold text-gray-800 text-sm truncate">${escapeHtml(entry.name)}</h4>
                <p class="text-xs text-gray-500 truncate">${escapeHtml(entry.category)} • <span style="color: ${bin.colorHex}; font-weight: 600;">${escapeHtml(bin.name)}</span></p>
              </div>
            </div>
            <div class="text-right flex-shrink-0">
              <span class="text-xs px-2.5 py-1 rounded-full font-semibold ${labelClass}">${label}</span>
              <div class="text-[11px] text-gray-400 mt-1">${escapeHtml(when)}</div>
            </div>
          </div>`;
      }).join('');
    } catch (err) {
      container.innerHTML = '';
      toast(err.message);
    }
  }

  async function clearHistory() {
    if (!confirm('Clear all of your scan history?')) return;
    try {
      await Api.clearHistory();
      renderHistory();
    } catch (err) {
      toast(err.message);
    }
  }

  return { start, toast, refreshIcons };
})();

document.addEventListener('DOMContentLoaded', App.start);
