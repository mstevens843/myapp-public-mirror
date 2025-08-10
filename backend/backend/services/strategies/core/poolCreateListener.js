// backend/services/strategies/core/poolCreateListener.js
/*
 * poolCreateListener.js
 *
 * A thin wrapper around the PoolWatcher utility that exposes a simple
 * start/stop API and debounces events to prevent rapid repeated
 * callbacks.  Strategies can use this module to receive notifications
 * whenever a new liquidity pool is initialised on supported AMMs (e.g.
 * Raydium).  The listener will automatically subscribe to the
 * configured program IDs and invoke the supplied callback with the
 * token mints and signature when a pool is detected.
 *
 * Additions:
 *  - Debounce per signature and per token-pair (mintA|mintB) to avoid
 *    duplicate callbacks in fast reorg/log bursts.
 *  - Configurable slot-based freshness window via `poolFreshnessWindowSlots`.
 *    If `detectedAtSlot` is available on events, events older than this
 *    window vs current slot are dropped. Falls back to time-based debounce.
 *  - Optional `enableLaserStream` selector; if LaserWatcher is not present,
 *    it transparently falls back to PoolWatcher.
 */

'use strict';

const PoolWatcher = require('../../../utils/poolWatcher');
let LaserWatcher = null;
try {
  // Optional; may not exist in some deployments
  // eslint-disable-next-line import/no-unresolved, global-require
  LaserWatcher = require('../../../utils/laserWatcher');
} catch (_) {
  LaserWatcher = null;
}

let watcherInstance = null;
let lastEmitTs = 0;
let debounceMs = 1000;
let callbackFn = null;
let poolFreshnessWindowSlots = 15; // sensible default for freshness checks
const lastBySignature = new Map(); // signature -> last slot or timestamp
const lastByPair = new Map();      // "mintA|mintB" (sorted) -> last slot or timestamp

/**
 * Normalize a token pair key in sorted order to avoid A/B vs B/A duplicates.
 */
function pairKey(a, b) {
  if (!a || !b) return null;
  const [x, y] = [String(a), String(b)].sort();
  return `${x}|${y}`;
}

/**
 * Determine if an event should be dropped due to slot-based freshness.
 * Returns true if the event is too old compared to current slot.
 */
async function isStaleBySlot(info) {
  const eventSlot = typeof info.detectedAtSlot === 'number' ? info.detectedAtSlot : null;
  if (eventSlot == null || !watcherInstance) return false;
  const conn = watcherInstance.connection;
  if (!conn || typeof conn.getSlot !== 'function') return false;
  try {
    const currentSlot = await conn.getSlot();
    return currentSlot - eventSlot > poolFreshnessWindowSlots;
  } catch (_) {
    return false;
  }
}

/**
 * Start watching for new pool initialisation events.  When a pool is
 * detected the provided callback is invoked with an object containing
 * the transaction signature and the token mints.  If called when a
 * watcher is already running this function does nothing.
 *
 * @param {Object} opts Options for the listener
 * @param {string} opts.rpcUrl RPC endpoint used for the WebSocket connection
 * @param {string[]|{programId:string,enabled?:boolean}[]} [opts.programIds]
 * @param {number} [opts.debounceMs=1000] Debounce interval in ms
 * @param {number} [opts.poolFreshnessWindowSlots=15] Slot-based freshness window
 * @param {boolean} [opts.enableLaserStream=false] Prefer LaserWatcher if available
 * @param {function(Object):void} onPool Callback invoked when a pool is detected
 *
 * The opts object supports an optional `enableLaserStream` flag which
 * selects the LaserWatcher over the default PoolWatcher.  When
 * enabled the watcher may emit a `detectedAt` timestamp and/or
 * `detectedAtSlot`.  Missing fields are filled here for consistency.
 */
function startPoolListener(
  { rpcUrl, programIds = undefined, debounceMs: db = 1000, poolFreshnessWindowSlots: pfw = 15, enableLaserStream = false } = {},
  onPool
) {
  if (watcherInstance) return;
  if (!rpcUrl || typeof rpcUrl !== 'string') {
    throw new Error('poolCreateListener: rpcUrl is required');
  }
  debounceMs = typeof db === 'number' && db > 0 ? db : 1000;
  poolFreshnessWindowSlots = Number.isInteger(pfw) && pfw > 0 ? pfw : 15;
  callbackFn = typeof onPool === 'function' ? onPool : () => {};

  // Choose watcher implementation based on flag and availability
  const WatcherClass = enableLaserStream && LaserWatcher ? LaserWatcher : PoolWatcher;
  if (enableLaserStream && !LaserWatcher) {
    // eslint-disable-next-line no-console
    console.warn('poolCreateListener: enableLaserStream requested but LaserWatcher not found; using PoolWatcher');
  }

  watcherInstance = new WatcherClass(rpcUrl, programIds);
  watcherInstance.on('poolDetected', async (info) => {
    const nowTs = Date.now();

    // Slot-based freshness (drop stale events if possible)
    if (await isStaleBySlot(info)) return;

    // Debounce time-based bursts
    if (nowTs - lastEmitTs < debounceMs) return;

    // Debounce per-signature
    const sig = info.signature;
    const evtSlot = typeof info.detectedAtSlot === 'number' ? info.detectedAtSlot : nowTs;
    const lastSlotForSig = lastBySignature.get(sig);
    if (lastSlotForSig != null) {
      const delta = (typeof lastSlotForSig === 'number' ? lastSlotForSig : 0);
      if (typeof info.detectedAtSlot === 'number') {
        if (evtSlot - lastSlotForSig < poolFreshnessWindowSlots) return;
      } else {
        if (nowTs - lastSlotForSig < debounceMs) return;
      }
    }
    lastBySignature.set(sig, typeof info.detectedAtSlot === 'number' ? evtSlot : nowTs);

    // Debounce per token pair (if accounts present)
    const key = pairKey(info.tokenA, info.tokenB);
    if (key) {
      const lastPairVal = lastByPair.get(key);
      if (lastPairVal != null) {
        if (typeof info.detectedAtSlot === 'number') {
          if (evtSlot - lastPairVal < poolFreshnessWindowSlots) return;
        } else {
          if (nowTs - lastPairVal < debounceMs) return;
        }
      }
      lastByPair.set(key, typeof info.detectedAtSlot === 'number' ? evtSlot : nowTs);
    }

    lastEmitTs = nowTs;

    // Enrich with detectedAt timestamp for consumers
    const enriched = Object.assign(
      { detectedAt: nowTs },
      info,
      { detectedAt: info.detectedAt || nowTs }
    );

    try {
      callbackFn(enriched);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('poolCreateListener callback error:', err && err.message ? err.message : err);
    }
  });

  // Start watcher asynchronously and surface errors
  Promise.resolve(watcherInstance.start()).catch((err) => {
    // eslint-disable-next-line no-console
    console.error('poolCreateListener start error:', err && err.message ? err.message : err);
  });
}

/**
 * Stop the pool watcher and remove any event listeners.  Safe to call
 * multiple times.
 */
async function stopPoolListener() {
  if (!watcherInstance) return;
  try {
    await watcherInstance.stop();
  } catch (_) {
    /* ignore */
  }
  watcherInstance.removeAllListeners('poolDetected');
  watcherInstance = null;
  lastEmitTs = 0;
  callbackFn = null;
  lastBySignature.clear();
  lastByPair.clear();
}

module.exports = { startPoolListener, stopPoolListener };
