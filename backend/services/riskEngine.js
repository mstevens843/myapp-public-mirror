/**
 * Cross-strategy risk engine
 *
 * The risk engine centralises exposure and loss tracking across all trading
 * strategies. It enforces per-user limits on daily realised losses, maximum
 * concurrent exposure (in USD), per-token caps and sector caps. When a limit
 * is breached further trades are blocked via a kill switch until manually
 * reset by an administrator. Each user has independent state; exposures are
 * reset daily at UTC midnight. Limits are loaded from environment variables
 * or sensible defaults.
 *
 * Integrators should call `checkTrade` before executing a trade. This will
 * return an object containing the allowed amount (lamports) given the
 * remaining risk budget. After a successful trade call `recordTrade` to
 * update exposure tracking. To handle realised losses call `recordLoss`.
 */

const EventEmitter = require('events');
const prisma = require('../prisma/prisma');
const logger = require('../utils/logger');

// Default risk limits. These can be overridden via environment variables
const MAX_DAILY_LOSS = parseFloat(process.env.RISK_MAX_DAILY_LOSS || '1000'); // USD
const MAX_CONCURRENT_EXPOSURE = parseFloat(process.env.RISK_MAX_CONCURRENT_EXPOSURE || '5000'); // USD
// Per-token caps (USD). Comma-separated list of mint:cap pairs
const TOKEN_CAPS = process.env.RISK_TOKEN_CAPS
  ? Object.fromEntries(process.env.RISK_TOKEN_CAPS.split(',').map((p) => {
      const [mint, cap] = p.split(':');
      return [mint.trim(), parseFloat(cap)];
    }))
  : {};
// Per-sector caps (USD). Comma-separated list of sector:cap pairs
const SECTOR_CAPS = process.env.RISK_SECTOR_CAPS
  ? Object.fromEntries(process.env.RISK_SECTOR_CAPS.split(',').map((p) => {
      const [sector, cap] = p.split(':');
      return [sector.trim(), parseFloat(cap)];
    }))
  : {};

// Map of mint → sector classification. Real implementation would fetch on-chain
// metadata. For now, this is configurable via env (mint:sector,...)
const MINT_SECTORS = process.env.RISK_MINT_SECTORS
  ? Object.fromEntries(process.env.RISK_MINT_SECTORS.split(',').map((p) => {
      const [mint, sector] = p.split(':');
      return [mint.trim(), sector.trim()];
    }))
  : {};

class RiskEngine extends EventEmitter {
  constructor() {
    super();
    // exposures[userId] = { totalExposure, dailyLoss, perMint:{mint:exposure}, perSector:{sector:exposure} }
    this.exposures = new Map();
    // kill switches
    this.killSwitches = new Map();
    // Schedule daily reset at UTC midnight
    this._scheduleDailyReset();
  }

  /**
   * Ensure state exists for user
   * @param {string} userId
   */
  _ensure(userId) {
    if (!this.exposures.has(userId)) {
      this.exposures.set(userId, {
        totalExposure: 0,
        dailyLoss: 0,
        perMint: new Map(),
        perSector: new Map(),
      });
    }
    if (!this.killSwitches.has(userId)) {
      this.killSwitches.set(userId, false);
    }
  }

  /**
   * Schedules daily reset of exposures and loss counters. Resets occur at
   * 00:00 UTC. A timeout is computed relative to now and then an interval
   * fires every 24h.
   */
  _scheduleDailyReset() {
    const now = new Date();
    const nextUtcMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const delay = nextUtcMidnight - now;
    setTimeout(() => {
      this._resetDaily();
      setInterval(() => this._resetDaily(), 24 * 60 * 60 * 1000);
    }, delay);
  }

  _resetDaily() {
    logger.info('Resetting daily risk counters');
    for (const [userId, state] of this.exposures) {
      state.dailyLoss = 0;
      state.totalExposure = 0;
      state.perMint.clear();
      state.perSector.clear();
    }
    // Reset persistent state
    prisma.userRiskState.updateMany({ data: { dailyLossUsd: 0, exposureUsd: 0, exposuresJson: '{}' } }).catch(() => {});
  }

  /**
   * Check if the user is currently under a kill switch.
   * @param {string} userId
   */
  isKilled(userId) {
    return this.killSwitches.get(userId) === true;
  }

  /**
   * Trigger the kill switch for a user. This prevents any further trades
   * until an administrator resets it. Emits a `kill` event.
   * @param {string} userId
   * @param {string} reason
   */
  triggerKillSwitch(userId, reason) {
    this.killSwitches.set(userId, true);
    logger.warn(`Risk kill switch activated for user ${userId}: ${reason}`);
    // Persist kill switch
    prisma.userRiskState
      .upsert({
        where: { userId },
        update: { killSwitch: true, killEngagedAt: new Date() },
        create: { userId, killSwitch: true, killEngagedAt: new Date(), exposuresJson: '{}' },
      })
      .catch(() => {});
    this.emit('kill', { userId, reason });
  }

  /**
   * Reset the kill switch for a user, allowing trading to resume.
   * @param {string} userId
   */
  resetKillSwitch(userId) {
    this.killSwitches.set(userId, false);
    prisma.userRiskState
      .update({ where: { userId }, data: { killSwitch: false, killEngagedAt: null } })
      .catch(() => {});
    logger.info(`Risk kill switch reset for user ${userId}`);
  }

