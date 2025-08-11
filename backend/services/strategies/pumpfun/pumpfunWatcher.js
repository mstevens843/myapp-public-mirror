// ✨ Added: backend/services/pumpfun/pumpfunWatcher.js
'use strict';

const { Connection, PublicKey } = require('@solana/web3.js');
const EventEmitter = require('events');

// Set the correct program id in env (don’t hardcode guesses)
const PUMPFUN_PROGRAM_ID = process.env.PUMPFUN_PROGRAM_ID
  ? new PublicKey(process.env.PUMPFUN_PROGRAM_ID)
  : null;

/**
 * Emits:
 *  - 'created'  : { mint, signer, slot, ts }
 *  - 'migrated' : { mint, pool, slot, ts }
 *  - 'log'      : raw log line for debugging
 */
class PumpfunWatcher extends EventEmitter {
  constructor(connection) {
    super();
    if (!(connection instanceof Connection)) throw new Error('PumpfunWatcher: connection required');
    if (!PUMPFUN_PROGRAM_ID) {
      // still usable; you can set later
      console.warn('PumpfunWatcher: PUMPFUN_PROGRAM_ID not set; logs will not filter.');
    }
    this.conn = connection;
    this.subId = null;
  }

  start(commitment = 'confirmed') {
    if (this.subId) return;
    this.subId = this.conn.onLogs(
      PUMPFUN_PROGRAM_ID || 'all',
      async (l) => {
        const ts = Date.now();
        try {
          const slot = l.slot;
          for (const line of l.logs || []) {
            this.emit('log', line);

            // Very rough patterning—you’ll replace with real decode later
            // Example heuristics:
            if (/create|init/i.test(line)) {
              const mint = this._extractMint(line);
              this.emit('created', { mint, signer: l.signature, slot, ts });
            }
            if (/migrat|raydium|pool/i.test(line)) {
              const mint = this._extractMint(line);
              const pool = this._extractAddress(line);
              this.emit('migrated', { mint, pool, slot, ts });
            }
          }
        } catch (_) {}
      },
      { commitment }
    );
  }

  stop() {
    if (!this.subId) return;
    try { this.conn.removeOnLogsListener(this.subId); } catch (_) {}
    this.subId = null;
  }

  _extractMint(line) {
    const m = line.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g);
    return m?.[0] || null;
  }
  _extractAddress(line) {
    const m = line.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g);
    return m?.[1] || null;
  }
}

module.exports = { PumpfunWatcher };
