// backend/services/airdrops/sniffer.js
//
// Airdrop and dust sniffer. Subscribes to token account updates for
// configured wallets and attempts to identify unsolicited airdrops
// (commonly scam tokens) or small dust transfers. Depending on
// configuration the sniffer can automatically sell whitelisted
// tokens exceeding a minimum USD value. Only safe swap paths are
// used – no arbitrary approval signing is performed.

'use strict';

const { Connection, PublicKey } = require('@solana/web3.js');
const fetch = require('node-fetch');
const { incCounter, observeHistogram } = require('../logging/metrics');

// Token Program ID for SPL tokens
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

class AirdropSniffer {
  constructor() {
    this.connection = null;
    this.config = null;
    this.walletWatchers = new Map(); // walletId -> subscriptionId
    this.lastBalances = new Map(); // mint -> last amount per wallet
  }

  /**
   * Start sniffing for airdrops on the given connection and wallets.
   *
   * @param {Object} opts
   * @param {Connection} opts.connection A web3.js connection.
   * @param {string[]} opts.walletIds Wallet public keys (owners) to watch.
   * @param {Object} opts.config Airdrop config.
   * @param {Function} opts.sellFn Async function to execute a sell. It will
   *   be called with ({ walletId, mint, amount, idKey }). Must return a promise.
   */
  start({ connection, walletIds = [], config = {}, sellFn }) {
    if (!config.enabled) return;
    this.connection = connection;
    this.config = Object.assign({
      autoSell: true,
      whitelistMints: [],
      minUsdValue: 5,
      maxSellSlippagePct: 1.0,
    }, config);
    if (!Array.isArray(walletIds) || walletIds.length === 0) return;
    // Set up watchers for each wallet
    walletIds.forEach((walletId) => {
      if (this.walletWatchers.has(walletId)) return;
      const pubkey = new PublicKey(walletId);
      const callback = async (accountInfo, context) => {
        try {
          // accountInfo.accountId corresponds to an SPL token account
          const owner = accountInfo.account.owner.toString();
          if (owner !== walletId) return; // ignore non‑owned
          const data = accountInfo.account.data;
          // decode SPL token account to extract mint and amount
          const mint = new PublicKey(data.slice(0, 32)).toString();
          const amountBuf = data.slice(64, 72);
          let amount = 0;
          for (let i = 0; i < amountBuf.length; i++) {
            amount = amount * 256 + amountBuf[i];
          }
          const key = `${walletId}:${mint}`;
          const last = this.lastBalances.get(key) || 0;
          if (amount <= last) return; // not an increase
          this.lastBalances.set(key, amount);
          const delta = amount - last;
          // Skip if in whitelistMints is defined and mint not in list
          if (this.config.whitelistMints && this.config.whitelistMints.length > 0 && !this.config.whitelistMints.includes(mint)) {
            // ignore unknown token
            return;
          }
          // Heuristics: skip tokens with absurd supply/decimals – this would
          // require fetching mint info; omitted here for brevity.
          incCounter('airdrops_detected_total');
          // Determine USD value via Birdeye
          let usdValue = 0;
          try {
            const resp = await fetch(`https://public-api.birdeye.so/public/price?address=${mint}`);
            const json = await resp.json();
            usdValue = (json?.data?.value || 0) * (delta / (10 ** (json?.data?.decimals || 0)));
          } catch (e) {
            // If price unknown, treat as zero
            usdValue = 0;
          }
          if (usdValue < this.config.minUsdValue) {
            return;
          }
          if (this.config.autoSell) {
            // Build idempotency key bucket by minute
            const tsBucket = Math.floor(Date.now() / 1000 / 60);
            const idKey = require('crypto').createHash('sha256').update(`${walletId}|${mint}|${tsBucket}`).digest('hex');
            await sellFn({ walletId, mint, amount: delta, idKey, maxSlippage: this.config.maxSellSlippagePct });
            incCounter('airdrops_autosold_total');
            observeHistogram('airdrops_value_usd_sum', usdValue);
          }
        } catch (err) {
          // Ignore errors – airdrop sniffer should never crash the sniper
        }
      };
      // Subscribe to program account changes for SPL token accounts owned by the wallet
      const subId = this.connection.onProgramAccountChange(
        TOKEN_PROGRAM_ID,
        (info, ctx) => callback(info, ctx),
        'confirmed',
        [{ dataSize: 165 }, { memcmp: { offset: 32, bytes: pubkey.toBase58() } }],
      );
      this.walletWatchers.set(walletId, subId);
    });
  }

  /**
   * Stop all subscriptions and clean up.
   */
  stop() {
    if (!this.connection) return;
    this.walletWatchers.forEach((subId, walletId) => {
      try {
        this.connection.removeProgramAccountChangeListener(subId);
      } catch (e) {
        // ignore
      }
    });
    this.walletWatchers.clear();
    this.lastBalances.clear();
  }
}

module.exports = new AirdropSniffer();