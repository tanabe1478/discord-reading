const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const manifestPath = path.join(projectRoot, "manifest.json");
const jsFiles = [
  "background.js",
  "content-core.js",
  "content.js",
  "offscreen.js",
  "popup.js"
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function checkManifest() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert(manifest.manifest_version === 3, "manifest_version must be 3");
  assert(Array.isArray(manifest.content_scripts), "content_scripts must exist");

  const discordScript = manifest.content_scripts.find((entry) =>
    Array.isArray(entry.matches) &&
    entry.matches.some((pattern) => pattern.includes("discord.com/channels/"))
  );

  assert(discordScript, "Discord content script entry is missing");
  assert(
    Array.isArray(discordScript.js) &&
      discordScript.js[0] === "content-core.js" &&
      discordScript.js[1] === "content.js",
    "Discord content scripts must load content-core.js before content.js"
  );
}

function checkSyntax() {
  for (const file of jsFiles) {
    const source = fs.readFileSync(path.join(projectRoot, file), "utf8");
    try {
      new vm.Script(source, { filename: file });
    } catch (error) {
      throw new Error(`Syntax check failed for ${file}: ${error.message}`);
    }
  }
}

checkManifest();
checkSyntax();
console.log("Verification passed.");
