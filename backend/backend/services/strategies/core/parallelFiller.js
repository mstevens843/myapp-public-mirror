// backend/services/strategies/core/parallelFiller.js
//
// ParallelFiller — multi-wallet parallel fill utilities for Turbo Sniper
// ---------------------------------------------------------------------
// Goals
//  • Increase first-fill probability by racing multiple wallets in parallel
//  • Keep the hot path non-blocking (no DB/FS/Telegram in-line here)
//  • Honor splitPct and maxParallel, share a stable idKey across attempts
//  • Provide BOTH interfaces used in the codebase:
//      1) Class instance with .execute({ walletIds, splitPct, ... })
//      2) Stand-alone executeParallel({ walletIds, splitPct, ... }) → {sigs, failures}
//  • NEW (spec P0 M): functional parallelFiller({ totalAmount, routes, wallets, splitPct, maxParallel, onExecute, idKeyBase })
//    returning { perWallet, summary } with limiter and per-wallet idKey suffix.
//
// Notes
//  • We support splitPct either as fractions (sum≈1) OR percentages (sum≈100).
//  • We swallow errors per-attempt and report via counters / return shape.
//  • We do not actually "cancel" in-flight RPCs on first win (Node lacks
//    hard cancellation). We short-circuit subsequent work where possible.
//
// This file intentionally imports only lightweight metrics helpers.
// Heavy loaders (wallet keypairs) are accessed via a pluggable loader.

'use strict';

const { incCounter, observeHistogram } = require('../logging/metrics');


// minimal error classifier (keeps error labels consistent with executor)
const NET_ERRS  = [/blockhash/i, /node is behind/i, /timed? out/i, /connection/i, /getblockheight timed out/i, /account in use/i];
const USER_ERRS = [/slippage/i, /insufficient funds/i, /mint.*not found/i, /slippage exceeded/i];
function classifyError(err) {
  const msg = (err && (err.message || String(err))) || '';
  const m = msg.toLowerCase();
  if (USER_ERRS.some(r => r.test(m))) return 'USER';
  if (NET_ERRS.some(r => r.test(m)))  return 'NET';
  return 'UNKNOWN';
}
/**
 * Optional wallet keypair loader (provided by manual executor).
 * This keeps global wallet state out of the hot patha.
 */
let loadWalletKeypair;
try {
  ({ loadWalletKeypair } = require('../../wallets/manualExecutor'));
} catch (_e) {
  loadWalletKeypair = async (_walletId) => {
    throw new Error('loadWalletKeypair() not implemented. Please provide a loader.');
  };
}

/* ──────────────────────────────────────────────
 * Utilities (shared)
 * ──────────────────────────────────────────── */

/**
 * Normalize splitPct values so they sum to ~1.
 * Accepts arrays that sum to ~1 (fractions) or ~100 (percent).
 */
function normalizeSplits(splitPct = []) {
  if (!Array.isArray(splitPct) || splitPct.length === 0) return [];
  const sum = splitPct.reduce((a, b) => a + Number(b || 0), 0);
  if (sum === 0) return splitPct.map(() => 0);
  // If it looks like percentages, scale down
  const scale = sum > 1.5 ? 100 : 1;
  return splitPct.map((p) => Number(p || 0) / (scale));
}

/**
 * Compute sub-amounts per split. Amount can be number|string|bigint.
 * For non-numeric values we pass the original amount through and let the
 * executor decide. Otherwise we floor to integers to avoid dust.
 */
function computeSubAmount(total, weight) {
  if (total == null) return total;
  if (typeof total === 'number' && Number.isFinite(total)) {
    return Math.max(0, Math.floor(total * weight));
  }
  const n = Number(total);
  if (Number.isFinite(n)) {
    return Math.max(0, Math.floor(n * weight));
  }
  // Unknown type (e.g., structured amount) — leave unchanged
  return total;
}

/**
 * Tiny in-file concurrency limiter (no deps).
 * Preserves submission order of tasks while capping active concurrency.
 */
function createLimiter(n) {
  const max = Math.max(1, Number(n) || 1);
  const queue = [];
  let active = 0;

  return function limit(fn) {
    return new Promise((resolve, reject) => {
      const run = () => {
        if (active < max) {
          active++;
          Promise.resolve()
            .then(fn)
            .then(resolve, reject)
            .finally(() => {
              active--;
              if (queue.length) queue.shift()();
            });
        } else {
          queue.push(run);
        }
      };
      run();
    });
  };
}

/* ──────────────────────────────────────────────
 * NEW functional API (spec): parallelFiller
 * ──────────────────────────────────────────── */
