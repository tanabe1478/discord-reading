const Core = globalThis.DiscordChatReaderCore || {};
const DEFAULT_SETTINGS = {
  enabled: true,
  includeAuthor: true,
  filterMetadata: true,
  filterLinks: true,
  debugMode: false,
  skipOwnMessages: false,
  rate: 1,
  pitch: 1,
  volume: 1,
  voiceURI: "",
  speechEngine: "browser",
  voicevoxBaseUrl: "http://127.0.0.1:50021",
  voicevoxSpeakerId: 3,
  ttsQuestSpeakerId: 3,
  allowExternalTts: false,
  builtInAiTextReview: false,
  ...(Core.DEFAULT_SETTINGS || {})
};
const PERFORMANCE_SETTINGS_URL = "chrome://settings/performance";
const MEMORY_SAVER_HELP_URL = "https://support.google.com/chrome/answer/12929150?hl=ja";
const VOICEVOX_FETCH_TIMEOUT_MS = 4000;

const elements = {
  toggleEnabled: document.getElementById("toggleEnabled"),
  enabled: document.getElementById("enabled"),
  includeAuthor: document.getElementById("includeAuthor"),
  filterMetadata: document.getElementById("filterMetadata"),
  filterLinks: document.getElementById("filterLinks"),
  debugMode: document.getElementById("debugMode"),
  skipOwnMessages: document.getElementById("skipOwnMessages"),
  builtInAiTextReview: document.getElementById("builtInAiTextReview"),
  speechEngine: document.getElementById("speechEngine"),
  voiceURI: document.getElementById("voiceURI"),
  voicevoxBaseUrl: document.getElementById("voicevoxBaseUrl"),
  voicevoxSpeakerId: document.getElementById("voicevoxSpeakerId"),
  ttsQuestSpeakerId: document.getElementById("ttsQuestSpeakerId"),
  allowExternalTts: document.getElementById("allowExternalTts"),
  rate: document.getElementById("rate"),
  pitch: document.getElementById("pitch"),
  volume: document.getElementById("volume"),
  rateValue: document.getElementById("rateValue"),
  pitchValue: document.getElementById("pitchValue"),
  volumeValue: document.getElementById("volumeValue"),
  testSpeech: document.getElementById("testSpeech"),
  readLatestMessage: document.getElementById("readLatestMessage"),
  openPerformanceSettings: document.getElementById("openPerformanceSettings"),
  openMemorySaverHelp: document.getElementById("openMemorySaverHelp"),
  status: document.getElementById("status"),
  browserVoiceField: document.querySelector(".browserVoiceField"),
  voicevoxSettings: document.querySelector(".voicevoxSettings"),
  ttsQuestSettings: document.querySelector(".ttsQuestSettings")
};

init();

async function init() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  renderVoices(settings.voiceURI);
  await renderVoicevoxSpeakers(settings);
  applySettings(settings);
  bindEvents();

  if (typeof speechSynthesis !== "undefined") {
    speechSynthesis.addEventListener("voiceschanged", async () => {
      const current = await chrome.storage.sync.get(DEFAULT_SETTINGS);
      renderVoices(current.voiceURI);
    });
  }
}

function bindEvents() {
  for (const [key, element] of Object.entries(elements)) {
    if (
      !element ||
      key.endsWith("Value") ||
      key === "status" ||
      key === "browserVoiceField" ||
      key === "voicevoxSettings" ||
      key === "ttsQuestSettings"
    ) {
      continue;
    }

    if (key === "toggleEnabled") {
      element.addEventListener("click", toggleEnabledState);
      continue;
    }

    if (key === "testSpeech") {
      element.addEventListener("click", playTestSpeech);
      continue;
    }

    if (key === "readLatestMessage") {
      element.addEventListener("click", requestLatestMessageRead);
      continue;
    }

    if (key === "openPerformanceSettings") {
      element.addEventListener("click", openPerformanceSettings);
      continue;
    }

    if (key === "openMemorySaverHelp") {
      element.addEventListener("click", openMemorySaverHelp);
      continue;
    }

    if (key === "speechEngine") {
      element.addEventListener("change", async () => {
        updateEngineVisibility();
        await saveSettings();
      });
      continue;
    }

    if (key === "voicevoxBaseUrl") {
      element.addEventListener("change", async () => {
        await saveSettings();
        await renderVoicevoxSpeakers(await chrome.storage.sync.get(DEFAULT_SETTINGS));
      });
      continue;
    }

    element.addEventListener("input", saveSettings);
    element.addEventListener("change", saveSettings);
  }
}

