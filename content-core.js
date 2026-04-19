(function initDiscordChatReaderCore(globalScope) {
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

  const DUPLICATE_SUPPRESS_MS = 15000;
  const TEXT_ONLY_DUPLICATE_SUPPRESS_MS = 1500;
  const GLOBAL_TEXT_DUPLICATE_SUPPRESS_MS = 250;
  const NEAR_DUPLICATE_MESSAGE_SUPPRESS_MS = 400;

  function normalizeText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function escapeForRegex(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function normalizeEmojiAlt(altText) {
    const normalized = normalizeText(altText);
    if (!normalized) {
      return "";
    }

    const customEmojiMatch = normalized.match(/^<?a?:([a-z0-9_+-]+):\d+>?$/iu);
    if (customEmojiMatch) {
      return customEmojiMatch[1];
    }

    const shortCodeMatch = normalized.match(/^:([a-z0-9_+-]+):$/iu);
    if (shortCodeMatch) {
      return shortCodeMatch[1];
    }

    return normalized;
  }

  function stripLeadingDecorationText(text) {
    return normalizeText(text)
      .replace(/^(?:\[[^\]]+\]\s*,?\s*)+/u, "")
      .replace(/^(?:<[^>]+>\s*)+/u, "")
      .replace(/^[^—\-]{0,120}\bMember:\s*[^—\-]{0,120}(?:[—\-]\s*)?/iu, "")
      .replace(/^[^—\-]{0,120}\bサブスクライバー:\s*[^—\-]{0,120}(?:[—\-]\s*)?/u, "");
  }

  function normalizeMessageId(value) {
    const text = String(value || "");
    const canonicalMatch = text.match(/chat-messages-\d+-\d+/);
    if (canonicalMatch) {
      return canonicalMatch[0];
    }

    return text;
  }

  function extractMessageOrderId(messageId) {
    const normalized = normalizeMessageId(messageId);
    const match = normalized.match(/chat-messages-\d+-(\d+)$/);
    return match ? match[1] : "";
  }

  function compareOrderIds(left, right) {
    if (!left && !right) {
      return 0;
    }
    if (!left) {
      return -1;
    }
    if (!right) {
      return 1;
    }
    if (left.length !== right.length) {
      return left.length - right.length;
    }
    return left.localeCompare(right);
  }

  function compareMessageOrderItems(left, right) {
    return compareOrderIds(left.orderId, right.orderId);
  }

  function collectNewMessageEntries(entries, lastObservedMessageOrder) {
    if (!Array.isArray(entries) || !entries.length) {
      return [];
    }

    const orderedEntries = entries
      .map((entry) => ({
        ...entry,
        messageId: normalizeMessageId(entry.messageId),
        orderId: entry.orderId || extractMessageOrderId(entry.messageId)
      }))
      .filter((entry) => entry.messageId && entry.orderId)
      .sort(compareMessageOrderItems);

    if (!orderedEntries.length) {
      return [];
    }

    if (!lastObservedMessageOrder) {
      return [orderedEntries.at(-1)];
    }

    return orderedEntries.filter(
      (entry) => compareOrderIds(entry.orderId, lastObservedMessageOrder) > 0
    );
  }

  function sanitizeMessageText(text, author, options = {}) {
    const filterMetadata = options.filterMetadata !== false;
    const filterLinks = options.filterLinks !== false;

    let result = normalizeText(text);
    if (!result) {
      return "";
    }

    if (filterMetadata) {
      result = result
        .replace(/\(\s*編集済\s*\)/g, "")
        .replace(/\d{4}年\d{1,2}月\d{1,2}日(?:[^\s0-9:]+)?\s*\d{1,2}:\d{2}/gu, "")
        .replace(/\d{4}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}/gu, "")
        .replace(/^\[?\d{1,2}:\d{2}\]?\s*/g, "")
        .replace(/\s*\[?\d{1,2}:\d{2}\]?$/g, "")
        .replace(/^\s*[—-]\s*\d{1,2}:\d{2}\s*/g, "")
        .replace(/\s*[—-]\s*\d{1,2}:\d{2}\s*$/g, "")
        .replace(/^\s*\d{1,2}:\d{2}\s*/g, "")
        .replace(/\s*\d{1,2}:\d{2}\s*$/g, "");
    }

    if (filterLinks) {
      result = result
        .replace(/https?:\/\/\S*/giu, "")
        .replace(/\bhttps?:\/\/?/giu, "")
        .replace(/\b(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}(?:\/\S*)*/giu, "");
    }

    if (author) {
      const escapedAuthor = escapeForRegex(author);
      result = result.replace(new RegExp(`^${escapedAuthor}[\\s:：-]+`, "u"), "");
    }

    result = stripLeadingDecorationText(result);

    result = normalizeText(result)
      .replace(/^[\s:/.-]+/g, "")
      .replace(/[\s:/.-]+$/g, "");

    if (filterLinks || filterMetadata) {
      const residue = result
        .replace(/\d{4}年\d{1,2}月\d{1,2}日(?:[^\s0-9:]+)?/gu, "")
        .replace(/\d{1,2}:\d{2}/g, "")
        .replace(/https?/giu, "")
        .replace(/[/:/.\-\s]+/g, "");
      if (!residue) {
        return "";
      }
    }

    return normalizeText(result);
  }

  function buildSpeechText(message, options = {}) {
    const includeAuthor = options.includeAuthor !== false;
    if (includeAuthor && message?.author) {
      return `${message.author}. ${message.body}`;
    }

    return message?.body || "";
  }

  function clampNumber(value, min, max, fallback) {
    const numeric = Number(value);
    if (Number.isNaN(numeric)) {
      return fallback;
    }

    return Math.min(max, Math.max(min, numeric));
  }

  function createDuplicateTracker(config = {}) {
    const now = typeof config.now === "function" ? config.now : () => Date.now();
    const duplicateSuppressMs = config.duplicateSuppressMs ?? DUPLICATE_SUPPRESS_MS;
    const textOnlyDuplicateSuppressMs =
      config.textOnlyDuplicateSuppressMs ?? TEXT_ONLY_DUPLICATE_SUPPRESS_MS;
    const globalTextDuplicateSuppressMs =
      config.globalTextDuplicateSuppressMs ?? GLOBAL_TEXT_DUPLICATE_SUPPRESS_MS;
    const nearDuplicateMessageSuppressMs =
      config.nearDuplicateMessageSuppressMs ?? NEAR_DUPLICATE_MESSAGE_SUPPRESS_MS;

    const recentSpeechSignatures = new Map();
    const recentSpokenTexts = new Map();
    const recentMessageBodies = new Map();

    function prune(map, ttl) {
      const currentTime = now();
      for (const [key, spokenAt] of map.entries()) {
        if (currentTime - spokenAt >= ttl) {
          map.delete(key);
        }
      }
    }

    return {
      shouldSuppressDuplicateSpeech(messageId, spokenText) {
        prune(recentSpeechSignatures, duplicateSuppressMs);

        const signature = `${messageId}::${spokenText}`;
        if (recentSpeechSignatures.has(signature)) {
          return true;
        }

        recentSpeechSignatures.set(signature, now());
        return false;
      },

      shouldSuppressRapidTextDuplicate(message, spokenText) {
        prune(recentSpokenTexts, textOnlyDuplicateSuppressMs);

        const normalized = normalizeText(spokenText);
        if (!normalized) {
          return false;
        }

        const lastSpokenAt = recentSpokenTexts.has(normalized)
          ? recentSpokenTexts.get(normalized)
          : null;
        const currentTime = now();
        const elapsed = lastSpokenAt === null
          ? Number.POSITIVE_INFINITY
          : currentTime - lastSpokenAt;
        if (elapsed < globalTextDuplicateSuppressMs) {
          return true;
        }

        if (message?.author && !message.authorInferred) {
          recentSpokenTexts.set(normalized, currentTime);
          return false;
        }

        if (elapsed < textOnlyDuplicateSuppressMs) {
          return true;
        }

        recentSpokenTexts.set(normalized, currentTime);
        return false;
      },

      shouldSuppressNearDuplicateMessage(message, spokenText) {
        prune(recentMessageBodies, nearDuplicateMessageSuppressMs);

        const normalized = normalizeText(spokenText);
        if (!normalized || !message?.author) {
          return false;
        }

        const signature = `${message.author}::${normalized}`;
        const lastSpokenAt = recentMessageBodies.has(signature)
          ? recentMessageBodies.get(signature)
          : null;
        const currentTime = now();
        if (
          lastSpokenAt !== null &&
          currentTime - lastSpokenAt < nearDuplicateMessageSuppressMs
        ) {
          return true;
        }

        recentMessageBodies.set(signature, currentTime);
        return false;
      }
    };
  }

  const api = {
    DEFAULT_SETTINGS,
    DUPLICATE_SUPPRESS_MS,
    TEXT_ONLY_DUPLICATE_SUPPRESS_MS,
    GLOBAL_TEXT_DUPLICATE_SUPPRESS_MS,
    NEAR_DUPLICATE_MESSAGE_SUPPRESS_MS,
    normalizeText,
    normalizeEmojiAlt,
    stripLeadingDecorationText,
    normalizeMessageId,
    extractMessageOrderId,
    compareOrderIds,
    compareMessageOrderItems,
    collectNewMessageEntries,
    sanitizeMessageText,
    buildSpeechText,
    clampNumber,
    createDuplicateTracker
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  globalScope.DiscordChatReaderCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
