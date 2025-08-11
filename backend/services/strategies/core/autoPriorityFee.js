// ✨ Added: backend/services/fees/feeOracle.js
'use strict';

const { Connection } = require('@solana/web3.js');

function quantile(arr, q) {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  const pos = (a.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return a[base] + (a[base + 1] - a[base]) * rest || a[base];
}

/**
 * Returns { cuMicro, jitoTip } suggested for "normal" / "high" / "turbo"
 */
async function autoPriorityFees(connection, { profile = 'high', jitoBase = 0 } = {}) {
  if (!(connection instanceof Connection)) throw new Error('feeOracle: connection required');
  try {
    const recents = await connection.getRecentPrioritizationFees(); // [{slot, prioritizationFee}] micro-lamports per CU
    const fees = (recents || []).map(r => Number(r?.prioritizationFee || 0)).filter(x => x > 0);
    const p50 = quantile(fees, 0.50);
    const p75 = quantile(fees, 0.75);
    const p90 = quantile(fees, 0.90);
    const p95 = quantile(fees, 0.95);

    let cuMicro = Math.max(0, Math.floor(({
      normal: p75,
      high:   p90,
      turbo:  p95
    })[profile] || p90));

    // Jito tip heuristic: a small fraction of CU spend as flat lamports
    // (tune per your infra; here we just forward jitoBase)
    const jitoTip = Math.max(0, Math.floor(jitoBase));

    return { cuMicro, jitoTip, stats: { p50, p75, p90, p95 } };
  } catch (_) {
    // Fallback if RPC doesn’t support the method
    return {
      cuMicro: ({ normal: 20_000, high: 80_000, turbo: 150_000 })[profile] || 80_000,
      jitoTip: Math.max(0, Math.floor(jitoBase)),
      stats: null
    };
  }
}

module.exports = { autoPriorityFees };
