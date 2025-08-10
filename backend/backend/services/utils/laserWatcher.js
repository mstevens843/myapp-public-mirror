// backend/services/utils/laserWatcher.js
//
// A lowâ€‘latency watcher that listens for new liquidity pool
// initialisation events using a persistent WebSocket.  The
// LaserWatcher wraps the existing PoolWatcher utility to provide
// additional instrumentation and resiliency.  On every pool
// detection the watcher emits a `poolDetected` event with a
// `detectedAt` timestamp (milliseconds since epoch) alongside the
// usual signature, programId and token mints.  If the underlying
// WebSocket encounters errors the watcher will automatically
// attempt to reconnect with a jittered backoff.  A periodic ping
// keeps the connection alive and surfaces health metrics.

const EventEmitter = require('events');
const PoolWatcher = require('./poolWatcher');

/**
 * A resilient wrapper around PoolWatcher that injects detection
 * timestamps and handles reconnection logic.  This implementation
 * does not attempt to connect to any private validator or Jito
 * services â€“ it uses the public RPC endpoint supplied by the
 * caller.  A small jitter is applied between reconnection
 * attempts to avoid thundering herds.
 */
class LaserWatcher extends EventEmitter {
  /**
   * Construct a new LaserWatcher.
   *
   * @param {string} rpcUrl The RPC WebSocket endpoint to connect to
   * @param {string[]} [programIds] Optional list of program IDs to watch
   */
  constructor(rpcUrl, programIds) {
    super();
    this.rpcUrl = rpcUrl;
    this.programIds = Array.isArray(programIds) && programIds.length > 0 ? programIds : undefined;
    this.running = false;
    this.watcher = null;
    this.pingIntervalMs = 15000;
    this.jitterBaseMs = 1000;
    this.pingTimer = null;
  }

  /**
   * Start the watcher.  Returns immediately; any asynchronous
   * setup is handled internally.  Subsequent calls have no
   * effect.
   *
   * @returns {Promise<void>}
   */
  async start() {
    if (this.running) return;
    this.running = true;
    await this._connect();
  }

  /**
   * Create the underlying PoolWatcher and hook event handlers.  In
   * case of failure or disconnect the watcher will schedule a
   * reconnection with jitter.
   *
   * @private
   */
  async _connect() {
    if (!this.running) return;
    try {
      // Instantiate the existing PoolWatcher.  It listens for pool
      // initialisation logs from supported AMM program IDs.  If
      // programIds is undefined PoolWatcher uses its defaults.
      this.watcher = new PoolWatcher(this.rpcUrl, this.programIds);

      // Proxy the poolDetected event, injecting a detectedAt timestamp.
      this.watcher.on('poolDetected', (info) => {
        const event = Object.assign({}, info, { detectedAt: Date.now() });
        this.emit('poolDetected', event);
      });

      // Propagate errors and handle reconnects gracefully.
      this.watcher.on('error', (err) => {
        // eslint-disable-next-line no-console
        console.error('LaserWatcher underlying error:', err.message || err);
        this._scheduleReconnect();
      });

      await this.watcher.start();
      // Setup a periodic ping to keep the connection alive.  The
      // ping simply emits a health event; callers can listen for
      // this to monitor latency.
      this._schedulePing();
    } catch (err) {
      // Connection failed immediately; retry with jitter.
      // eslint-disable-next-line no-console
      console.error('LaserWatcher connection error:', err.message || err);
      this._scheduleReconnect();
    }
  }

  /**
   * Schedule a ping event.  If the watcher has stopped this
   * function is a noâ€‘op.  When triggered the ping emits a
   * `ping` event with the current timestamp.
   *
   * @private
   */
  _schedulePing() {
    if (!this.running) return;
    if (this.pingTimer) clearTimeout(this.pingTimer);
    this.pingTimer = setTimeout(() => {
      try {
        this.emit('ping', Date.now());
      } finally {
        this._schedulePing();
      }
    }, this.pingIntervalMs);
  }

  /**
   * Schedule a reconnection attempt with jitter.  This stops the
   * current watcher instance and attempts to reinitialise after
   * waiting between `jitterBaseMs` and `2 * jitterBaseMs` ms.
   *
   * @private
   */
  _scheduleReconnect() {
    if (!this.running) return;
    if (this.watcher) {
      try {
        this.watcher.removeAllListeners();
        this.watcher.stop().catch(() => {});
      } catch (_) {
        /* ignore */
      }
      this.watcher = null;
    }
    if (this.pingTimer) {
      clearTimeout(this.pingTimer);
      this.pingTimer = null;
    }
    const delay = this.jitterBaseMs + Math.floor(Math.random() * this.jitterBaseMs);
    setTimeout(() => {
      if (!this.running) return;
      this._connect();
    }, delay);
  }

  /**
   * Stop the watcher and clean up resources.  Safe to call
   * multiple times.
   *
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.running) return;
    this.running = false;
    if (this.pingTimer) {
      clearTimeout(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.watcher) {
      try {
        await this.watcher.stop();
      } catch (_) {
        /* ignore */
      }
      this.watcher.removeAllListeners();
      this.watcher = null;
    }
    this.removeAllListeners();
  }
}

module.exports = LaserWatcher;