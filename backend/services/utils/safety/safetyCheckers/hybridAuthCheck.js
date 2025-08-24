// services/utils/safety/hybridAuthCheck.js
const { checkHeliusAuthorities } = require("./heliusMintAuthCheck");
const { checkWeb3Authorities   } = require("./web3AuthCheck");

/**
 * Tries Helius first, falls back to web3 on failure or suspicion.
 * Returns the chosen result, and includes { compare: { helius, web3 } } if both were queried.
 * @param {string}  mint
 * @param {boolean} [forceWeb3=false]
 * @returns {Promise<{key,label,passed,reason,detail,data,compare?}>}
 */
module.exports.checkMintAuthoritiesHybrid = async function checkMintAuthoritiesHybrid(mint, forceWeb3 = false) {
  const compared = {};
  try {
    const helius = await checkHeliusAuthorities(mint);
    compared.helius = helius;

    // Heuristics: when should we distrust the Helius decode?
    const suspicious =
      forceWeb3 ||
      helius.passed === false && helius.data?.mintAuthority == null && helius.data?.freezeAuthority == null && !helius.data?.error ||
      !Number.isFinite(helius.data?.decimals) ||
      (helius.data?.accountBytes && helius.data.accountBytes < 82) ||
      (helius.data?.isInitialized === false && helius.data?.mintAuthority == null && helius.data?.freezeAuthority == null);

    if (suspicious) {
      const web3 = await checkWeb3Authorities(mint);
      compared.web3 = web3;

      // Prefer web3 when suspicious; attach compare for transparency
      const chosen = { ...web3, source: "web3", compare: compared };
      if (helius.passed !== web3.passed) {
        chosen.detail += " (mismatch vs Helius)";
      }
      return chosen;
    }

    // Helius looked good → return it (also expose comparison if forceWeb3 true)
    return helius;
  } catch {
    // total failure → fall back
    const web3 = await checkWeb3Authorities(mint);
    return { ...web3, source: "web3" };
  }
};
