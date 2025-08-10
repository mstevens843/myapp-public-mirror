// mintStorage.js
const fs = require("fs");
const path = require("path");

const FILE_PATH = path.join(__dirname, "mintMemory.json");

// ⬇️ Load from file at startup
function loadMintMemory() {
  if (!fs.existsSync(FILE_PATH)) return {};
  try {
    const raw = fs.readFileSync(FILE_PATH);
    return JSON.parse(raw);
  } catch (err) {
    console.error("❌ Failed to load mintMemory.json:", err.message);
    return {};
  }
}

// 💾 Save to file
function saveMintMemory(memory) {
  try {
    fs.writeFileSync(FILE_PATH, JSON.stringify(memory, null, 2));
  } catch (err) {
    console.error("❌ Failed to write mintMemory.json:", err.message);
  }
}

module.exports = {
  loadMintMemory,
  saveMintMemory,
};
