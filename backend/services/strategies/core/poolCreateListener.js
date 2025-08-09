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
 */

const PoolWatcher = require('../../../utils/poolWatcher');
const LaserWatcher = require('../../../utils/laserWatcher');

let watcherInstance = null;
let lastEmit = 0;
let debounceMs = 1000;
let callbackFn = null;

/**
 * Start watching for new pool initialisation events.  When a pool is
 * detected the provided callback is invoked with an object containing
 * the transaction signature and the token mints.  If called when a
 * watcher is already running this function does nothing.
 *
 * @param {Object} opts Options for the listener
 * @param {string} opts.rpcUrl RPC endpoint used for the WebSocket connection
 * @param {string[]} [opts.programIds] Optional list of program IDs to watch
 * @param {number} [opts.debounceMs=1000] Debounce interval in ms
 * @param {function(Object):void} onPool Callback invoked when a pool is detected
 *
 * The opts object supports an optional `enableLaserStream` flag which
 * selects the LaserWatcher over the default PoolWatcher.  When
 * enabled the watcher will emit a `detectedAt` timestamp on each
 * event.  Without this flag the PoolWatcher will be used and the
 * timestamp will be injected here.
 */
function startPoolListener({ rpcUrl, programIds = undefined, debounceMs: db = 1000, enableLaserStream = false } = {}, onPool) {
  if (watcherInstance) return;
  if (!rpcUrl || typeof rpcUrl !== 'string') {
    throw new Error('poolCreateListener: rpcUrl is required');
  }
  debounceMs = typeof db === 'number' && db > 0 ? db : 1000;
  callbackFn = typeof onPool === 'function' ? onPool : () => {};
  // Choose watcher implementation based on flag
  const WatcherClass = enableLaserStream ? LaserWatcher : PoolWatcher;
  watcherInstance = new WatcherClass(rpcUrl, programIds);
  watcherInstance.on('poolDetected', (info) => {
    const now = Date.now();
    if (now - lastEmit < debounceMs) return;
    lastEmit = now;
    // If the selected watcher did not inject detectedAt (PoolWatcher)
    // add it here for consistency.
    const enriched = Object.assign({}, info, { detectedAt: info.detectedAt || Date.now() });
    try {
      callbackFn(enriched);
    } catch (err) {
      console.error('poolCreateListener callback error:', err.message);
    }
  });
  // Start watcher asynchronously and surface errors
  watcherInstance.start().catch((err) => {
    console.error('poolCreateListener start error:', err.message);
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
  lastEmit = 0;
  callbackFn = null;
}

module.exports = { startPoolListener, stopPoolListener };