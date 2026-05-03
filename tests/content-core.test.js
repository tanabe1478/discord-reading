const assert = require("node:assert/strict");

const {
  normalizeEmojiAlt,
  normalizeMessageId,
  extractMessageOrderId,
  compareOrderIds,
  collectNewMessageEntries,
  sanitizeMessageText,
  buildSpeechText,
  clampNumber,
  normalizeSpeechEngine,
  normalizeVoicevoxBaseUrl,
  normalizeSpeakerId,
  buildVoicevoxSpeakersUrl,
  buildVoicevoxAudioQueryUrl,
  buildVoicevoxSynthesisUrl,
  buildTtsQuestSynthesisUrl,
  mapPitchToVoicevoxPitchScale,
  applyVoicevoxAudioSettings,
  parseBuiltInAiReviewResponse,
  shouldAcceptAiReviewedText,
  createDuplicateTracker
} = require("../content-core.js");

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test("normalizeMessageId extracts canonical Discord message ids", () => {
  assert.equal(
    normalizeMessageId("foo chat-messages-123-456 bar"),
    "chat-messages-123-456"
  );
  assert.equal(normalizeMessageId("chat-messages-123-456"), "chat-messages-123-456");
  assert.equal(normalizeMessageId("message-123"), "message-123");
});

test("extractMessageOrderId and compareOrderIds sort by Discord snowflake string order", () => {
  assert.equal(extractMessageOrderId("chat-messages-1-99"), "99");
  assert.ok(compareOrderIds("9", "10") < 0);
  assert.ok(compareOrderIds("1495508429823803482", "1495508438866722816") < 0);
  assert.equal(compareOrderIds("123", "123"), 0);
});

test("collectNewMessageEntries returns only the latest item on first sync", () => {
  const entries = [
    { messageId: "chat-messages-1-100", orderId: "100", value: "old" },
    { messageId: "chat-messages-1-300", orderId: "300", value: "newest" },
    { messageId: "chat-messages-1-200", orderId: "200", value: "middle" }
  ];

  const result = collectNewMessageEntries(entries, "");
  assert.deepEqual(result.map((entry) => entry.value), ["newest"]);
});

test("collectNewMessageEntries returns all newer items in order after cursor", () => {
  const entries = [
    { messageId: "chat-messages-1-300", orderId: "300", value: "c" },
    { messageId: "chat-messages-1-100", orderId: "100", value: "a" },
    { messageId: "chat-messages-1-200", orderId: "200", value: "b" },
    { messageId: "chat-messages-1-400", orderId: "400", value: "d" }
  ];

  const result = collectNewMessageEntries(entries, "150");
  assert.deepEqual(result.map((entry) => entry.value), ["b", "c", "d"]);
});

test("sanitizeMessageText removes metadata and link-only residues", () => {
  assert.equal(
    sanitizeMessageText("2026年4月19日日曜日 19:30https://", "", {
      filterMetadata: true,
      filterLinks: true
    }),
    ""
  );
  assert.equal(
    sanitizeMessageText("なべ: test https://example.com/abc", "なべ", {
      filterMetadata: true,
      filterLinks: true
    }),
    "test"
  );
});

test("sanitizeMessageText strips Discord decoration text", () => {
  assert.equal(
    sanitizeMessageText("[NEKO], NEKOYouTube Member: 超猫ガチ恋勢 —", "", {
      filterMetadata: true,
      filterLinks: true
    }),
    ""
  );
});

test("normalizeEmojiAlt extracts custom emoji names", () => {
  assert.equal(normalizeEmojiAlt("<:romaji:1234567890>"), "romaji");
  assert.equal(normalizeEmojiAlt(":romaji:"), "romaji");
  assert.equal(normalizeEmojiAlt("🏒"), "🏒");
});

test("buildSpeechText respects includeAuthor setting", () => {
  const message = { author: "なべ", body: "test" };
  assert.equal(buildSpeechText(message, { includeAuthor: true }), "なべ. test");
  assert.equal(buildSpeechText(message, { includeAuthor: false }), "test");
});

test("clampNumber constrains numeric settings", () => {
  assert.equal(clampNumber("1.5", 0, 2, 1), 1.5);
  assert.equal(clampNumber("10", 0, 2, 1), 2);
  assert.equal(clampNumber("nan", 0, 2, 1), 1);
});

test("normalizeSpeechEngine keeps known engines and falls back to browser", () => {
  assert.equal(normalizeSpeechEngine("browser"), "browser");
  assert.equal(normalizeSpeechEngine("voicevoxLocal"), "voicevoxLocal");
  assert.equal(normalizeSpeechEngine("ttsQuest"), "ttsQuest");
  assert.equal(normalizeSpeechEngine("unknown"), "browser");
});

test("VOICEVOX URL helpers constrain local engine access", () => {
  assert.equal(
    normalizeVoicevoxBaseUrl("http://127.0.0.1:50021/"),
    "http://127.0.0.1:50021"
  );
  assert.equal(
    normalizeVoicevoxBaseUrl("https://example.com"),
    "http://127.0.0.1:50021"
  );
  assert.equal(
    buildVoicevoxSpeakersUrl("http://localhost:50021/"),
    "http://localhost:50021/speakers"
  );
  assert.equal(
    buildVoicevoxAudioQueryUrl("http://127.0.0.1:50021", "あ&い", "3"),
    "http://127.0.0.1:50021/audio_query?text=%E3%81%82%26%E3%81%84&speaker=3"
  );
  assert.equal(
    buildVoicevoxSynthesisUrl("http://127.0.0.1:50021", "3"),
    "http://127.0.0.1:50021/synthesis?speaker=3"
  );
});

