require("dotenv").config({ path: require("path").resolve(__dirname, "../../../.env") });

const fs   = require("fs");
const path = require("path");
const { v4: uuid } = require("uuid");
const { getCachedPrice } = require("../../../utils/priceCache.dynamic");


const FILE            = path.join(__dirname, "../../../logs/pending-orders-tpsl.json");
const OPEN_TRADES_FILE = path.join(__dirname, "../../../logs/open-trades.json");

fs.mkdirSync(path.dirname(FILE), { recursive: true });
if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify([], null, 2));

/* ───────── helpers ───────── */
const loadWebSettings = () => {
  const raw = fs.readFileSync(FILE, "utf8").trim();
  return raw ? JSON.parse(raw) : [];
};

const saveWebSettings = (arr) => {
  fs.writeFileSync(FILE, JSON.stringify(arr, null, 2));
  console.log("💾 Saved TP/SL settings.");
};

/* ───────── add / overwrite ───────── */
async function addWebTpSlEntry(
  mint,
  tp,
  sl,
  tpPercent,
  slPercent,
  userId      = "web",
  walletLabel = "default",
  force       = false,
  strategy    = "manual"
) {
  const all = loadWebSettings();

  /* ------ entry price (weighted from open trades or live price) ------ */
  let entryPrice = null;
  try {
    const trades   = JSON.parse(fs.readFileSync(OPEN_TRADES_FILE, "utf8"));
    const matches  = trades.filter(
      (t) => t.mint === mint && t.walletLabel === walletLabel
    );
    const totalIn      = matches.reduce((s, t) => s + Number(t.inAmount), 0);
    const weightedUSD  = matches.reduce(
      (s, t) => s + ((t.entryPriceUSD || 0) * Number(t.inAmount)),
      0
    );
    if (totalIn && weightedUSD) entryPrice = +(weightedUSD / totalIn).toFixed(6);
  } catch { /* ignore */ }

  if (!entryPrice) {
  entryPrice = await getCachedPrice(mint);
}

  const rule = {
    id: uuid(),
    mint,
    tp,
    sl,
    tpPercent,
    slPercent,
    entryPrice,
    walletLabel,
    userId,
    strategy,
    createdAt : new Date().toISOString(),
    enabled   : true,
    failCount : 0,
    status    : "active",
    force,
  };

  /* -------- dedupe by (mint + userId + walletLabel + strategy) -------- */
  const idx = all.findIndex(
    (r) =>
      r.mint        === mint        &&
      r.userId      === userId      &&
      r.walletLabel === walletLabel &&
      r.strategy    === strategy
  );

  if (idx !== -1 && !["done", "failed"].includes(all[idx].status)) {
    all[idx] = { ...all[idx], ...rule };      // overwrite active rule for same strat
  } else {
    all.push(rule);                           // add fresh
  }

  saveWebSettings(all);
  return all;
}

/* ───────── patch by unique key ───────── */
function updateRule(
  mint,
  patch        = {},
  userId       = "web",
  walletLabel  = "default",
  strategy     = undefined     // optional → update ALL strategies when omitted
) {
  const all = loadWebSettings();
  const idx = all.findIndex(
    (r) =>
      r.mint        === mint        &&
      r.userId      === userId      &&
      r.walletLabel === walletLabel &&
      (strategy ? r.strategy === strategy : true)
  );
  if (idx === -1) return;
  all[idx] = { ...all[idx], ...patch };
  saveWebSettings(all);
}

/* ───────── remove by unique key ───────── */
function removeRule(
  mint,
  userId      = "web",
  walletLabel = "default",
  strategy    = undefined     // optional → remove ALL strategies when omitted
) {
  const all = loadWebSettings();
  const filtered = all.filter(
    (r) =>
      !(
        r.mint        === mint        &&
        r.userId      === userId      &&
        r.walletLabel === walletLabel &&
        (strategy ? r.strategy === strategy : true)
      )
  );
  saveWebSettings(filtered);
}

module.exports = {
  loadWebSettings,
  saveWebSettings,
  addWebTpSlEntry,
  updateRule,
  removeRule,
};