function applySettings(settings) {
  elements.enabled.checked = Boolean(settings.enabled);
  elements.includeAuthor.checked = Boolean(settings.includeAuthor);
  elements.filterMetadata.checked = Boolean(settings.filterMetadata);
  elements.filterLinks.checked = Boolean(settings.filterLinks);
  elements.debugMode.checked = Boolean(settings.debugMode);
  elements.skipOwnMessages.checked = Boolean(settings.skipOwnMessages);
  elements.builtInAiTextReview.checked = Boolean(settings.builtInAiTextReview);
  elements.speechEngine.value = normalizeSpeechEngine(settings.speechEngine);
  elements.voiceURI.value = settings.voiceURI || "";
  elements.voicevoxBaseUrl.value = normalizeVoicevoxBaseUrl(settings.voicevoxBaseUrl);
  elements.voicevoxSpeakerId.value = String(normalizeSpeakerId(settings.voicevoxSpeakerId, 3));
  elements.ttsQuestSpeakerId.value = String(normalizeSpeakerId(settings.ttsQuestSpeakerId, 3));
  elements.allowExternalTts.checked = Boolean(settings.allowExternalTts);
  elements.rate.value = String(settings.rate);
  elements.pitch.value = String(settings.pitch);
  elements.volume.value = String(settings.volume);
  updateOutputs();
  updateToggleButton();
  updateEngineVisibility();
}

function renderVoices(selectedVoiceURI) {
  const voices = typeof speechSynthesis === "undefined"
    ? []
    : speechSynthesis.getVoices();

  elements.voiceURI.innerHTML = "";

  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "ブラウザ既定の音声";
  elements.voiceURI.appendChild(defaultOption);

  for (const voice of voices) {
    const option = document.createElement("option");
    option.value = voice.voiceURI;
    option.textContent = `${voice.name} (${voice.lang})`;
    if (voice.voiceURI === selectedVoiceURI) {
      option.selected = true;
    }
    elements.voiceURI.appendChild(option);
  }
}

async function renderVoicevoxSpeakers(settings) {
  const selectedSpeakerId = normalizeSpeakerId(settings.voicevoxSpeakerId, 3);
  const baseUrl = normalizeVoicevoxBaseUrl(settings.voicevoxBaseUrl);
  elements.voicevoxSpeakerId.innerHTML = "";

  const fallbackOption = document.createElement("option");
  fallbackOption.value = String(selectedSpeakerId);
  fallbackOption.textContent = `話者ID ${selectedSpeakerId}`;
  elements.voicevoxSpeakerId.appendChild(fallbackOption);

  try {
    const response = await fetchWithTimeout(
      buildVoicevoxSpeakersUrl(baseUrl),
      {},
      VOICEVOX_FETCH_TIMEOUT_MS
    );
    if (!response.ok) {
      return;
    }

    const speakers = await response.json();
    elements.voicevoxSpeakerId.innerHTML = "";
    for (const speaker of speakers) {
      for (const style of speaker.styles || []) {
        const option = document.createElement("option");
        option.value = String(style.id);
        option.textContent = `${speaker.name}（${style.name}）`;
        option.selected = style.id === selectedSpeakerId;
        elements.voicevoxSpeakerId.appendChild(option);
      }
    }

    if (!elements.voicevoxSpeakerId.value) {
      fallbackOption.selected = true;
      elements.voicevoxSpeakerId.appendChild(fallbackOption);
    }
  } catch (_error) {
    // VOICEVOX Engine may not be running yet. Keep the saved speaker id usable.
  }
}

async function saveSettings() {
  const nextSettings = {
    enabled: elements.enabled.checked,
    includeAuthor: elements.includeAuthor.checked,
    filterMetadata: elements.filterMetadata.checked,
    filterLinks: elements.filterLinks.checked,
    debugMode: elements.debugMode.checked,
    skipOwnMessages: elements.skipOwnMessages.checked,
    builtInAiTextReview: elements.builtInAiTextReview.checked,
    speechEngine: normalizeSpeechEngine(elements.speechEngine.value),
    voiceURI: elements.voiceURI.value,
    voicevoxBaseUrl: normalizeVoicevoxBaseUrl(elements.voicevoxBaseUrl.value),
    voicevoxSpeakerId: normalizeSpeakerId(elements.voicevoxSpeakerId.value, 3),
    ttsQuestSpeakerId: normalizeSpeakerId(elements.ttsQuestSpeakerId.value, 3),
    allowExternalTts: elements.allowExternalTts.checked,
    rate: Number(elements.rate.value),
    pitch: Number(elements.pitch.value),
    volume: Number(elements.volume.value)
  };

  updateOutputs();
  updateToggleButton();
  updateEngineVisibility();
  await chrome.storage.sync.set(nextSettings);
}

function updateOutputs() {
  elements.rateValue.value = Number(elements.rate.value).toFixed(1);
  elements.pitchValue.value = Number(elements.pitch.value).toFixed(1);
  elements.volumeValue.value = Number(elements.volume.value).toFixed(1);
}

