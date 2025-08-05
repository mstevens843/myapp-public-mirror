// services/utils/birdeyeVerifiedCheck.js

require("dotenv").config({
  path: require("path").resolve(__dirname, "../../../../.env"),
});

const axios = require("axios");

const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY;
const HEADERS = {
  "x-api-key": BIRDEYE_API_KEY,
  accept: "application/json",
};

const KEY = "verified";
const LABEL = "Check if Token is Verified (via Metadata)";

/**
 * Determines if a token is verified by checking extensions from Birdeye.
 * A token is treated as verified if it has meaningful metadata fields
 * like coingecko_id, website, twitter, discord, etc.
 */
async function checkBirdeyeVerified(mint) {
  try {
    const url = `https://public-api.birdeye.so/defi/v3/token/meta-data/single?address=${mint}`;
    const { data } = await axios.get(url, { headers: HEADERS, timeout: 8000 });

    const token = data?.data;
    if (!token) throw new Error("Missing token metadata");

    const ext = token.extensions || {};

    const isVerified = !!(
      ext.coingecko_id ||
      ext.website ||
      ext.twitter ||
      ext.discord ||
      ext.github
    );

    return {
      key: KEY,
      label: LABEL,
      passed: isVerified,
      reason: isVerified ? undefined : "No official metadata/extensions found",
      data: {
        name: token.name || null,
        symbol: token.symbol || null,
        logoURI: token.logo_uri || null,
      },
    };
  } catch (err) {
    return {
      key: KEY,
      label: LABEL,
      passed: false,
      reason: "Birdeye API error",
      detail: err.response?.data?.message || err.message,
      data: null,
    };
  }
}

module.exports = { checkBirdeyeVerified };
