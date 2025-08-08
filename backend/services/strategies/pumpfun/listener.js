// backend/services/strategies/pumpfun/listener.js
//
// Pump.fun bonding curve listener. Connects to a WebSocket endpoint
// specified by the environment variable PUMPFUN_FEED_URL and emits
// potential snipe opportunities when the bonding curve passes a
// configured threshold. Events are debounced per mint by a
// cooldown period. Consumers should listen for the 'snipe' event
// emitted by this module.

'use strict';

const { EventEmitter } = require('events');
const { incCounter } = require('../logging/metrics');

let WebSocketImpl;
try {
  WebSocketImpl = require('ws');
} catch (e) {
  WebSocketImpl = null;
}

class PumpfunListener extends EventEmitter {
  constructor() {
    super();
    this.running = false;
    this.socket = null;
    this.config = null;
    this.cooldownMap = new Map(); // mint -> last timestamp
  }

  /**
   * Start listening to pump.fun events. The configuration controls
   * filtering and cooldown. This method returns immediately; any
   * connection errors are emitted as 'error' events.
   *
   * @param {Object} config
   * @param {boolean} config.enabled Whether to enable the listener.
   * @param {number} config.thresholdPct Fraction of curve (0–1) at which to trigger.
   * @param {number} config.minSolLiquidity Minimum SOL liquidity required.
   * @param {number} config.cooldownSec Debounce period per mint.
   */
  start(config = {}) {
    this.config = Object.assign({ enabled: false }, config);
    if (!this.config.enabled) return;
    if (this.running) return;
    this.running = true;
    if (!WebSocketImpl) {
      process.nextTick(() => this.emit('error', new Error('WebSocket implementation unavailable')));
      return;
    }
    const url = process.env.PUMPFUN_FEED_URL || 'wss://pumpfun.example.com/feed';
    const ws = new WebSocketImpl(url);
    this.socket = ws;
    ws.on('open', () => {
      // Ready to receive data
    });
    ws.on('message', (data) => {
      try {
        incCounter('pumpfun_events_total');
        const event = JSON.parse(data);
        // Expect shape: { mint, curvePct, liquiditySol, creators }
        if (!event || typeof event.mint !== 'string') return;
        const curvePct = Number(event.curvePct);
        const liquiditySol = Number(event.liquiditySol);
        if (isNaN(curvePct) || isNaN(liquiditySol)) return;
        if (curvePct < this.config.thresholdPct || liquiditySol < this.config.minSolLiquidity) {
          incCounter('pumpfun_filtered_total', { reason: 'threshold' });
          return;
        }
        // Debounce by mint
        const now = Date.now();
        const last = this.cooldownMap.get(event.mint) || 0;
        if (now - last < (this.config.cooldownSec || 0) * 1000) {
          incCounter('pumpfun_filtered_total', { reason: 'cooldown' });
          return;
        }
        this.cooldownMap.set(event.mint, now);
        incCounter('pumpfun_snipes_total');
        // Emit snipe event for consumers. Clone event to avoid mutation.
        this.emit('snipe', Object.assign({}, event));
      } catch (err) {
        this.emit('error', err);
      }
    });
    ws.on('error', (err) => {
      this.emit('error', err);
    });
    ws.on('close', () => {
      this.running = false;
    });
  }

  /**
   * Stop the listener and close the WebSocket connection.
   */
  stop() {
    this.running = false;
    if (this.socket) {
      try {
        this.socket.close();
      } catch (e) {
        // ignore
      }
      this.socket = null;
    }
  }
}

module.exports = new PumpfunListener();