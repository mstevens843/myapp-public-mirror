// backend/services/strategies/core/idempotencyStore.js
//
// IdempotencyStore manages a set of in‑flight transaction identifiers (idKeys)
// that must remain stable across process restarts. Each idKey is created by
// hashing a tuple of userId, walletId, mint, amount, slotBucket and a salt.
// Entries expire after ttlSec seconds. On startup the store can optionally
// resume outstanding idKeys from disk to allow safe resumption of pending
// intents without risking duplicate buys.
//
// Configuration shape:
// {
//   ttlSec: number,        // seconds before an idKey expires
//   salt: string,          // environment‑specific salt to include in hashes
//   resumeFromLast: bool,  // whether to reload keys from previous run
//   storagePath?: string   // optional override for on‑disk storage path
// }
//
// The metrics object passed to the constructor should expose an increment()
// method. New counters emitted:
//   - idempotency_blocked_total: incremented when a duplicate idKey is seen
//   - resume_attempts_total: incremented once on init() if resumeFromLast=true
//   - resume_success_total: incremented with the number of idKeys restored

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

class IdempotencyStore {
  constructor(config = {}, metrics) {
    this.ttlSec = config.ttlSec || 90;
    this.salt = config.salt || '';
    this.resumeFromLast = config.resumeFromLast !== false;
    this.metrics = metrics || {
      increment() {},
    };
    this.store = new Map();
    // By default persist idKeys into a file alongside this module. Config can override.
    this.storagePath =
      config.storagePath ||
      path.join(__dirname, 'idempotency_store.json');
    this.initialized = false;
  }

  async init() {
    if (this.initialized) {
      return;
    }
    if (this.resumeFromLast) {
      if (this.metrics && typeof this.metrics.increment === 'function') {
        this.metrics.increment('resume_attempts_total', 1);
      }
      try {
        const data = await fs.readFile(this.storagePath, 'utf8');
        const parsed = JSON.parse(data);
        const now = Date.now();
        let restored = 0;
        Object.entries(parsed).forEach(([idKey, ts]) => {
          if (now - ts < this.ttlSec * 1000) {
            this.store.set(idKey, ts);
            restored += 1;
          }
        });
        if (this.metrics && typeof this.metrics.increment === 'function') {
          this.metrics.increment('resume_success_total', restored);
        }
      } catch (err) {
        // File may not exist or parse error; ignore silently
      }
    }
    this.initialized = true;
  }

  /**
   * Derive a deterministic idKey from the provided parameters and the salt.
   * @param {object} params
   * @returns {string} hex encoded sha256
   */
  computeIdKey({ userId, walletId, mint, amount, slotBucket }) {
    const input = [
      userId,
      walletId,
      mint,
      amount,
      slotBucket,
      this.salt,
    ].join('|');
    return crypto.createHash('sha256').update(input).digest('hex');
  }

  /**
   * Check if the idKey is already present and within TTL. If so increment the
   * blocked counter and return false. Otherwise register it and return true.
   * @param {string} idKey
   * @returns {boolean}
   */
  checkAndSetPending(idKey) {
    const now = Date.now();
    this.cleanupExpired();
    if (this.store.has(idKey)) {
      if (this.metrics && typeof this.metrics.increment === 'function') {
        this.metrics.increment('idempotency_blocked_total', 1);
      }
      return false;
    }
    this.store.set(idKey, now);
    this.persist().catch(() => {});
    return true;
  }

  /**
   * Remove an idKey from the store upon successful completion.
   * @param {string} idKey
   */
  markSuccess(idKey) {
    this.store.delete(idKey);
    this.persist().catch(() => {});
  }

  /**
   * Remove expired keys from the in‑memory store.
   */
  cleanupExpired() {
    const now = Date.now();
    for (const [idKey, ts] of this.store.entries()) {
      if (now - ts > this.ttlSec * 1000) {
        this.store.delete(idKey);
      }
    }
  }

  /**
   * Persist the current in‑flight idKeys to disk. Failures are ignored.
   */
  async persist() {
    try {
      const obj = {};
      for (const [k, v] of this.store.entries()) {
        obj[k] = v;
      }
      await fs.writeFile(this.storagePath, JSON.stringify(obj), 'utf8');
    } catch (err) {
      // Ignore persist errors to avoid bringing down the process on disk issues
    }
  }
}

module.exports = IdempotencyStore;
