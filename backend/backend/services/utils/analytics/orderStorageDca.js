// services/utils/analytics/orderStorage.js
const fs   = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "../../../logs/pending-orders-dca.json");
console.log("📁 Writing to file:", FILE);
fs.mkdirSync(path.dirname(FILE), { recursive: true });
if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, "[]", "utf8");

/* ───────── helpers ───────── */
const keyOf = r => r.id;

/* safe read ---------------------------------------------------- */
function read() {
  try {
    const raw = fs.readFileSync(FILE, "utf8").trim();
    return raw ? JSON.parse(raw) : [];
  } catch {
    fs.writeFileSync(FILE, "[]", "utf8");
    return [];
  }
}

/* atomic write ------------------------------------------------- */
function write(arr) {
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(arr, null, 2), "utf8");
  fs.renameSync(tmp, FILE);
}

/* add skeleton (skip dupes) ----------------------------------- */
function add(order) {
  const all = read();
  if (all.some(o => o.id === order.id)) {
    console.log("⏭️  Duplicate DCA skeleton:", order.id);
    return;
  }
  all.push(order);
  write(all);
  console.log("✅ Order stored:", order.id);
}

/* generic updater --------------------------------------------- */
function update(id, patch = {}) {
  const all = read();
  const idx = all.findIndex(o => o.id === id);
  if (idx === -1) {
    console.warn("⚠️  update(): id not found:", id);
    return;
  }
  all[idx] = { ...all[idx], ...patch };
  write(all);
}

/* remove ------------------------------------------------------- */
function remove(id) {
  write(read().filter(o => o.id !== id));
}

/* progress helper --------------------------------------------- */
function updateDcaProgress(id, ts = Date.now(), tx = null) {
  const all = read();
  const idx = all.findIndex(o => o.id === id);
  if (idx === -1) {
    console.warn(`⚠️  Couldn’t find DCA skeleton (id=${id})`);
    return;
  }
  const o = all[idx];
  o.executedCount = (o.executedCount || 0) + 1;
  o.completedBuys = (o.completedBuys || 0) + 1;
  o.lastBuyAt     = new Date(ts).toISOString();
  if (tx) o.tx = tx;
  if (o.completedBuys >= o.numBuys) {
    o.status   = "filled";
    o.filledAt = new Date(ts).toISOString();
  }
  all[idx] = o;
  write(all);
  console.log(`✅ DCA progress updated for ${o.tokenMint} (${o.completedBuys}/${o.numBuys})`);
}

/* merge helper (dedupe by id) --------------------------------- */
function mergeAndWrite(rows = []) {
  const byKey = Object.fromEntries(
    [...rows, ...read()].map(r => [keyOf(r), r])  
  );
  write(Object.values(byKey));
}

module.exports = {
  read,
  add,
  update,
  remove,
  write,
  mergeAndWrite,
  updateDcaProgress,
};
