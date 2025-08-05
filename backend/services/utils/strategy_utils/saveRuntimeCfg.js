const fs = require("fs");
const path = require("path");

const runtimeDir = path.join(__dirname, "../runtime");

module.exports = function saveRuntimeCfg(mode, cfg) {
  const botId = cfg.botId || Date.now().toString();
  const file  = `${mode}-${botId}.json`;
  const full  = `${runtimeDir}/${file}`;
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(full, JSON.stringify({ ...cfg, mode, botId }, null, 2));
  return full;
};