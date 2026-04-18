const DEFAULT_SETTINGS = {
  enabled: true,
  includeAuthor: true,
  filterMetadata: true,
  filterLinks: true,
  debugMode: false,
  rate: 1,
  pitch: 1,
  volume: 1,
  voiceURI: "",
  skipOwnMessages: false
};

const TEXT_SANITIZE_SELECTORS = [
  "time",
  "[class*='timestamp']",
  "[class*='hiddenVisually']",
  "[class*='edited']",
  "[aria-hidden='true']"
].join(",");
const LINK_SANITIZE_SELECTOR = "a[href]";
const MESSAGE_ROOT_SELECTOR = "li[id^='chat-messages-']";
const DUPLICATE_SUPPRESS_MS = 15000;
const PAGE_INIT_ATTR = "data-discord-chat-reader-active";
const MESSAGE_SIGNATURE_ATTR = "data-discord-chat-reader-signature";
const MESSAGE_SPOKEN_AT_ATTR = "data-discord-chat-reader-spoken-at";
const MESSAGE_PENDING_ATTR = "data-discord-chat-reader-pending";
const PAGE_SPEECH_SIGNATURE_ATTR = "data-discord-chat-reader-page-signature";
const PAGE_SPEECH_AT_ATTR = "data-discord-chat-reader-page-spoken-at";
const LATEST_POLL_MS = 500;

let settings = { ...DEFAULT_SETTINGS };
const pendingMessageIds = new Set();
const recentSpeechSignatures = new Map();
let lastKnownLocation = location.href;
let lastObservedLatestMessageId = "";
let latestPollIntervalId = null;
let speechQueue = [];
let isSpeechInProgress = false;

if (window.__discordChatReaderInitialized) {
  console.debug("Discord Chat Reader is already initialized on this page.");
} else {
  if (document.documentElement.hasAttribute(PAGE_INIT_ATTR)) {
    console.debug("Discord Chat Reader is already attached to this page.");
  } else {
    document.documentElement.setAttribute(PAGE_INIT_ATTR, "1");
    window.__discordChatReaderInitialized = true;
    boot();
  }
}

async function boot() {
  settings = await loadSettings();
  logDebug("boot", {
    href: location.href,
    debugMode: settings.debugMode
  });
  syncCurrentLatestMessage();
  startLatestMessagePoll();
  window.addEventListener("beforeunload", stopSpeaking);
  chrome.storage.onChanged.addListener(handleStorageChange);
  chrome.runtime.onMessage.addListener(handleRuntimeMessage);
  window.addEventListener("popstate", scheduleRescan);
  window.addEventListener("hashchange", scheduleRescan);

  // Discord is an SPA. Re-prime only when the URL actually changes.
  setInterval(() => {
    if (location.href === lastKnownLocation) {
      return;
    }

    lastKnownLocation = location.href;
    scheduleRescan();
  }, 1000);
}

async function loadSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

function handleStorageChange(changes, areaName) {
  if (areaName !== "sync") {
    return;
  }

  for (const [key, change] of Object.entries(changes)) {
    settings[key] = change.newValue;
  }

  if (Object.hasOwn(changes, "enabled") && !changes.enabled.newValue) {
    stopSpeaking();
  }

  if (Object.hasOwn(changes, "debugMode")) {
    logDebug("debug-mode-changed", {
      enabled: Boolean(changes.debugMode.newValue)
    });
  }
}

function handleRuntimeMessage(message, _sender, sendResponse) {
  if (!message || typeof message !== "object") {
    return;
  }

  if (message.type === "read-latest-message") {
    logDebug("manual-read-requested", {
      href: location.href
    });
    const result = readLatestMessage();
    sendResponse(result);
  }
}

function scheduleRescan() {
  window.setTimeout(syncCurrentLatestMessage, 300);
}

function startLatestMessagePoll() {
  if (latestPollIntervalId) {
    clearInterval(latestPollIntervalId);
  }

  latestPollIntervalId = window.setInterval(() => {
    const latestElement = findLatestMessageElement();
    if (!latestElement) {
      return;
    }

    const messageId = getMessageId(latestElement);
    if (!messageId || messageId === lastObservedLatestMessageId) {
      return;
    }

    logDebug("latest-message-detected", {
      previousMessageId: lastObservedLatestMessageId,
      nextMessageId: messageId
    });
    lastObservedLatestMessageId = messageId;
    maybeReadMessage(latestElement);
  }, LATEST_POLL_MS);
}

function syncCurrentLatestMessage() {
  const latestElement = findLatestMessageElement();
  lastObservedLatestMessageId = getMessageId(latestElement);
}

