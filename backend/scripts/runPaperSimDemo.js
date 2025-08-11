/*
 * runPaperSimDemo.js
 *
 * Sample script to demonstrate the paper execution adapter in action.
 * Execute this file with `node runPaperSimDemo.js` from the
 * repository root.  The script constructs a dummy quote and
 * configuration object, runs a simulated trade and prints the
 * resulting fills, price, slippage, fees and latency.  Feel free
 * to modify the config parameters to explore different execution
 * models, seeds, slippage caps and partial fill behaviours.
 */

const { executePaperTrade } = require('../services/strategies/core/paperExecutionAdapter');

async function main() {
  const quote = {
    inAmount: 1_000_000n,
    outAmount: 500_000n,
    price: 0.5,
  };
  const config = {
    execModel: 'amm_depth',
    seed: 'demo-seed',
    slippageBpsCap: 75,
    latency: { quoteMs: 20, buildMs: 5, sendMs: 10, landMs: 300 },
    failureRates: { blockhashNotFound: 0.0, accountInUse: 0.0, slippageExceeded: 0.0, bundleNotLanded: 0.0 },
    partials: { minParts: 1, maxParts: 3 },
    priorityFeeLamports: 5000,
  };
  const result = await executePaperTrade({ quote, mint: 'DEMO', meta: {}, config });
  console.log('Paper simulation result:\n', JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});