/**
 * Parallel filler entrypoint.  Schedules calls to the provided onExecute
 * handler with a concurrency cap.  Amounts are computed by flooring
 * totalAmount * splitPct[i] for each wallet.  A unique idKey for each
 * wallet attempt is created by appending `-w{i}` to the provided
 * idKeyBase.  Returns an object with perWallet results and a summary.
 *
 * @param {Object} opts
 * @param {number|string|bigint} opts.totalAmount
 * @param {Array} opts.routes (reserved for future)
 * @param {Array<string|number|Object>} opts.wallets
 * @param {Array<number>} opts.splitPct (fractions ~1 or percents ~100)
 * @param {number} [opts.maxParallel=2]
 * @param {Function} opts.onExecute ({ wallet, amount, idKey }) => Promise<{ ok|success|txid?, txid?, txHash?, errorClass?, error? }>
 * @param {string} opts.idKeyBase
 * @returns {Promise<{ perWallet: Array<{index:number,walletPubkey:any,amount:any,ok:boolean,txid?:string,errorClass?:string,error?:any}>, summary: {requestedTotal:any,allocatedTotal:number,okCount:number,failCount:number} }>}
 */
async function parallelFiller({
  totalAmount,
  routes, // reserved
  wallets,
  splitPct,
  maxParallel = 2,
  onExecute,
  idKeyBase,
}) {
  // Validate inputs
  if (!Array.isArray(wallets) || !Array.isArray(splitPct)) {
    throw new Error('wallets and splitPct must be arrays');
  }
  if (wallets.length !== splitPct.length) {
    throw new Error('wallets and splitPct length mismatch');
  }
  if (typeof onExecute !== 'function') {
    throw new Error('onExecute must be a function');
  }
  if (!idKeyBase || typeof idKeyBase !== 'string') {
    throw new Error('idKeyBase must be a non-empty string');
  }

  // Normalize fractions/percentages
  const weights = normalizeSplits(splitPct);
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(sumW) || Math.abs(sumW - 1) > 0.01) {
    throw new Error('splitPct must sum to approximately 1 (±0.01) or 100 (±1)');
  }

  const limit = createLimiter(Math.max(1, Number(maxParallel) || 1));
  try { incCounter?.('parallel_filler_started_total', 1, { n: wallets.length, maxParallel }); } catch (_) {}

  const perWallet = new Array(wallets.length);
  let allocatedTotal = 0;

  const execPromises = wallets.map((wallet, i) =>
    limit(async () => {
      const weight = weights[i] || 0;
      const amt = computeSubAmount(totalAmount, weight);
      if (typeof amt === 'number') allocatedTotal += amt;

      const idKey = `${idKeyBase}-w${i}`;
      const t0 = Date.now();

      try {
        const res = await onExecute({ wallet, amount: amt, idKey });
        const ok = !!(res && (res.ok === true || res.success === true || res.txid || res.txHash || res.hash));
        const txid = res && (res.txid || res.txHash || res.hash || null);

        perWallet[i] = {
          index: i,
          walletPubkey: wallet,
          amount: amt,
          ok,
          txid: txid || undefined,
        };

        try {
          const ms = Date.now() - t0;
          if (ok) incCounter?.('parallel_wallet_ok_total', 1);
          else    incCounter?.('parallel_wallet_fail_total', 1);
          observeHistogram?.('parallel_wallet_ms', ms);
        } catch (_) {}

        if (!ok) {
          perWallet[i].errorClass = res && res.errorClass ? res.errorClass : 'UNKNOWN';
          perWallet[i].error = res && (res.error || res.err || res.reason);
        }
        return perWallet[i];
      } catch (err) {
        perWallet[i] = {
          index: i,
          walletPubkey: wallet,
          amount: amt,
          ok: false,
          errorClass: classifyError(err),
          error: err,
        };
        try {
          const ms = Date.now() - t0;
          incCounter?.('parallel_wallet_fail_total', 1);
          observeHistogram?.('parallel_wallet_ms', ms);
        } catch (_) {}
        return perWallet[i];
      }
    })
  );

  // Wait for all executions to finish (never throws aggregate)
  await Promise.allSettled(execPromises);

  const okCount = perWallet.filter((r) => r && r.ok).length;
  const failCount = perWallet.length - okCount;

  try { incCounter?.('parallel_filler_done_total', 1, { ok: okCount, fail: failCount }); } catch (_) {}

  return {
    perWallet,
    summary: {
      requestedTotal: totalAmount,
      allocatedTotal,
      okCount,
      failCount,
    },
  };
}

/* ──────────────────────────────────────────────
 * Class API — first-win parallel execution
 * (Preserved exactly; used elsewhere in repo)
 * ──────────────────────────────────────────── */
