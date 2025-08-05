// services/utils/strategy_utils/strategySchedulerStorage.js
const fs   = require("fs");
const path = require("path");
const STORE = path.join(__dirname, "../../runtime/scheduled-strategies.json");

function load() {
  try { return JSON.parse(fs.readFileSync(STORE, "utf8")); } catch { return []; }
}
function save(jobsArr) {
  fs.writeFileSync(STORE, JSON.stringify(jobsArr, null, 2));
}
module.exports = { load, save };