  /**
   * Compute the maximum allowable USD exposure for a trade given the current
   * state. Returns an object with `allowed` boolean and `maxUsd` number.
   *
   * @param {string} userId
   * @param {string} mint
   */
  _remainingExposure(userId, mint) {
    this._ensure(userId);
    const state = this.exposures.get(userId);
    if (this.isKilled(userId)) {
      return { allowed: false, maxUsd: 0, reason: 'Kill switch active' };
    }
    const totalRemaining = Math.max(0, MAX_CONCURRENT_EXPOSURE - state.totalExposure);
    const tokenCap = TOKEN_CAPS[mint] || MAX_CONCURRENT_EXPOSURE;
    const perMintRemaining = Math.max(0, tokenCap - (state.perMint.get(mint) || 0));
    const sector = MINT_SECTORS[mint];
    let perSectorRemaining = Infinity;
    if (sector) {
      const sectorCap = SECTOR_CAPS[sector] || MAX_CONCURRENT_EXPOSURE;
      perSectorRemaining = Math.max(0, sectorCap - (state.perSector.get(sector) || 0));
    }
    const maxUsd = Math.min(totalRemaining, perMintRemaining, perSectorRemaining);
    return { allowed: maxUsd > 0, maxUsd };
  }

  /**
   * Check whether a proposed trade of a certain USD value is permitted. If
   * permitted it returns the remaining budget; if not permitted it returns
   * allowed=false and reason. Callers may use this to size trades down.
   *
   * @param {string} userId
   * @param {string} mint
   * @param {number} proposedUsd
   */
  checkTrade(userId, mint, proposedUsd) {
    this._ensure(userId);
    const state = this.exposures.get(userId);
    const lossRemaining = Math.max(0, MAX_DAILY_LOSS - state.dailyLoss);
    if (lossRemaining <= 0) {
      this.triggerKillSwitch(userId, 'Max daily loss reached');
      return { allowed: false, reason: 'Max daily loss reached' };
    }
    const { allowed, maxUsd } = this._remainingExposure(userId, mint);
    if (!allowed) {
      this.triggerKillSwitch(userId, 'Exposure limits exceeded');
      return { allowed: false, reason: 'Exposure limits exceeded' };
    }
    const allowedUsd = Math.min(maxUsd, proposedUsd, lossRemaining);
    return { allowed: allowedUsd > 0, maxUsd: allowedUsd };
  }

  /**
   * Record a trade exposure. Must be called after a trade is executed.
   *
   * @param {string} userId
   * @param {string} mint
   * @param {number} usdAmount
   */
  recordTrade(userId, mint, usdAmount) {
    this._ensure(userId);
    const state = this.exposures.get(userId);
    state.totalExposure += usdAmount;
    state.perMint.set(mint, (state.perMint.get(mint) || 0) + usdAmount);
    const sector = MINT_SECTORS[mint];
    if (sector) {
      state.perSector.set(sector, (state.perSector.get(sector) || 0) + usdAmount);
    }
    // Persist aggregated exposure; exposuresJson stores perMint and perSector
    const exposuresJson = {};
    for (const [m, v] of state.perMint.entries()) exposuresJson[m] = v;
    for (const [s, v] of state.perSector.entries()) exposuresJson[`${s}`] = v;
    prisma.userRiskState
      .upsert({
        where: { userId },
        update: {
          exposureUsd: state.totalExposure,
          exposuresJson: JSON.stringify(exposuresJson),
        },
        create: {
          userId,
          dailyLossUsd: state.dailyLoss,
          exposureUsd: state.totalExposure,
          exposuresJson: JSON.stringify(exposuresJson),
        },
      })
      .catch(() => {});
  }

  /**
   * Record realised loss for a trade. Used when closing a position.
   *
   * @param {string} userId
   * @param {string} mint
   * @param {number} usdLoss
   */
  recordLoss(userId, mint, usdLoss) {
    this._ensure(userId);
    const state = this.exposures.get(userId);
    state.dailyLoss += Math.max(0, usdLoss);
    // Reduce exposure for mint/sector and total. Losses free up exposure.
    state.totalExposure = Math.max(0, state.totalExposure - usdLoss);
    state.perMint.set(mint, Math.max(0, (state.perMint.get(mint) || 0) - usdLoss));
    const sector = MINT_SECTORS[mint];
    if (sector) {
      state.perSector.set(sector, Math.max(0, (state.perSector.get(sector) || 0) - usdLoss));
    }
    // Persist updated loss/exposure
    const exposuresJson = {};
    for (const [m, v] of state.perMint.entries()) exposuresJson[m] = v;
    for (const [s, v] of state.perSector.entries()) exposuresJson[`${s}`] = v;
    prisma.userRiskState
      .upsert({
        where: { userId },
        update: {
          dailyLossUsd: state.dailyLoss,
          exposureUsd: state.totalExposure,
          exposuresJson: JSON.stringify(exposuresJson),
        },
        create: {
          userId,
          dailyLossUsd: state.dailyLoss,
          exposureUsd: state.totalExposure,
          exposuresJson: JSON.stringify(exposuresJson),
        },
      })
      .catch(() => {});
  }
}

// Export a singleton
const riskEngine = new RiskEngine();
module.exports = riskEngine;