function findMessageElements(root) {
  if (!(root instanceof HTMLElement || root instanceof Document)) {
    return [];
  }

  return Array.from(
    root.querySelectorAll(MESSAGE_ROOT_SELECTOR)
  );
}

function findLatestMessageElement() {
  const elements = findMessageElements(document.body);
  return elements.at(-1) || null;
}

function getMessageId(node) {
  if (!(node instanceof HTMLElement)) {
    return "";
  }

  const root = node.matches(MESSAGE_ROOT_SELECTOR)
    ? node
    : node.closest(MESSAGE_ROOT_SELECTOR);

  if (!root) {
    return "";
  }

  return normalizeMessageId(root.id || "");
}

function maybeReadMessage(messageElement) {
  if (!settings.enabled) {
    logDebug("skip-disabled", {
      messageId: getMessageId(messageElement)
    });
    return;
  }

  const messageId = getMessageId(messageElement);
  if (!messageId || pendingMessageIds.has(messageId)) {
    logDebug("skip-missing-or-pending", {
      messageId
    });
    return;
  }

  if (isPendingMessage(messageElement, messageId)) {
    logDebug("skip-dom-pending", {
      messageId
    });
    return;
  }

  markMessagePending(messageElement, messageId);
  tryReadMessage(messageElement, messageId, 0);
}

function tryReadMessage(messageElement, messageId, attempt) {
  const message = extractMessage(messageElement);
  if (!message) {
    if (attempt >= 5) {
      logDebug("extract-failed-final", {
        messageId,
        attempt
      });
      clearMessagePending(messageElement, messageId);
      return;
    }

    logDebug("extract-failed-retry", {
      messageId,
      attempt
    });
    pendingMessageIds.add(messageId);
    window.setTimeout(() => {
      pendingMessageIds.delete(messageId);
      const latestElement = findMessageElementById(messageId);
      if (latestElement) {
        tryReadMessage(latestElement, messageId, attempt + 1);
      } else {
        clearMessagePending(messageElement, messageId);
      }
    }, 250);
    return;
  }

  if (getMessageId(findLatestMessageElement()) !== messageId) {
    logDebug("skip-not-latest", {
      messageId,
      latestMessageId: getMessageId(findLatestMessageElement())
    });
    clearMessagePending(messageElement, messageId);
    return;
  }

  if (settings.skipOwnMessages && isOwnMessage(messageElement)) {
    logDebug("skip-own-message", {
      messageId
    });
    clearMessagePending(messageElement, messageId);
    return;
  }

  const spokenText = buildSpeechText(message);
  if (shouldSuppressDuplicateSpeech(messageId, spokenText)) {
    logDebug("skip-memory-duplicate", {
      messageId,
      spokenText
    });
    clearMessagePending(messageElement, messageId);
    return;
  }

  if (shouldSuppressDomDuplicateSpeech(messageElement, messageId, spokenText)) {
    logDebug("skip-dom-duplicate", {
      messageId,
      spokenText
    });
    clearMessagePending(messageElement, messageId);
    return;
  }

  if (shouldSuppressPageDuplicateSpeech(messageId, spokenText)) {
    logDebug("skip-page-duplicate", {
      messageId,
      spokenText
    });
    clearMessagePending(messageElement, messageId);
    return;
  }

  clearMessagePending(messageElement, messageId);
  logDebug("speak", {
    messageId,
    spokenText,
    author: message.author
  });
  speakMessage(message);
}

function findMessageElementById(messageId) {
  if (!messageId) {
    return null;
  }

  const directMatch = document.getElementById(messageId);
  if (directMatch) {
    return directMatch;
  }

  return null;
}

function readLatestMessage() {
  const latestElement = findLatestMessageElement();
  if (!latestElement) {
    logDebug("manual-read-failed", {
      reason: "latest-message-not-found"
    });
    return {
      ok: false,
      reason: "メッセージ要素が見つかりませんでした。"
    };
  }

  const messageId = getMessageId(latestElement);
  const message = extractMessage(latestElement);
  if (!message) {
    logDebug("manual-read-failed", {
      reason: "latest-message-extract-failed",
      messageId
    });
    return {
      ok: false,
      reason: "最新メッセージの本文を抽出できませんでした。"
    };
  }

  logDebug("manual-read-speak", {
    messageId,
    spokenText: buildSpeechText(message),
    author: message.author
  });
  speakMessage(message);
  return {
    ok: true,
    spokenText: buildSpeechText(message)
  };
}