class ParallelFiller {
  /**
   * Execute a trade across multiple wallets in parallel. The first
   * successful fill "wins". Remaining attempts are allowed to settle
   * but their results are ignored. Errors are swallowed per attempt.
   *
   * @param {Object} opts
   * @param {string[]} opts.walletIds
   * @param {number[]} opts.splitPct Fractions (~1) or percents (~100)
   * @param {number} [opts.maxParallel=2]
   * @param {Object} opts.tradeParams Common trade params
   * @param {string} opts.idKey Shared idempotency key
   * @param {Function} opts.executor (walletCtx, tradeParams) => Promise<{success:boolean, txId?:string}>
   * @returns {Promise<Object>} First successful result or consolidated failure
   */
  async execute({ walletIds, splitPct, maxParallel = 2, tradeParams, idKey, executor }) {
    if (!Array.isArray(walletIds) || !Array.isArray(splitPct)) {
      throw new Error('walletIds and splitPct must be arrays');
    }
    if (walletIds.length !== splitPct.length) {
      throw new Error('walletIds.length must equal splitPct.length');
    }
    if (typeof executor !== 'function') {
      throw new Error('executor must be a function');
    }

    const weights = normalizeSplits(splitPct);
    const sumW = weights.reduce((a, b) => a + b, 0);
    if (Math.abs(sumW - 1) > 0.05) {
      throw new Error('splitPct must sum to approximately 1 (or 100)');
    }

    const concurrency = Math.max(1, Math.min(maxParallel, walletIds.length));
    incCounter?.('parallel_send_count', { concurrency, nWallets: walletIds.length });

    const start = Date.now();
    let resolved = false;
    let finalResult = null;

    // Work queue with simple index, honoring maxParallel
    let idx = 0;
    const results = new Array(walletIds.length);
    const failures = new Array(walletIds.length).fill(false);

    const worker = async () => {
      while (true) {
        const i = idx++;
        if (i >= walletIds.length) break;
        // If we've already resolved a winner, skip heavy work
        if (resolved) continue;

        const wid = walletIds[i];
        const w = weights[i] || 0;
        const subAmount = computeSubAmount(tradeParams?.amount, w);
        const subParams = Object.assign({}, tradeParams, {
          amount: subAmount,
          walletId: wid,
          idKey,              // propagate stable idKey to all attempts
          splitPct: w,        // record the weight for observability
        });

        try {
          const keypair = await loadWalletKeypair(wid); // throws if missing
          // Check again after async boundary
          if (resolved) continue;

          const walletContext = { walletId: wid, keypair, idKey };
          const res = await executor(walletContext, subParams);
          results[i] = res;

          if (!resolved && res && res.success) {
            resolved = true;
            finalResult = res;
            observeHistogram?.('parallel_first_win_ms', Date.now() - start);
          } else if (!res || !res.success) {
            failures[i] = true;
          }
        } catch (err) {
          failures[i] = true;
          results[i] = { success: false, error: err };
        }
      }
    };

    // Spin up limited workers
    const workers = [];
    for (let k = 0; k < concurrency; k++) workers.push(worker());
    // Wait until *first* resolution (any worker may set resolved)
    await Promise.race(workers.map(async (w) => {
      await w;
      return true;
    })).catch(() => {});
    // Ensure all settle (to finish logs/side-effects)
    await Promise.allSettled(workers);

    // Aggregate
    if (!finalResult) {
      const last = results[results.length - 1];
      finalResult = last || { success: false, error: new Error('all attempts failed') };
    } else {
      const aborted = failures.filter(Boolean).length;
      if (aborted > 0) incCounter?.('parallel_abort_total', { aborted });
    }
    return finalResult;
  }
}

/* ──────────────────────────────────────────────
 * Functional API — batch execution with signatures
 * Shape required by routing layer:
 * executeParallel({ walletIds, splitPct, maxParallel, idKey, tradeParams, executor })
 *  -> { sigs: string[], failures: number }
 * (Preserved exactly; used elsewhere)
 * ──────────────────────────────────────────── */
async function executeParallel({
  walletIds = [],
  splitPct = [],
  maxParallel = 1,
  idKey,
  tradeParams = {},
  executor, // async (walletId, tradeParams) => string
}) {
  if (typeof executor !== 'function') {
    throw new Error('executor must be a function');
  }
  if (!Array.isArray(walletIds) || !Array.isArray(splitPct) || walletIds.length !== splitPct.length) {
    throw new Error('walletIds and splitPct must be arrays of equal length');
  }

  const weights = normalizeSplits(splitPct);
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (Math.abs(sumW - 1) > 0.05) {
    throw new Error('splitPct must sum to approximately 1 (or 100)');
  }

  const results = new Array(walletIds.length).fill(null);
  let failures = 0;
  let idx = 0;

  const worker = async () => {
    while (true) {
      const i = idx++;
      if (i >= walletIds.length) break;
      const wid = walletIds[i];
      const w = weights[i] || 0;
      const subAmount = computeSubAmount(tradeParams?.amount, w);
      const subParams = Object.assign({}, tradeParams, {
        amount: subAmount,
        walletId: wid,
        idKey,
        splitPct: w,
      });
      try {
        const sig = await executor(wid, subParams);
        results[i] = typeof sig === 'string' ? sig : null;
        if (!results[i]) failures++;
      } catch (_err) {
        failures++;
        results[i] = null;
      }
    }
  };

  const n = Math.max(1, Math.min(maxParallel || 1, walletIds.length));
  const workers = [];
  for (let k = 0; k < n; k++) workers.push(worker());
  await Promise.allSettled(workers);

  return { sigs: results.filter(Boolean), failures };
}

/* ──────────────────────────────────────────────
 * Exports (back-compat + new)
 * ──────────────────────────────────────────── */
const instance = new ParallelFiller();
module.exports = instance;                               // default export: instance with .execute()
module.exports.executeParallel = executeParallel;        // legacy functional API
module.exports.ParallelFiller = ParallelFiller;          // named export of the class
module.exports.parallelFiller = parallelFiller;          // NEW spec function