test("speaker ids and tts.quest synthesis URLs are normalized", () => {
  assert.equal(normalizeSpeakerId("3", 1), 3);
  assert.equal(normalizeSpeakerId("-1", 1), 1);
  assert.equal(
    buildTtsQuestSynthesisUrl("テスト", "3"),
    "https://api.tts.quest/v3/voicevox/synthesis?text=%E3%83%86%E3%82%B9%E3%83%88&speaker=3"
  );
});

test("VOICEVOX audio query settings map browser controls conservatively", () => {
  assert.equal(mapPitchToVoicevoxPitchScale(0), -0.15);
  assert.equal(mapPitchToVoicevoxPitchScale(1), 0);
  assert.equal(mapPitchToVoicevoxPitchScale(2), 0.15);
  assert.deepEqual(
    applyVoicevoxAudioSettings(
      { accentPhrases: [], speedScale: 1, pitchScale: 0, volumeScale: 1 },
      { rate: 1.7, pitch: 1.5, volume: 0.4 }
    ),
    {
      accentPhrases: [],
      speedScale: 1.7,
      pitchScale: 0.075,
      volumeScale: 0.4
    }
  );
});

test("parseBuiltInAiReviewResponse accepts strict and fenced JSON", () => {
  assert.deepEqual(
    parseBuiltInAiReviewResponse('{"ok":true,"text":"  なべ. テスト  ","reason":"ok"}'),
    { ok: true, text: "なべ. テスト", reason: "ok" }
  );
  assert.deepEqual(
    parseBuiltInAiReviewResponse('```json\n{"ok":false,"text":"x","reason":"bad"}\n```'),
    { ok: false, text: "x", reason: "bad" }
  );
  assert.equal(parseBuiltInAiReviewResponse("not json"), null);
});

test("shouldAcceptAiReviewedText rejects empty, long, and URL-like rewrites", () => {
  assert.equal(shouldAcceptAiReviewedText("なべ. テスト", "なべ. テストです"), true);
  assert.equal(shouldAcceptAiReviewedText("なべ. テスト", ""), false);
  assert.equal(shouldAcceptAiReviewedText("短文", "長".repeat(100)), false);
  assert.equal(shouldAcceptAiReviewedText("リンクです", "https://example.com"), false);
});

test("duplicate tracker suppresses same message signature twice", () => {
  let currentTime = 1000;
  const tracker = createDuplicateTracker({ now: () => currentTime });

  assert.equal(tracker.shouldSuppressDuplicateSpeech("m1", "hello"), false);
  assert.equal(tracker.shouldSuppressDuplicateSpeech("m1", "hello"), true);

  currentTime += 16000;
  assert.equal(tracker.shouldSuppressDuplicateSpeech("m1", "hello"), false);
});

test("duplicate tracker suppresses global rapid text duplicates even for concrete authors", () => {
  let currentTime = 1000;
  const tracker = createDuplicateTracker({ now: () => currentTime });
  const message = { author: "なべ", authorInferred: false };

  assert.equal(tracker.shouldSuppressRapidTextDuplicate(message, "なべ. aaaa"), false);
  currentTime += 100;
  assert.equal(tracker.shouldSuppressRapidTextDuplicate(message, "なべ. aaaa"), true);
  currentTime += 300;
  assert.equal(tracker.shouldSuppressRapidTextDuplicate(message, "なべ. aaaa"), false);
});

test("duplicate tracker keeps text-only duplicate suppression for inferred authors", () => {
  let currentTime = 1000;
  const tracker = createDuplicateTracker({ now: () => currentTime });
  const message = { author: "なべ", authorInferred: true };

  assert.equal(tracker.shouldSuppressRapidTextDuplicate(message, "なべ. tasikani"), false);
  currentTime += 1000;
  assert.equal(tracker.shouldSuppressRapidTextDuplicate(message, "なべ. tasikani"), true);
  currentTime += 600;
  assert.equal(tracker.shouldSuppressRapidTextDuplicate(message, "なべ. tasikani"), false);
});

test("duplicate tracker suppresses near-duplicate same-author same-text messages", () => {
  let currentTime = 1000;
  const tracker = createDuplicateTracker({ now: () => currentTime });
  const message = { author: "なべ" };

  assert.equal(tracker.shouldSuppressNearDuplicateMessage(message, "なべ. aaaa"), false);
  currentTime += 100;
  assert.equal(tracker.shouldSuppressNearDuplicateMessage(message, "なべ. aaaa"), true);
  currentTime += 500;
  assert.equal(tracker.shouldSuppressNearDuplicateMessage(message, "なべ. aaaa"), false);
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error);
  }
}

if (failed > 0) {
  process.exitCode = 1;
} else {
  console.log(`All ${tests.length} tests passed.`);
}
