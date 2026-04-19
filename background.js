const DEFAULT_SETTINGS = {
  enabled: true
};
const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
let creatingOffscreenDocument = null;

initialize();

chrome.runtime.onInstalled.addListener(() => {
  initialize();
});

chrome.runtime.onStartup.addListener(() => {
  initialize();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync" || !changes.enabled) {
    return;
  }

  updateBadge(Boolean(changes.enabled.newValue));
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-reader") {
    return;
  }

  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const nextEnabled = !settings.enabled;
  await chrome.storage.sync.set({ enabled: nextEnabled });
  updateBadge(nextEnabled);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return false;
  }

  if (message.type === "enqueue-speech") {
    handleEnqueueSpeech(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        console.error("Failed to enqueue speech.", error);
        sendResponse({
          ok: false,
          reason: error instanceof Error ? error.message : "unknown-error"
        });
      });
    return true;
  }

  if (message.type === "stop-speech") {
    handleStopSpeech()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        console.error("Failed to stop speech.", error);
        sendResponse({
          ok: false,
          reason: error instanceof Error ? error.message : "unknown-error"
        });
      });
    return true;
  }

  return false;
});

async function initialize() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  updateBadge(Boolean(settings.enabled));
}

function updateBadge(enabled) {
  chrome.action.setBadgeText({
    text: enabled ? "ON" : "OFF"
  });
  chrome.action.setBadgeBackgroundColor({
    color: enabled ? "#1f9d55" : "#6b7280"
  });
  chrome.action.setTitle({
    title: enabled
      ? "Discord Chat Reader: ON"
      : "Discord Chat Reader: OFF"
  });
}

async function handleEnqueueSpeech(payload) {
  await ensureOffscreenDocument();
  await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "enqueue-speech",
    payload
  });
}

async function handleStopSpeech() {
  const hasDocument = await hasOffscreenDocument();
  if (!hasDocument) {
    return;
  }

  await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "stop-speech"
  });
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) {
    return;
  }

  if (!creatingOffscreenDocument) {
    creatingOffscreenDocument = chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Play queued Discord chat speech while the tab is in the background."
    }).finally(() => {
      creatingOffscreenDocument = null;
    });
  }

  await creatingOffscreenDocument;
}

async function hasOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);

  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl]
    });
    return contexts.length > 0;
  }

  const matchedClients = await clients.matchAll();
  return matchedClients.some((client) => client.url === offscreenUrl);
}
