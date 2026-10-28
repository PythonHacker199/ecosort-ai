// Speech & Audio Feedback Module
// Web Speech API (Recognition + Synthesis) & Web Audio API (Synthesized SFX)

let audioCtx = null;
let recognition = null;
let isRecognizing = false;

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

// Synthesize pleasant UI sound effects via Web Audio API oscillators
function playSound(type) {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'success' || type === 'green' || type === 'blue') {
      // Cheerful chime (C5 -> G5)
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.15);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.35);
    } else if (type === 'warn' || type === 'grey' || type === 'red') {
      // Lower warning chime
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(329.63, now); // E4
      osc.frequency.exponentialRampToValueAtTime(261.63, now + 0.2); // C4
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    } else if (type === 'pop') {
      // Short tap
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, now);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.start(now);
      osc.stop(now + 0.08);
    } else if (type === 'correct') {
      // Game correct fanfare
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2);
      gain2.connect(ctx.destination);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.setValueAtTime(659.25, now + 0.1);
      osc.frequency.setValueAtTime(783.99, now + 0.2);

      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

      osc.start(now);
      osc.stop(now + 0.4);
    }
  } catch (e) {
    console.warn('Audio play error:', e);
  }
}

// ----------------------------------------------------
// Text-To-Speech (SpeechSynthesis)
// ----------------------------------------------------
function speakWasteResult(item, dustbin) {
  if (!('speechSynthesis' in window)) return;

  window.speechSynthesis.cancel(); // Stop any pending speech

  const text = `${item.name}. Place in the ${dustbin.name}. ${item.recyclabilityStatus}. ${item.preparationTip}`;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.0;
  utterance.pitch = 1.0;

  // Prefer natural English voice
  const voices = window.speechSynthesis.getVoices();
  const naturalVoice = voices.find(v => v.lang.startsWith('en') && (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Samantha')));
  if (naturalVoice) utterance.voice = naturalVoice;

  window.speechSynthesis.speak(utterance);
}

// ----------------------------------------------------
// Voice Search (SpeechRecognition)
// ----------------------------------------------------
function initVoiceSearch(onResult, onStatusChange) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    if (onStatusChange) onStatusChange('unsupported', 'Voice recognition is not supported in this browser.');
    return null;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = 'en-US';

  recognition.onstart = () => {
    isRecognizing = true;
    if (onStatusChange) onStatusChange('listening', 'Listening... speak the waste item name (e.g., "Plastic Bottle")');
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    isRecognizing = false;
    if (onStatusChange) onStatusChange('result', transcript);
    if (onResult) onResult(transcript);
  };

  recognition.onerror = (event) => {
    isRecognizing = false;
    if (onStatusChange) onStatusChange('error', 'Voice error: ' + event.error);
  };

  recognition.onend = () => {
    isRecognizing = false;
    if (onStatusChange) onStatusChange('idle', '');
  };

  return {
    start: () => {
      try {
        if (!isRecognizing) recognition.start();
      } catch (e) {
        console.warn(e);
      }
    },
    stop: () => {
      try {
        if (isRecognizing) recognition.stop();
      } catch (e) {
        console.warn(e);
      }
    },
    isListening: () => isRecognizing
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { playSound, speakWasteResult, initVoiceSearch };
}
