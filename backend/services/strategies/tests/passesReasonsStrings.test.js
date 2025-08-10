/*
 * passesReasonStrings.test.js
 *
 * Snapshot tests for the reason/detail strings returned by the passes() helper.
 * These assertions ensure that the identifiers used to convey developer/creator
 * heuristic failures remain stable over time.  Changing any of these strings
 * would break backwards compatibility for clients that depend on specific
 * reason codes (for example UI validators or metrics dashboards).  If you
 * intentionally change a reason string you must update these tests.
 */

'use strict';

const assert = require('assert');

const path = require('path');

function resolve(rel) {
  return require.resolve(rel, { paths: [__dirname] });
}

// Utility to stub modules via require.cache.  See passesIntegration.test.js
function stubModule(modulePath, stubExports) {
  const orig = require.cache[modulePath] || null;
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: stubExports,
  };
  return orig;
}
function restoreModule(modulePath, orig) {
  if (!orig) {
    delete require.cache[modulePath];
  } else {
    require.cache[modulePath] = orig;
  }
}
function clearModules(mods = []) {
  const list = [resolve('../core/passes.js'), ...mods.map((m) => resolve(m))];
  list.forEach((m) => delete require.cache[m]);
}

async function testReasonStrings() {
  const stubs = [];
  // Stub metrics to avoid incCounter undefined
  const metricsPath = resolve('../logging/metrics.js');
  stubs.push({ path: metricsPath, orig: stubModule(metricsPath, {
    incCounter: () => {},
    increment: () => {},
    observe: () => {},
  }) });
  // Stub overview fetch to avoid price/volume checks (disabled thresholds below)
  const overviewPath = resolve('../paid_api/getTokenShortTermChanges.js');
  stubs.push({ path: overviewPath, orig: stubModule(overviewPath, async () => ({ price: 1, priceChange: 1, volumeUSD: 1, marketCap: 1 })) });
  // Paths for heuristics modules used by passes
  const hcPath = resolve('../paid_api/holderConcentration.js');
  const lpPath = resolve('../paid_api/lpBurnPct.js');
  const insPath = resolve('../core/heuristics/insiderDetector.js');

  // Helper to run a scenario with specific stubs.  Stubs must be objects
  // containing optional properties: hc (value to return from
  // estimateHolderConcentration), lp (value for estimateLpBurnPct), ins
  // (object returned by insiderDetector).  The helper clears the passes
  // module, applies the stubs, requires passes and executes it with the
  // provided configuration.  After execution it restores the original
  // modules.  This ensures that each call picks up the correct stubbed
  // heuristics.
  async function runScenario({ hc, lp, ins }, passCfg) {
    const originals = [];
    if (hc !== undefined) {
      originals.push({ path: hcPath, orig: stubModule(hcPath, { estimateHolderConcentration: async () => hc }) });
    }
    if (lp !== undefined) {
      originals.push({ path: lpPath, orig: stubModule(lpPath, { estimateLpBurnPct: async () => lp }) });
    }
    if (ins !== undefined) {
      originals.push({ path: insPath, orig: stubModule(insPath, { insiderDetector: async () => ins }) });
    }
    // Clear passes to ensure it picks up our stubs
    clearModules();
    const { passes } = require('../core/passes.js');
    const result = await passes('Mint', passCfg);
    // Restore modules
    originals.forEach(({ path: p, orig }) => restoreModule(p, orig));
    return result;
  }

  // 1. Holder concentration breach
  let res = await runScenario({ hc: 80, lp: 100, ins: { ok: true } }, {
    entryThreshold: 0,
    volumeThresholdUSD: 0,
    dipThreshold: 0,
    devWatch: { maxHolderPercent: 50 },
    fetchOverview: async () => ({ price: 1, priceChange: 1, volumeUSD: 1, marketCap: 1 }),
  });
  assert.strictEqual(res.ok, false, 'Holder concentration should fail');
  assert.strictEqual(res.reason, 'dev-fail');
  assert.strictEqual(res.detail, 'holder-concentration');

  // 2. LP burn breach
  res = await runScenario({ hc: 10, lp: 2, ins: { ok: true } }, {
    entryThreshold: 0,
    volumeThresholdUSD: 0,
    dipThreshold: 0,
    devWatch: { minLpBurnPercent: 5 },
    fetchOverview: async () => ({ price: 1, priceChange: 1, volumeUSD: 1, marketCap: 1 }),
  });
  assert.strictEqual(res.ok, false, 'LP burn should fail');
  assert.strictEqual(res.reason, 'dev-fail');
  assert.strictEqual(res.detail, 'lp-burn-low');

  // 3. Blacklist fail
  res = await runScenario({ hc: 0, lp: 100, ins: { ok: true } }, {
    entryThreshold: 0,
    volumeThresholdUSD: 0,
    dipThreshold: 0,
    devWatch: { blacklist: ['Mint'] },
    fetchOverview: async () => ({ price: 1, priceChange: 1, volumeUSD: 1, marketCap: 1 }),
  });
  assert.strictEqual(res.ok, false, 'Blacklist should fail');
  assert.strictEqual(res.reason, 'dev-fail');
  assert.strictEqual(res.detail, 'blacklist');

  // 4. Insider detection
  res = await runScenario({ hc: 0, lp: 100, ins: { ok: false, reason: 'insider' } }, {
    entryThreshold: 0,
    volumeThresholdUSD: 0,
    dipThreshold: 0,
    devWatch: { enableInsiderHeuristics: true },
    fetchOverview: async () => ({ price: 1, priceChange: 1, volumeUSD: 1, marketCap: 1 }),
  });
  assert.strictEqual(res.ok, false, 'Insider should fail');
  assert.strictEqual(res.reason, 'dev-fail');
  assert.strictEqual(res.detail, 'insider');

  // 5. Overview fail mapping (simulate fetch returning null)
  // In this case we do not stub heuristics; passes should short‑circuit on
  // overview fail before dev heuristics.  We still clear modules to
  // isolate the call.
  clearModules();
  const { passes: passesForOverview } = require('../core/passes.js');
  res = await passesForOverview('Mint', {
    entryThreshold: 0.03,
    volumeThresholdUSD: 50000,
    fetchOverview: async () => null,
    devWatch: null,
  });
  assert.strictEqual(res.ok, false, 'Overview fetch failure should be detected');
  assert.strictEqual(res.reason, 'overview-fail');

  // Cleanup stubbed modules
  stubs.forEach(({ path: p, orig }) => restoreModule(p, orig));
  clearModules();
  console.log('passesReasonStrings.test.js passed');
}

testReasonStrings().catch((err) => {
  console.error(err);
  process.exit(1);
});