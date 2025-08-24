// getFullNetWorth.js
const { PublicKey } = require("@solana/web3.js");
const { getTokenAccountsAndInfo } = require("./tokenAccounts");
const { getWalletBalance }        = require("../services/utils/wallet/walletManager");

// Price + liquidity helpers (batched)
const priceApi = require("../services/strategies/paid_api/getTokenPrice");
const getSolPrice = priceApi.getSolPrice;
const getPricesWithLiquidityBatch = priceApi.getPricesWithLiquidityBatch;

// Canonical mints
const SOL_MINT  = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/* ───────────────────────── Hard-coded config (no ENV) ─────────────────────────
 * These guardrails kill “fake” net worth from illiquid/stale quotes.
 */
const DUST_USD               = 0.05;        // anything < $0.01 is dust
const DUST_COOLDOWN_MIN      = 1440;        // 24h skip window for dust mints
const LIQ_FLOOR_USD          = 1000;        // require ≥ $5k liquidity to count (tune if needed)
const MAX_PRICE_STALENESS_SEC= 6 * 3600;    // require quote updated within last 6h
const alwaysIncludeMints = new Set([
  SOL_MINT,
  USDC_MINT,
  // Always show these even if under dust/liq/staleness thresholds:
  // "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr", // Popcat
  // "Dszxtrj4tRpMs3Ljmueekus3X6eagCEQFMaP5XoviBZL", // Facecard
  // "49Pkk9gtFYdbdU9ZPkrEX5Ckho9UhVMK96XCzvnepump"  // FREEBANDZ (uncomment if you want it forced-in)
]);

// In-memory dust skip cache: mint -> ignoreUntilEpochMs
const dustSkipUntil = new Map();

/* -------------------------------------------------------------------------- */
/** ⚙️  Used by server-side jobs / bots (keeps ALL tokens, but batched pricing) */
async function getFullNetWorth(pubkeyInput, userId = null) {
  const owner = (pubkeyInput instanceof PublicKey)
    ? pubkeyInput
    : new PublicKey(pubkeyInput?.publicKey ?? pubkeyInput);

  const tokens     = await getTokenAccountsAndInfo(owner);
  const solBalance = await getWalletBalance(owner);

  const solPrice   = await getSolPrice(userId);
  const solValue   = solBalance * solPrice;

  // Batch all non-SOL/USDC mints for pricing
  const otherMints = tokens
    .map(t => t.mint)
    .filter(m => m && m !== USDC_MINT && m !== SOL_MINT);

  const quotes = await getPricesWithLiquidityBatch(userId, otherMints);

  let total = solValue;
  const tokenVals = [{
    name: "SOL",
    mint: SOL_MINT,
    amount: solBalance,
    price: solPrice,
    valueUSD: +solValue.toFixed(2),
  }];

  for (const t of tokens) {
    if (t.mint === SOL_MINT) continue; // SOL handled above
    const price = (t.mint === USDC_MINT) ? 1.0 : (quotes[t.mint]?.price || 0);
    const value = price ? t.amount * price : 0;
    total += value;
    tokenVals.push({ ...t, price, valueUSD: +value.toFixed(2) });
  }

  return { totalValueUSD: +total.toFixed(2), tokenValues: tokenVals };
}

/* -------------------------------------------------------------------------- */
/** ⚙️  Used by WalletBalancePanel & Telegram (dust/illiquid/stale-aware; USDC=1) */
async function getFullNetWorthApp(pubkeyInput, userId = null) {
  const owner = (pubkeyInput instanceof PublicKey)
    ? pubkeyInput
    : new PublicKey(pubkeyInput?.publicKey ?? pubkeyInput);

  console.log("📊 getFullNetWorthApp called for:", owner.toBase58());

  const tokens     = await getTokenAccountsAndInfo(owner);
  console.log("📦 tokens fetched:", tokens);

  const solBalance = await getWalletBalance(owner);
  console.log("💰 SOL balance:", solBalance);

  const solPrice   = await getSolPrice(userId);
  console.log("💵 SOL price:", solPrice);

  const solValue   = solBalance * solPrice;

  // Decide which mints to price right now (skip dust under cooldown)
  const now = Date.now();
  const allMints = tokens
    .map(t => t.mint)
    .filter(m => m && m !== SOL_MINT && m !== USDC_MINT);

  const mintsToQuery = allMints.filter(m => {
    const until = dustSkipUntil.get(m) || 0;
    return now >= until; // only query if not currently skipped
  });

  // One batched request for the rest (cached internally by helper)
  const quotes = await getPricesWithLiquidityBatch(userId, mintsToQuery);

  // Compute, filter dust/illiquid/stale, and accumulate
  let total = solValue;
  const tokenVals = [{
    name: "SOL",
    mint: SOL_MINT,
    amount: solBalance,
    price: solPrice,
    valueUSD: +solValue.toFixed(2),
  }];

  let skipped = 0;
  const skippedDetails = [];

  for (const t of tokens) {
    // USDC special-case
    if (t.mint === USDC_MINT) {
      const value = t.amount * 1.0;
      total += value;
      tokenVals.push({ ...t, price: 1.0, valueUSD: +value.toFixed(2) });
      continue;
    }

    // SOL isn’t in the token accounts list; skip if present
    if (t.mint === SOL_MINT) continue;

    const q = quotes[t.mint] || { price: 0, liquidity: 0, updateUnixTime: 0 };
    const price = Number(q.price || 0);
    const liq   = Number.isFinite(q.liquidity) ? Number(q.liquidity) : 0;
    const updatedAt = Number(q.updateUnixTime || 0); // seconds
    const isFresh = updatedAt > 0 ? ((Date.now()/1000) - updatedAt) <= MAX_PRICE_STALENESS_SEC : false;

    const value = price ? t.amount * price : 0;

    // Dust/quality rules (unless allow-listed)
    const isAllowListed = alwaysIncludeMints.has(t.mint);
    const belowDust     = value < DUST_USD;
    const illiquidSoft  = liq > 0 && liq < LIQ_FLOOR_USD;
    const staleQuote    = !isFresh;

    if (!isAllowListed && (belowDust || illiquidSoft || staleQuote)) {
      skipped++;
      skippedDetails.push({
        mint: t.mint,
        amount: t.amount,
        price: +price.toFixed(10),
        valueUSD: +value.toFixed(6),
        liqUSD: liq,
        updatedAt,
        reason: belowDust ? `value < ${DUST_USD}` : (illiquidSoft ? `liq < ${LIQ_FLOOR_USD}` : `stale > ${MAX_PRICE_STALENESS_SEC}s`)
      });
      dustSkipUntil.set(t.mint, now + DUST_COOLDOWN_MIN * 60 * 1000);
      continue; // don’t include in response; don’t add to total
    }

    total += value;
    tokenVals.push({ ...t, price, valueUSD: +value.toFixed(2) });
  }

  if (skippedDetails.length) {
    console.log("🧹 Skipped tokens:", skippedDetails);
  }
  console.log("✅ Total networth:", total);

  return { totalValueUSD: +total.toFixed(2), tokenValues: tokenVals };
}

module.exports = { getFullNetWorth, getFullNetWorthApp };
