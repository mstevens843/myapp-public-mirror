require("dotenv").config({ path: __dirname + "/../../../.env" });
const { Connection, PublicKey } = require("@solana/web3.js");
const { birdeyeCUCounter } = require("./birdeyeCUCounter");
const CU_TABLE = require("./cuTable");
const pLimit = require("p-limit");

const RPC_URL = process.env.SOLANA_RPC_URL;
const MIN_VALUE_USD = 0.50;
const MIN_PRICE_USD = 0;                // <─ used later in the filter
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY;

const ENDPOINT = "https://public-api.birdeye.so/v1/wallet/token_list";
const PRICE_ENDPOINT = "https://public-api.birdeye.so/defi/price";

const limit = pLimit(4);       // avoid hammering Birdeye

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

  // Then get Birdeye meta
  let metaMap = {};
  metaMap[SOL_MINT] = {
    name: "Solana",
    symbol: "SOL",
    logo: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/info/logo.png",
    price: 0,              // Birdeye will overwrite if it supports SOL
  };

  try {
    const data = await birdeyeCUCounter({
      url: ENDPOINT,
      params: { wallet: walletPubkey },
      cuCost: CU_TABLE["/defi/tokenlist"],   // 🔷 centralized CU value
      userId,
    });

    const items = data?.data?.items || [];
    for (const item of items) {
      metaMap[item.address] = {
        name: item.name,
        symbol: item.symbol,
        logo: item.logoURI,
        price: item.priceUsd
      };
    }
  } catch (err) {
    console.warn("❌ Birdeye portfolio fetch failed:", err.response?.status || err.message);
  }

  // ── ❶ SOL price fallback – now uses /defi/price
  if (metaMap[SOL_MINT].price === 0) {
    try {
      const { data } = await require("axios").get(PRICE_ENDPOINT, {
        params: { address: SOL_MINT, ui_amount_mode: "raw" },
        headers: { "x-chain": "solana", "X-API-KEY": BIRDEYE_API_KEY },
        timeout: 3000,
      });
      const p = data?.data?.value ?? 0;
      if (p > 0) metaMap[SOL_MINT].price = p;
    } catch { /* silent */ }
  }

  // ── ❷ Per-token fallback for anything Birdeye skipped
  const missing = tokens
    .filter(t => !metaMap[t.mint]?.price)
    .map(t => t.mint);

  await Promise.all(missing.map(mint =>
    limit(async () => {
      try {
        const { data } = await require("axios").get(PRICE_ENDPOINT, {
          params: { address: mint, ui_amount_mode: "raw" },
          headers: { "x-chain": "solana", "X-API-KEY": BIRDEYE_API_KEY },
          timeout: 3000,
        });
        const p = data?.data?.value ?? 0;
        if (p > 0) metaMap[mint] = { ...(metaMap[mint] || {}), price: p };
      } catch { /* ignore */ }
    })
  ));

  // Merge on-chain + Birdeye data
  return tokens
    .map(tok => {
      const price = metaMap[tok.mint]?.price || 0;
      return {
        mint: tok.mint,
        amount: tok.amount,
        decimals: tok.decimals,
        name: metaMap[tok.mint]?.name || `${tok.mint.slice(0, 4)}…${tok.mint.slice(-4)}`,
        symbol: metaMap[tok.mint]?.symbol || "",
        logo: metaMap[tok.mint]?.logo || "",
        price,
        valueUsd: tok.amount * price,
      };
    })
    .filter(t =>
      t.mint === SOL_MINT ||
      (t.price > MIN_PRICE_USD && t.valueUsd >= MIN_VALUE_USD)
    )
    .sort((a, b) => b.valueUsd - a.valueUsd);  // high → low
}

module.exports = getWalletTokensWithMeta;