function extractMessage(messageElement) {
  const author = extractAuthor(messageElement);

  const textParts = Array.from(
    messageElement.querySelectorAll(
      [
        "[id^='message-content-']",
        "[class*='repliedTextContent']"
      ].join(",")
    ),
    (element) => extractCleanText(element, author)
  ).filter(Boolean);

  const body = textParts.length
    ? normalizeText([...new Set(textParts)].join(" "))
    : extractFallbackBody(messageElement, author);

  if (!body) {
    return null;
  }

  return {
    author,
    body
  };
}

function extractAuthor(messageElement) {
  const inlineAuthor =
    messageElement.querySelector("h3 span[role='button']") ||
    messageElement.querySelector("[id^='message-username-']") ||
    messageElement.querySelector("[class*='username']");

  const directAuthor = normalizeText(inlineAuthor?.textContent || "");
  if (directAuthor) {
    return directAuthor;
  }

  const labelledBy = messageElement.getAttribute("aria-labelledby") || "";
  const usernameId = labelledBy
    .split(/\s+/)
    .find((token) => token.startsWith("message-username-"));

  if (!usernameId) {
    return "";
  }

  const referencedAuthor = document.getElementById(usernameId);
  return normalizeText(referencedAuthor?.textContent || "");
}

function isOwnMessage(messageElement) {
  return Boolean(
    messageElement.querySelector("[aria-label='あなた'], [aria-label='You']") ||
    messageElement.querySelector("[class*='isSending']") ||
    messageElement.querySelector("[class*='replying'] [aria-label='あなた'], [class*='replying'] [aria-label='You']")
  );
}

function extractFallbackBody(messageElement, author) {
  const fallback = sanitizeMessageText(
    normalizeText(messageElement.textContent || ""),
    author
  );
  if (!fallback) {
    return "";
  }

  if (!author || !fallback.startsWith(author)) {
    return fallback;
  }

  return normalizeText(fallback.slice(author.length));
}

function normalizeText(text) {
  return text.replace(/\s+/g, " ").trim();
}

function extractCleanText(element, author) {
  if (!(element instanceof HTMLElement)) {
    return "";
  }

  const clone = element.cloneNode(true);
  for (const removable of clone.querySelectorAll(TEXT_SANITIZE_SELECTORS)) {
    removable.remove();
  }
  if (settings.filterLinks) {
    for (const removable of clone.querySelectorAll(LINK_SANITIZE_SELECTOR)) {
      removable.remove();
    }
  }

  return sanitizeMessageText(normalizeText(clone.textContent || ""), author);
}

function sanitizeMessageText(text, author) {
  let result = normalizeText(text);
  if (!result) {
    return "";
  }

  if (settings.filterMetadata) {
    result = result
      .replace(/\(\s*編集済\s*\)/g, "")
      .replace(/\b\d{4}年\d{1,2}月\d{1,2}日[^ ]*\s+\d{1,2}:\d{2}\b/g, "")
      .replace(/^\[?\d{1,2}:\d{2}\]?\s*/g, "")
      .replace(/\s*\[?\d{1,2}:\d{2}\]?$/g, "")
      .replace(/^\s*[—-]\s*\d{1,2}:\d{2}\s*/g, "")
      .replace(/\s*[—-]\s*\d{1,2}:\d{2}\s*$/g, "");
  }

  if (settings.filterLinks) {
    result = result
      .replace(/\bhttps?:\/\/\S+\b/giu, "")
      .replace(/\b(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}(?:\/\S*)?\b/giu, "");
  }

  if (author) {
    const escapedAuthor = escapeForRegex(author);
    result = result.replace(new RegExp(`^${escapedAuthor}[\\s:：-]+`, "u"), "");
  }

  return normalizeText(result);
}

function normalizeMessageId(value) {
  const text = String(value || "");
  const canonicalMatch = text.match(/chat-messages-\d+-\d+/);
  if (canonicalMatch) {
    return canonicalMatch[0];
  }

  return text;
}

function shouldSuppressDuplicateSpeech(messageId, spokenText) {
  pruneExpiredSpeechSignatures();

  const signature = `${messageId}::${spokenText}`;
  if (recentSpeechSignatures.has(signature)) {
    return true;
  }

  recentSpeechSignatures.set(signature, Date.now());
  return false;
}

function shouldSuppressDomDuplicateSpeech(messageElement, messageId, spokenText) {
  const root = messageElement.matches(MESSAGE_ROOT_SELECTOR)
    ? messageElement
    : messageElement.closest(MESSAGE_ROOT_SELECTOR);

  if (!root) {
    return false;
  }

  const signature = `${messageId}::${spokenText}`;
  const now = Date.now();
  const lastSignature = root.getAttribute(MESSAGE_SIGNATURE_ATTR) || "";
  const lastSpokenAt = Number(root.getAttribute(MESSAGE_SPOKEN_AT_ATTR) || "0");

  if (lastSignature === signature && now - lastSpokenAt < DUPLICATE_SUPPRESS_MS) {
    return true;
  }

  root.setAttribute(MESSAGE_SIGNATURE_ATTR, signature);
  root.setAttribute(MESSAGE_SPOKEN_AT_ATTR, String(now));
  return false;
}

