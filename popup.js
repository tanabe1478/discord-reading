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
  voiceURI: ""
};

const elements = {
  toggleEnabled: document.getElementById("toggleEnabled"),
  enabled: document.getElementById("enabled"),
  includeAuthor: document.getElementById("includeAuthor"),
  filterMetadata: document.getElementById("filterMetadata"),
  filterLinks: document.getElementById("filterLinks"),
  debugMode: document.getElementById("debugMode"),
  skipOwnMessages: document.getElementById("skipOwnMessages"),
  voiceURI: document.getElementById("voiceURI"),
  rate: document.getElementById("rate"),
  pitch: document.getElementById("pitch"),
  volume: document.getElementById("volume"),
  rateValue: document.getElementById("rateValue"),
  pitchValue: document.getElementById("pitchValue"),
  volumeValue: document.getElementById("volumeValue"),
  testSpeech: document.getElementById("testSpeech"),
  readLatestMessage: document.getElementById("readLatestMessage"),
  status: document.getElementById("status")
};

init();

async function init() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  renderVoices(settings.voiceURI);
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
    if (!element || key.endsWith("Value") || key === "status") {
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
  elements.voiceURI.value = settings.voiceURI || "";
  elements.rate.value = String(settings.rate);
  elements.pitch.value = String(settings.pitch);
  elements.volume.value = String(settings.volume);
  updateOutputs();
  updateToggleButton();
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

async function saveSettings() {
  const nextSettings = {
    enabled: elements.enabled.checked,
    includeAuthor: elements.includeAuthor.checked,
    filterMetadata: elements.filterMetadata.checked,
    filterLinks: elements.filterLinks.checked,
    debugMode: elements.debugMode.checked,
    skipOwnMessages: elements.skipOwnMessages.checked,
    voiceURI: elements.voiceURI.value,
    rate: Number(elements.rate.value),
    pitch: Number(elements.pitch.value),
    volume: Number(elements.volume.value)
  };

  updateOutputs();
  updateToggleButton();
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

async function playTestSpeech() {
  await saveSettings();

  if (typeof speechSynthesis === "undefined") {
    setStatus("この環境では音声読み上げ API が使えません。");
    return;
  }

  speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(
    "Discord Chat Reader のテストです。新着メッセージを読み上げます。"
  );
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
