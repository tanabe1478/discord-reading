const DEFAULT_SETTINGS = {
  enabled: true
};

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