function shouldSuppressPageDuplicateSpeech(messageId, spokenText) {
  const signature = `${messageId}::${spokenText}`;
  const root = document.documentElement;
  const lastSignature = root.getAttribute(PAGE_SPEECH_SIGNATURE_ATTR) || "";
  const lastSpokenAt = Number(root.getAttribute(PAGE_SPEECH_AT_ATTR) || "0");
  const now = Date.now();

  if (lastSignature === signature && now - lastSpokenAt < DUPLICATE_SUPPRESS_MS) {
    return true;
  }

  root.setAttribute(PAGE_SPEECH_SIGNATURE_ATTR, signature);
  root.setAttribute(PAGE_SPEECH_AT_ATTR, String(now));
  return false;
}

function isPendingMessage(messageElement, messageId) {
  const root = getMessageRoot(messageElement);
  if (!root) {
    return false;
  }

  return root.getAttribute(MESSAGE_PENDING_ATTR) === messageId;
}

function markMessagePending(messageElement, messageId) {
  const root = getMessageRoot(messageElement);
  if (!root) {
    return;
  }

  pendingMessageIds.add(messageId);
  root.setAttribute(MESSAGE_PENDING_ATTR, messageId);
}

function clearMessagePending(messageElement, messageId) {
  const root = getMessageRoot(messageElement);
  pendingMessageIds.delete(messageId);
  if (!root) {
    return;
  }

  if (root.getAttribute(MESSAGE_PENDING_ATTR) === messageId) {
    root.removeAttribute(MESSAGE_PENDING_ATTR);
  }
}

function getMessageRoot(messageElement) {
  if (!(messageElement instanceof HTMLElement)) {
    return null;
  }

  return messageElement.matches(MESSAGE_ROOT_SELECTOR)
    ? messageElement
    : messageElement.closest(MESSAGE_ROOT_SELECTOR);
}

function pruneExpiredSpeechSignatures() {
  const now = Date.now();
  for (const [signature, spokenAt] of recentSpeechSignatures.entries()) {
    if (now - spokenAt >= DUPLICATE_SUPPRESS_MS) {
      recentSpeechSignatures.delete(signature);
    }
  }
}

function escapeForAttributeSelector(value) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }

  return value.replace(/["\\]/g, "\\$&");
}

function escapeForRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function speakMessage(message) {
  const spokenText = buildSpeechText(message);
  speechQueue.push(spokenText);
  logDebug("speech-queued", {
    spokenText,
    queueLength: speechQueue.length
  });
  processSpeechQueue();
}

function processSpeechQueue() {
  if (isSpeechInProgress || !speechQueue.length) {
    return;
  }

  const spokenText = speechQueue.shift();
  if (!spokenText) {
    return;
  }

  const utterance = new SpeechSynthesisUtterance(spokenText);
  utterance.rate = clampNumber(settings.rate, 0.5, 2, 1);
  utterance.pitch = clampNumber(settings.pitch, 0, 2, 1);
  utterance.volume = clampNumber(settings.volume, 0, 1, 1);

  if (settings.voiceURI) {
    const voice = speechSynthesis.getVoices().find(
      (item) => item.voiceURI === settings.voiceURI
    );
    if (voice) {
      utterance.voice = voice;
    }
  }

  utterance.onstart = () => {
    isSpeechInProgress = true;
    logDebug("speech-start", {
      spokenText,
      queueLength: speechQueue.length
    });
  };
  utterance.onend = () => {
    isSpeechInProgress = false;
    logDebug("speech-end", {
      spokenText,
      queueLength: speechQueue.length
    });
    processSpeechQueue();
  };
  utterance.onerror = (event) => {
    isSpeechInProgress = false;
    logDebug("speech-error", {
      spokenText,
      error: event.error || "unknown",
      queueLength: speechQueue.length
    });
    processSpeechQueue();
  };

  speechSynthesis.speak(utterance);
}

function buildSpeechText(message) {
  if (settings.includeAuthor && message.author) {
    return `${message.author}. ${message.body}`;
  }

  return message.body;
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numeric));
}

function stopSpeaking() {
  speechQueue = [];
  isSpeechInProgress = false;
  speechSynthesis.cancel();
  logDebug("speech-stop", {});
}

function logDebug(event, payload = {}) {
  if (!settings.debugMode) {
    return;
  }

  console.log("[Discord Chat Reader]", event, payload);
}
