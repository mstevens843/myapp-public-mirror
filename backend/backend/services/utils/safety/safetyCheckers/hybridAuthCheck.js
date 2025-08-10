/**
 * hybridAuthorityCheck.js
 * ------------------------------------------------------------
 * • Tries Helius first, falls back to web3 on failure or suspicion
 * • Packages the chosen result unchanged, only tagging .source
 */

const { checkHeliusAuthorities } = require("./heliusMintAuthCheck");
const { checkWeb3Authorities   } = require("./web3AuthCheck");

/**
 * @param {string}  mint
 * @param {boolean} [forceWeb3=false]
 * @returns {Promise<Result>}
 */
async function checkMintAuthoritiesHybrid(mint, forceWeb3 = false) {
  try {
    // 1️⃣ Try Helius
    const helius = await checkHeliusAuthorities(mint);

    // Suspicious if both authorities NULL but Helius flagged failed (rare)
    const suspicious = !helius.passed && helius.detail?.mint == null && helius.detail?.freeze == null;

    if (forceWeb3 || suspicious) {
      const web3 = await checkWeb3Authorities(mint);
      return { ...web3, source: "web3" };
    }

    return helius; // already { source: "helius" }
  } catch {
    // total failure → fall back
    const web3 = await checkWeb3Authorities(mint);
    return { ...web3, source: "web3" };
  }
}

module.exports = { checkMintAuthoritiesHybrid };
