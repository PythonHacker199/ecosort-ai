// On-device image recognition with TensorFlow.js MobileNet.
// The browser turns a photo into labels ("water bottle", "banana"...) and the
// server maps those labels onto waste items via /api/classify/labels.

const Vision = (() => {
  // TensorFlow.js is ~1.5 MB, so it is only downloaded when first needed
  const SCRIPTS = [
    'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js',
    'https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.1/dist/mobilenet.min.js'
  ];

  let model = null;
  let loading = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Could not download ${src}`));
      document.head.appendChild(script);
    });
  }

  function load() {
    if (model) return Promise.resolve(model);
    if (loading) return loading;

    loading = (async () => {
      for (const src of SCRIPTS) {
        if (src.includes('mobilenet') ? typeof mobilenet === 'undefined' : typeof tf === 'undefined') {
          await loadScript(src);
        }
      }
      model = await mobilenet.load({ version: 2, alpha: 1.0 });
      return model;
    })();

    loading.catch(() => {
      loading = null;
    });
    return loading;
  }

  // Returns [{ className, probability }, ...]
  async function predict(imageElement, topK = 5) {
    const m = await load();
    return m.classify(imageElement, topK);
  }

  return {
    load,
    predict,
    isReady: () => Boolean(model)
  };
})();
