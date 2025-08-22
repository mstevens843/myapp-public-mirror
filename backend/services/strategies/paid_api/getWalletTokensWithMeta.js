require("dotenv").config({ path: __dirname + "/../../../.env" });
const { Connection, PublicKey } = require("@solana/web3.js");
const { birdeyeCUCounter } = require("./birdeyeCUCounter");
const CU_TABLE = require("./cuTable");

// ✅ Use your existing liquidity-aware batch helper
const priceMod = require("./getTokenPrice");
const getPricesWithLiquidityBatch = priceMod.getPricesWithLiquidityBatch;

const RPC_URL = process.env.SOLANA_RPC_URL;
const MIN_VALUE_USD = 0.50;
const MIN_PRICE_USD = 0; // <─ used later in the filter

// Thresholds for fallback gating (same knobs used elsewhere in your app)
const MIN_LIQUIDITY_USD = Number(process.env.MIN_LIQUIDITY_USD || 1000);
const MAX_PRICE_STALENESS_SEC = Number(process.env.MAX_PRICE_STALENESS_SEC || 6 * 3600);

const ENDPOINT = "https://public-api.birdeye.so/v1/wallet/token_list";

async function getWalletTokensWithMeta(walletPubkey, userId = null) {
  const conn = new Connection(RPC_URL, "confirmed");

  // Fetch actual on-chain balances
  const { value } = await conn.getParsedTokenAccountsByOwner(
    new PublicKey(walletPubkey),
    { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") }
  );

  const tokens = value
    .map(a => a.account.data.parsed.info)
    .filter(i => +i.tokenAmount.uiAmount > 0.1)
    .map(i => ({
      mint: i.mint,
      amount: +i.tokenAmount.uiAmount,
      decimals: +i.tokenAmount.decimals
    }));

  /* ─── inject native SOL balance ─── */
  const SOL_MINT = "So11111111111111111111111111111111111111112";
  const solLamports = await conn.getBalance(new PublicKey(walletPubkey));
  if (solLamports > 0) {
    tokens.push({
      mint: SOL_MINT,
      amount: solLamports / 1e9,
      decimals: 9,
    });
  }

  // Then get Birdeye meta (batched for the whole wallet)
  let metaMap = {};
  metaMap[SOL_MINT] = {
    name: "Solana",
    symbol: "SOL",
    logo: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/info/logo.png",
    price: 0, // Birdeye may overwrite
  };

  try {
    const data = await birdeyeCUCounter({
      url: ENDPOINT,
      params: { wallet: walletPubkey, ui_amount_mode: "scaled" },
      cuCost: CU_TABLE["/defi/tokenlist"], // 🔷 centralized CU value
      userId,
    });

    const items = data?.data?.items || [];
    for (const item of items) {
      metaMap[item.address] = {
        name: item.name,
        symbol: item.symbol,
        logo: item.logoURI || item.icon || "",
        price: Number(item.priceUsd || 0),
      };
    }
  } catch (err) {
    console.warn("❌ Birdeye wallet token_list failed:", err.response?.status || err.message);
  }

  // ── ❷ Batched fallback pricing for anything Birdeye skipped
  // (One request total; applies liquidity + freshness gates)
  const missing = tokens
    .filter(t => !(metaMap[t.mint]?.price > 0))
    .map(t => t.mint);

  if (missing.length) {
    try {
      const quotes = await getPricesWithLiquidityBatch(userId, missing);
      const nowSec = Math.floor(Date.now() / 1e3);

      for (const mint of missing) {
        const q = quotes[mint] || {};
        const price = Number(q.price || 0);
        const liq   = Number(q.liquidity || 0);
        const ut    = Number(q.updateUnixTime || 0);
        const fresh = ut && (nowSec - ut) <= MAX_PRICE_STALENESS_SEC;

        if (price > 0 && fresh && liq >= MIN_LIQUIDITY_USD) {
          metaMap[mint] = { ...(metaMap[mint] || {}), price };
        }
      }
    } catch (e) {
      console.warn("batched price fallback failed:", e?.message || e);
    }
  }

  // Merge on-chain + Birdeye data
  return tokens
    .map(tok => {
      const meta = metaMap[tok.mint] || {};
      const price = Number(meta.price || 0);
      return {
        mint: tok.mint,
        amount: tok.amount,
        decimals: tok.decimals,
        name: meta.name || `${tok.mint.slice(0, 4)}…${tok.mint.slice(-4)}`,
        symbol: meta.symbol || "",
        logo: meta.logo || "",
        price,
        valueUsd: tok.amount * price,
      };
    })
    .filter(t =>
      t.mint === SOL_MINT ||
      (t.price > MIN_PRICE_USD && t.valueUsd >= MIN_VALUE_USD)
    )
    .sort((a, b) => b.valueUsd - a.valueUsd); // high → low
}

module.exports = getWalletTokensWithMeta;
