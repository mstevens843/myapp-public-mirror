/**
 * poolWatcher.js
 *
 * A simple utility to watch for new liquidity pools on Solana DEXes.  It
 * leverages `Connection.onLogs` to listen for InitializePool or AddLiquidity
 * instructions emitted by known AMM program IDs such as Raydium.  When a
 * matching instruction is detected, the watcher attempts to parse the
 * transaction and extract the token mint addresses involved.  It then
 * emits a `poolDetected` event with the token mints and transaction
 * signature.  Consumers can subscribe to the EventEmitter to trigger
 * automatic snipes or other logic.
 *
 * This implementation is inspired by QuickNode's guide on tracking new
 * liquidity pools on Raydium using Solana WebSockets.  It
 * restricts logs to the Raydium legacy AMM v4 program by default,
 * identified by the program ID `675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8`.  Additional
 * program IDs may be provided via the constructor to monitor other DEXes.
 *
 * Additions for this project:
 *  - Accept an array of { programId, enabled } and subscribe only to those with enabled=true.
 *  - Include the slot on each emission as `detectedAtSlot`:
 *      { signature, programId, tokenA, tokenB, detectedAtSlot }
 */

'use strict';

const { Connection, PublicKey } = require('@solana/web3.js');
const EventEmitter = require('events');

// Default program IDs to watch. Raydium's AMM v4 program is the most widely
// used constant product pool on Solana.
const DEFAULT_PROGRAM_IDS = [
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium AMM v4
];

/**
 * Normalize a user-provided program configuration into a consistent
 * array of { pubkey: PublicKey, enabled: boolean } objects.
 * Accepts either an array of strings (program IDs) or an array of
 * { programId, enabled } objects.
 */
function normalizePrograms(input) {
  if (!input) {
    return DEFAULT_PROGRAM_IDS.map((id) => ({ pubkey: new PublicKey(id), enabled: true }));
  }
  // Array of strings -> enable all
  if (Array.isArray(input) && input.every((v) => typeof v === 'string')) {
    return input.map((id) => ({ pubkey: new PublicKey(id), enabled: true }));
  }
  // Array of objects -> map/validate
  if (Array.isArray(input)) {
    return input
      .filter((p) => p && typeof p.programId === 'string')
      .map((p) => ({
        pubkey: new PublicKey(p.programId),
        enabled: p.enabled !== false, // default true
      }));
  }
  // Fallback to defaults
  return DEFAULT_PROGRAM_IDS.map((id) => ({ pubkey: new PublicKey(id), enabled: true }));
}

/**
 * Convert an http(s) RPC URL to the equivalent ws(s) URL.
 */
function toWs(rpcUrl) {
  if (rpcUrl.startsWith('https://')) return rpcUrl.replace('https://', 'wss://');
  if (rpcUrl.startsWith('http://')) return rpcUrl.replace('http://', 'ws://');
  return rpcUrl; // assume already ws(s)
}

class PoolWatcher extends EventEmitter {
  /**
   * Create a new PoolWatcher.
   *
   * @param {string} rpcUrl RPC endpoint for the WebSocket connection.
   * @param {string[]|{programId: string, enabled?: boolean}[]} programs
   *        Either a list of program IDs to filter logs by, or an
   *        array of objects with {programId, enabled}.
   */
  constructor(rpcUrl, programs = DEFAULT_PROGRAM_IDS) {
    super();
    this.rpcUrl = rpcUrl;
    this.programs = normalizePrograms(programs);
    this.connection = new Connection(this.rpcUrl, {
      commitment: 'confirmed',
      wsEndpoint: toWs(this.rpcUrl),
    });
    this.subscriptions = [];
    this.running = false;
  }

  /**
   * Start listening for logs on enabled program IDs.  When a log
   * contains `InitializePool` or `AddLiquidity`, the transaction is parsed
   * to extract token accounts at expected positions, and a `poolDetected`
   * event is emitted with the token mints.
   */
  async start() {
    if (this.running) return;
    this.running = true;

    for (const { pubkey, enabled } of this.programs) {
      if (!enabled) continue;
      const subId = await this.connection.onLogs(
        pubkey,
        async (logInfo) => {
          try {
            const { signature, logs, slot } = logInfo;
            const text = Array.isArray(logs) ? logs.join(' ') : String(logs || '');
            // Heuristically detect pool creation or liquidity add instructions
            if (/InitializePool|initialize2|AddLiquidity/i.test(text)) {
              // Fetch and parse the transaction to extract token mints
              const tx = await this.connection.getParsedTransaction(signature, {
                maxSupportedTransactionVersion: 0,
                commitment: 'confirmed',
              });
              const instructions = tx?.transaction?.message?.instructions || [];
              for (const ix of instructions) {
                // Only process instructions belonging to the watched program
                if (ix.programId && new PublicKey(ix.programId).equals(pubkey)) {
                  const accounts = ix.accounts || [];
                  // Based on QuickNode's example, token A/B accounts are at positions 8 and 9
                  const tokenA = accounts[8];
                  const tokenB = accounts[9];
                  if (tokenA && tokenB) {
                    const tokenAStr = typeof tokenA === 'string' ? tokenA : tokenA.toBase58?.() || String(tokenA);
                    const tokenBStr = typeof tokenB === 'string' ? tokenB : tokenB.toBase58?.() || String(tokenB);
                    this.emit('poolDetected', {
                      signature,
                      programId: pubkey.toBase58(),
                      tokenA: tokenAStr,
                      tokenB: tokenBStr,
                      detectedAtSlot: slot,
                    });
                  }
                }
              }
            }
          } catch (err) {
            console.error('PoolWatcher parse error:', err?.message || err);
          }
        },
        'confirmed'
      );
      this.subscriptions.push(subId);
    }
  }

  /**
   * Stop listening to logs and clean up subscriptions.
   */
  async stop() {
    this.running = false;
    for (const subId of this.subscriptions) {
      try {
        await this.connection.removeOnLogsListener(subId);
      } catch (_) {
        /* ignore */
      }
    }
    this.subscriptions = [];
  }
}

module.exports = PoolWatcher;
