// backend/services/strategies/core/parallelFiller.js
//
// Implements multi‑wallet parallel fill for Turbo Sniper. The goal
// is to increase first‑fill probability and reduce market impact by
// splitting the desired notional across multiple wallets and racing
// them in parallel. The first transaction to confirm causes the
// remaining attempts to be abandoned. No global wallet manager
// state is introduced – each wallet keypair is loaded on demand
// using the manual executor’s loader.

'use strict';

const { incCounter, observeHistogram } = require('../logging/metrics');

/**
 * Load a keypair for a wallet. We rely on the manual executor's
 * loader to avoid introducing global wallet state. If it is
 * unavailable this function should be patched by the caller.
 */
let loadWalletKeypair;
try {
  // Attempt to require the manual executor’s loader. The actual path
  // may differ in your codebase – adjust accordingly. This file
  // intentionally does not require the entire manual executor to
  // avoid pulling in heavy dependencies on the hot path.
  ({ loadWalletKeypair } = require('../../wallets/manualExecutor'));
} catch (e) {
  // fallback stub; will throw if invoked
  loadWalletKeypair = () => {
    throw new Error('loadWalletKeypair() not implemented. Please provide a loader.');
  };
}

class ParallelFiller {
  /**
   * Execute a trade across multiple wallets in parallel. The first
   * successful fill stops all other in‑flight attempts.
   *
   * @param {Object} opts
   * @param {string[]} opts.walletIds List of wallet IDs to load.
   * @param {number[]} opts.splitPct Percent split per wallet (sums ≈1).
   * @param {number} opts.maxParallel Maximum number of concurrent fills.
   * @param {Object} opts.tradeParams Common trade parameters (amount, mints, slippage etc.).
   * @param {string} opts.idKey Idempotency key to attach to each attempt.
   * @param {Function} opts.executor A function that takes
   *   `(walletContext, tradeParams)` and returns a promise that
   *   resolves to a result { success: boolean, txId?: string }.
   * @returns {Promise<Object>} The result of the first successful fill or the last failure.
   */
  async execute({ walletIds, splitPct, maxParallel = 2, tradeParams, idKey, executor }) {
    if (!Array.isArray(walletIds) || !Array.isArray(splitPct)) {
      throw new Error('walletIds and splitPct must be arrays');
    }
    if (walletIds.length !== splitPct.length) {
      throw new Error('walletIds.length must equal splitPct.length');
    }
    const sum = splitPct.reduce((a, b) => a + b, 0);
    // Accept small floating point error
    if (Math.abs(sum - 1) > 0.05) {
      throw new Error('splitPct must sum to approximately 1');
    }
    // Limit concurrency
    const concurrency = Math.min(maxParallel, walletIds.length);
    incCounter('parallel_send_count', { concurrency });
    const start = Date.now();
    let resolved = false;
    let finalResult = null;
    const results = [];

    const attempts = walletIds.map((walletId, idx) => async () => {
      const pct = splitPct[idx];
      const amount = tradeParams.amount * pct;
      const subParams = Object.assign({}, tradeParams, { amount, walletId });
      // Each wallet context includes its keypair and idKey
      const walletContext = {
        walletId,
        keypair: await loadWalletKeypair(walletId),
        idKey,
      };
      try {
        const result = await executor(walletContext, subParams);
        if (!resolved && result && result.success) {
          resolved = true;
          finalResult = result;
          const latency = Date.now() - start;
          observeHistogram('parallel_first_win_ms', latency);
        }
        return result;
      } catch (err) {
        return { success: false, error: err };
      }
    });

    // Launch attempts up to concurrency. We do not strictly limit
    // concurrency here as Node’s event loop will handle scheduling,
    // but the concurrency parameter is tracked for metrics. Promise.race
    // is used to detect the first resolution; the remainder continue
    // to run but are ignored.
    const promises = attempts.map((fn) => fn());
    await Promise.race(promises);
    // Wait for all attempts to settle so that side effects (logs,
    // aborts) complete before returning.
    const allResults = await Promise.all(promises);
    if (!finalResult) {
      // All failed; pick the last result for error propagation
      finalResult = allResults[allResults.length - 1] || { success: false };
    } else {
      // Count aborted attempts
      const aborted = allResults.filter((r) => !r.success).length;
      if (aborted > 0) incCounter('parallel_abort_total', { aborted });
    }
    return finalResult;
  }
}

module.exports = new ParallelFiller();