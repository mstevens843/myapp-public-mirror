const fs = require("fs");

function readJSONSafe(path, fallback = []) {
  try {
    if (!fs.existsSync(path)) return fallback;
    const raw = fs.readFileSync(path, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("❌ Failed to read JSON from", path, err.message);
    return fallback;
  }
}

module.exports = { readJSONSafe };
