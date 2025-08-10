const fs = require("fs");
const path = require("path");

const LOG_PATH = path.join(__dirname, "../logs/access.log");

function logAccess(user, command) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${user} ran /${command}\n`;
  fs.appendFile(LOG_PATH, line, (err) => {
    if (err) console.error("❌ Failed to write to access.log:", err.message);
  });
}

module.exports = {
  logAccess,
};
