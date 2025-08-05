// backend/utils/marketData/getTokenMetadata.js
require("dotenv").config({ path: __dirname + "/../../../.env" });
const axios = require("axios");
const { birdeyeCUCounter } = require("./birdeyeCUCounter");
const CU_TABLE = require("./cuTable");

const METADATA_ENDPOINT = "https://public-api.birdeye.so/defi/v3/token/meta-data/single";
const TTL_MS = 60_000; // 60s cache
const cache = new Map(); // mint → { ts, metadata }

/* ---------------------------------------------------- */
/*  internal: fetch metadata for a single token address */
/* ---------------------------------------------------- */
async function fetchMetadata(mint, userId = null) {
  if (!mint) {
    console.warn("⚠️ fetchMetadata called with invalid mint");
    return null;
  }

  const data = await birdeyeCUCounter({
    url: METADATA_ENDPOINT,
    method: "GET",
    params: { address: mint },
    cuCost: CU_TABLE["/defi/v3/token/meta-data/single"],
    userId,
  });

  if (!data?.success || !data.data) {
    console.warn(`⚠️ fetchMetadata: Birdeye failed for mint ${mint}`);
    return null;
  }

  return data.data; // contains: name, symbol, decimals, logo_uri, etc
}

/* ----------------------- public API ------------------ */
async function getTokenMetadata(userId = null, mint) {
  if (!mint) return null;

  const hit = cache.get(mint);
  if (hit && Date.now() - hit.ts < TTL_MS) {
    return hit.metadata;
  }

  try {
    const metadata = await fetchMetadata(mint, userId);
    if (metadata) {
      cache.set(mint, { ts: Date.now(), metadata });
    }
    return metadata;
  } catch (err) {
    console.warn(`❌ getTokenMetadata error for ${mint}:`, err.message);
    return null;
  }
}

module.exports = getTokenMetadata;