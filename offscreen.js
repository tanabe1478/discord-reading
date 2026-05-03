const speechQueue = [];
let isSpeechInProgress = false;
let currentAudio = null;
const Core = globalThis.DiscordChatReaderCore || {};
const VOICEVOX_FETCH_TIMEOUT_MS = 4000;

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
    speechEngine: normalizeSpeechEngine(payload.speechEngine),
    voicevoxBaseUrl: normalizeVoicevoxBaseUrl(payload.voicevoxBaseUrl),
    voicevoxSpeakerId: normalizeSpeakerId(payload.voicevoxSpeakerId, 3),
    ttsQuestSpeakerId: normalizeSpeakerId(payload.ttsQuestSpeakerId, 3),
    allowExternalTts: Boolean(payload.allowExternalTts),
    builtInAiTextReview: Boolean(payload.builtInAiTextReview),
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
  reviewSpeechTextIfAvailable(next)
    .then((reviewedNext) => playReviewedSpeech(reviewedNext))
    .catch(() => playReviewedSpeech(next));
}

function playReviewedSpeech(next) {
  if (next.speechEngine === "voicevoxLocal") {
    playVoicevoxLocalSpeech(next)
      .then(finishSpeech)
      .catch(() => playBrowserSpeech(next));
    return;
  }

  if (next.speechEngine === "ttsQuest" && next.allowExternalTts) {
    playTtsQuestSpeech(next).then(finishSpeech).catch(finishSpeech);
    return;
  }

  playBrowserSpeech(next);
}

async function reviewSpeechTextIfAvailable(next) {
  if (!next.builtInAiTextReview || typeof LanguageModel === "undefined") {
    return next;
  }

  const languageModelOptions = {
    temperature: 0,
    topK: 1
  };
  const availability = await LanguageModel.availability(languageModelOptions);
  if (availability !== "available") {
    return next;
  }

  const session = await LanguageModel.create(languageModelOptions);

  try {
    const response = await session.prompt(
      [
        "あなたはDiscord読み上げ前の最終チェックを行う校正器です。",
        "入力文の意味を変えず、読み上げに不要なメタ情報、URL残骸、重複、明らかな抽出ノイズだけを除去または補正してください。",
        "推測で情報を足さないでください。人名、本文、絵文字名は保持してください。",
        "返答は必ずJSONだけにしてください。",
        '{"ok":true,"text":"補正後の読み上げ文","reason":"短い理由"}',
        "",
        `入力文: ${next.spokenText}`
      ].join("\n")
    );
    const parsed = parseBuiltInAiReviewResponse(response);
    if (!parsed?.ok || !shouldAcceptAiReviewedText(next.spokenText, parsed.text)) {
      return next;
    }

    return {
      ...next,
      spokenText: parsed.text
    };
  } finally {
    if (typeof session.destroy === "function") {
      session.destroy();
    }
  }
}

function playBrowserSpeech(next) {
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
  utterance.onend = finishSpeech;
  utterance.onerror = finishSpeech;

  try {
    speechSynthesis.resume();
  } catch (_error) {
    // Ignore and continue to speak normally.
  }

  speechSynthesis.speak(utterance);
}

async function playVoicevoxLocalSpeech(next) {
  const queryResponse = await fetchWithTimeout(
    buildVoicevoxAudioQueryUrl(
      next.voicevoxBaseUrl,
      next.spokenText,
      next.voicevoxSpeakerId
    ),
    { method: "POST" },
    VOICEVOX_FETCH_TIMEOUT_MS
  );
  if (!queryResponse.ok) {
    throw new Error(`voicevox-audio-query-${queryResponse.status}`);
  }

  const query = applyVoicevoxAudioSettings(await queryResponse.json(), next);
  const synthesisResponse = await fetchWithTimeout(
    buildVoicevoxSynthesisUrl(next.voicevoxBaseUrl, next.voicevoxSpeakerId),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(query)
    },
    VOICEVOX_FETCH_TIMEOUT_MS
  );
  if (!synthesisResponse.ok) {
    throw new Error(`voicevox-synthesis-${synthesisResponse.status}`);
  }

  await playAudioBlob(await synthesisResponse.blob(), next.volume);
}

