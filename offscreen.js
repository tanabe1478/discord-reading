const speechQueue = [];
let isSpeechInProgress = false;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object" || message.target !== "offscreen") {
    return false;
  }

  if (message.type === "enqueue-speech") {
    enqueueSpeech(message.payload);
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "stop-speech") {
    stopSpeech();
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

function enqueueSpeech(payload) {
  if (!payload || typeof payload.spokenText !== "string") {
    return;
  }

  const spokenText = payload.spokenText.trim();
  if (!spokenText) {
    return;
  }

  speechQueue.push({
    spokenText,
    voiceURI: typeof payload.voiceURI === "string" ? payload.voiceURI : "",
    rate: clampNumber(payload.rate, 0.5, 2, 1),
    pitch: clampNumber(payload.pitch, 0, 2, 1),
    volume: clampNumber(payload.volume, 0, 1, 1)
  });

  processSpeechQueue();
}

function processSpeechQueue() {
  if (isSpeechInProgress || !speechQueue.length) {
    return;
  }

  const next = speechQueue.shift();
  if (!next) {
    return;
  }

  isSpeechInProgress = true;
  const utterance = new SpeechSynthesisUtterance(next.spokenText);
  utterance.rate = next.rate;
  utterance.pitch = next.pitch;
  utterance.volume = next.volume;

  if (next.voiceURI) {
    const voice = speechSynthesis.getVoices().find(
      (item) => item.voiceURI === next.voiceURI
    );
    if (voice) {
      utterance.voice = voice;
    }
  }

  utterance.onstart = () => {};
  utterance.onend = () => {
    isSpeechInProgress = false;
    processSpeechQueue();
  };
  utterance.onerror = () => {
    isSpeechInProgress = false;
    processSpeechQueue();
  };

  try {
    speechSynthesis.resume();
  } catch (_error) {
    // Ignore and continue to speak normally.
  }

  speechSynthesis.speak(utterance);
}

function stopSpeech() {
  speechQueue.length = 0;
  isSpeechInProgress = false;
  speechSynthesis.cancel();
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numeric));
}