function updateToggleButton() {
  const enabled = elements.enabled.checked;
  elements.toggleEnabled.textContent = enabled
    ? "読み上げを OFF にする"
    : "読み上げを ON にする";
  elements.toggleEnabled.classList.toggle("off", !enabled);
}

function updateEngineVisibility() {
  const engine = normalizeSpeechEngine(elements.speechEngine.value);
  elements.browserVoiceField.classList.toggle("hidden", engine !== "browser");
  elements.voicevoxSettings.classList.toggle("active", engine === "voicevoxLocal");
  elements.ttsQuestSettings.classList.toggle("active", engine === "ttsQuest");
}

async function playTestSpeech() {
  await saveSettings();
  const spokenText = "Discord Chat Reader のテストです。新着メッセージを読み上げます。";
  const engine = normalizeSpeechEngine(elements.speechEngine.value);

  if (engine === "voicevoxLocal" || engine === "ttsQuest") {
    await playTestSpeechThroughOffscreen(spokenText);
    return;
  }

  if (typeof speechSynthesis === "undefined") {
    setStatus("この環境では音声読み上げ API が使えません。");
    return;
  }

  speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(spokenText);
  utterance.rate = Number(elements.rate.value);
  utterance.pitch = Number(elements.pitch.value);
  utterance.volume = Number(elements.volume.value);

  if (elements.voiceURI.value) {
    const voice = speechSynthesis
      .getVoices()
      .find((item) => item.voiceURI === elements.voiceURI.value);
    if (voice) {
      utterance.voice = voice;
    }
  }

  utterance.onstart = () => setStatus("テスト読み上げを再生中です。");
  utterance.onend = () => setStatus("テスト読み上げが終了しました。");
  utterance.onerror = (event) => {
    setStatus(`テスト読み上げに失敗しました: ${event.error || "unknown"}`);
  };

  speechSynthesis.speak(utterance);
}

async function playTestSpeechThroughOffscreen(spokenText) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "enqueue-speech",
      payload: {
        spokenText,
        voiceURI: elements.voiceURI.value,
        speechEngine: normalizeSpeechEngine(elements.speechEngine.value),
        voicevoxBaseUrl: normalizeVoicevoxBaseUrl(elements.voicevoxBaseUrl.value),
        voicevoxSpeakerId: normalizeSpeakerId(elements.voicevoxSpeakerId.value, 3),
        ttsQuestSpeakerId: normalizeSpeakerId(elements.ttsQuestSpeakerId.value, 3),
        allowExternalTts: elements.allowExternalTts.checked,
        builtInAiTextReview: elements.builtInAiTextReview.checked,
        rate: Number(elements.rate.value),
        pitch: Number(elements.pitch.value),
        volume: Number(elements.volume.value)
      }
    });

    if (response?.ok) {
      setStatus("テスト読み上げをキューに追加しました。");
      return;
    }

    setStatus(response?.reason || "テスト読み上げに失敗しました。");
  } catch (error) {
    setStatus(`テスト読み上げに失敗しました: ${error.message || "unknown"}`);
  }
}

function setStatus(message) {
  elements.status.textContent = message;
}

async function requestLatestMessageRead() {
  await saveSettings();

  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!activeTab?.id) {
    setStatus("現在のタブを取得できませんでした。");
    return;
  }

  if (!activeTab.url?.includes("discord.com/")) {
    setStatus("Discord のタブを前面に開いてから試してください。");
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(activeTab.id, {
      type: "read-latest-message"
    });

    if (!response?.ok) {
      setStatus(response?.reason || "最新メッセージの読み上げに失敗しました。");
      return;
    }

    setStatus(`最新メッセージを読み上げました: ${response.spokenText}`);
  } catch (_error) {
    setStatus("Discord タブに拡張が反映されていません。タブを再読み込みしてください。");
  }
}

async function toggleEnabledState() {
  elements.enabled.checked = !elements.enabled.checked;
  await saveSettings();
  setStatus(
    elements.enabled.checked
      ? "読み上げを ON にしました。"
      : "読み上げを OFF にしました。"
  );
}

async function openPerformanceSettings() {
  try {
    await chrome.tabs.create({
      url: PERFORMANCE_SETTINGS_URL
    });
    setStatus("Performance 設定を開きました。discord.com を常にアクティブに追加してください。");
  } catch (_error) {
    setStatus("Performance 設定を開けませんでした。Chrome の設定 > パフォーマンス から開いてください。");
  }
}

async function openMemorySaverHelp() {
  await chrome.tabs.create({
    url: MEMORY_SAVER_HELP_URL
  });
  setStatus("Memory Saver の手順ページを開きました。");
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

function buildVoicevoxSpeakersUrl(baseUrl) {
  if (typeof Core.buildVoicevoxSpeakersUrl === "function") {
    return Core.buildVoicevoxSpeakersUrl(baseUrl);
  }

  return `${normalizeVoicevoxBaseUrl(baseUrl)}/speakers`;
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