async function playTtsQuestSpeech(next) {
  const synthesisResponse = await fetch(
    buildTtsQuestSynthesisUrl(next.spokenText, next.ttsQuestSpeakerId),
    { method: "POST" }
  );
  if (!synthesisResponse.ok) {
    throw new Error(`tts-quest-synthesis-${synthesisResponse.status}`);
  }

  const result = await synthesisResponse.json();
  if (!result?.success) {
    throw new Error(result?.errorMessage || "tts-quest-failed");
  }

  if (result.mp3StreamingUrl) {
    await playAudioUrl(result.mp3StreamingUrl, next.volume);
    return;
  }

  await waitForTtsQuestAudio(result.audioStatusUrl);
  await playAudioUrl(result.mp3DownloadUrl, next.volume);
}

async function waitForTtsQuestAudio(statusUrl) {
  if (!statusUrl) {
    return;
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const statusResponse = await fetch(statusUrl);
    if (statusResponse.ok) {
      const status = await statusResponse.json();
      if (status?.isAudioReady) {
        return;
      }
      if (status?.isAudioError) {
        throw new Error("tts-quest-audio-error");
      }
    }

    await sleep(750);
  }

  throw new Error("tts-quest-timeout");
}

async function playAudioBlob(blob, volume) {
  const audioUrl = URL.createObjectURL(blob);
  try {
    await playAudioUrl(audioUrl, volume);
  } finally {
    URL.revokeObjectURL(audioUrl);
  }
}

function playAudioUrl(audioUrl, volume) {
  return new Promise((resolve, reject) => {
    const audio = new Audio(audioUrl);
    currentAudio = audio;
    audio.volume = clampNumber(volume, 0, 1, 1);
    audio.onended = () => {
      currentAudio = null;
      resolve();
    };
    audio.onerror = () => {
      currentAudio = null;
      reject(new Error("audio-playback-failed"));
    };
    const playResult = audio.play();
    if (playResult && typeof playResult.catch === "function") {
      playResult.catch((error) => {
        currentAudio = null;
        reject(error);
      });
    }
  });
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function finishSpeech() {
  isSpeechInProgress = false;
  processSpeechQueue();
}

function stopSpeech() {
  speechQueue.length = 0;
  isSpeechInProgress = false;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = "";
    currentAudio = null;
  }
  speechSynthesis.cancel();
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numeric));
}

function normalizeSpeechEngine(value) {
  if (typeof Core.normalizeSpeechEngine === "function") {
    return Core.normalizeSpeechEngine(value);
  }

  return value === "voicevoxLocal" || value === "ttsQuest" ? value : "browser";
}

function normalizeVoicevoxBaseUrl(value) {
  if (typeof Core.normalizeVoicevoxBaseUrl === "function") {
    return Core.normalizeVoicevoxBaseUrl(value);
  }

  return String(value || "http://127.0.0.1:50021").replace(/\/+$/g, "");
}

function normalizeSpeakerId(value, fallback) {
  if (typeof Core.normalizeSpeakerId === "function") {
    return Core.normalizeSpeakerId(value, fallback);
  }

  const numeric = Number.parseInt(value, 10);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

function buildVoicevoxAudioQueryUrl(baseUrl, text, speakerId) {
  return Core.buildVoicevoxAudioQueryUrl(baseUrl, text, speakerId);
}

function buildVoicevoxSynthesisUrl(baseUrl, speakerId) {
  return Core.buildVoicevoxSynthesisUrl(baseUrl, speakerId);
}

function buildTtsQuestSynthesisUrl(text, speakerId) {
  return Core.buildTtsQuestSynthesisUrl(text, speakerId);
}

function applyVoicevoxAudioSettings(query, settings) {
  return Core.applyVoicevoxAudioSettings(query, settings);
}

function parseBuiltInAiReviewResponse(value) {
  if (typeof Core.parseBuiltInAiReviewResponse === "function") {
    return Core.parseBuiltInAiReviewResponse(value);
  }

  return null;
}

function shouldAcceptAiReviewedText(originalText, reviewedText) {
  if (typeof Core.shouldAcceptAiReviewedText === "function") {
    return Core.shouldAcceptAiReviewedText(originalText, reviewedText);
  }

  return Boolean(originalText && reviewedText);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
