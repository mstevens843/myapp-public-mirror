// backend/services/strategies/core/leaderScheduler.js
//
// This module encapsulates retrieval and caching of the Solana leader
// schedule. By caching the schedule for the duration of an epoch
// (approximately two days) we avoid redundant RPC calls on each
// trade and keep the hot path minimal. The scheduler exposes two
// primary methods: `nextLeaderWindow()` which returns the next
// upcoming window where our validator is leader, and
// `shouldHoldAndFire()` which takes timing configuration and returns
// how many milliseconds to hold before firing.

'use strict';

const { Connection, PublicKey } = require('@solana/web3.js');

class LeaderScheduler {
  /**
   * Construct a new LeaderScheduler.
   *
   * @param {Connection} connection A Solana web3.js connection. Must
   *   support getEpochInfo() and getLeaderSchedule().
   * @param {string|PublicKey} validatorIdentity The public key of
   *   this validator. Only slots for this identity will be
   *   considered when scheduling.
   */
  constructor(connection, validatorIdentity) {
    this.connection = connection;
    this.identity = typeof validatorIdentity === 'string'
      ? new PublicKey(validatorIdentity)
      : validatorIdentity;
    this.cachedEpoch = null;
    this.cachedSchedule = null; // array of slots for this.identity
    this.slotTimeMs = 400; // approximate slot time; updated on refresh
  }

  /**
   * Refresh the cached leader schedule if a new epoch has begun.
   * This method is called lazily by `nextLeaderWindow` and
   * `shouldHoldAndFire`. Errors during refresh are swallowed so that
   * the caller can gracefully degrade.
   */
  async refresh() {
    try {
      const epochInfo = await this.connection.getEpochInfo();
      if (this.cachedEpoch === epochInfo.epoch && this.cachedSchedule) {
        return;
      }
      // Estimate slot time from performance sample if available
      try {
        const samples = await this.connection.getRecentPerformanceSamples(1);
        if (samples && samples[0] && samples[0].samplePeriodSecs && samples[0].numSlots) {
          const secsPerSlot = samples[0].samplePeriodSecs / samples[0].numSlots;
       }
      } catch (e) {
        // swallow; fallback to default
      }
      const leaderSchedule = await this.connection.getLeaderSchedule(null);
      // leaderSchedule: { [validatorIdentity: string]: string[] }
      const keyStr = this.identity.toString();
      const slots = leaderSchedule && leaderSchedule[keyStr];
      if (Array.isArray(slots)) {
        // convert slot strings to numbers
        this.cachedSchedule = slots.map((s) => Number(s)).filter((n) => !isNaN(n));
      } else {
        this.cachedSchedule = null;
      }
      this.cachedEpoch = epochInfo.epoch;
    } catch (err) {
      // Could not refresh; clear cache so that subsequent calls know
      this.cachedSchedule = null;
      this.cachedEpoch = null;
    }
  }

  /**
   * Find the next slot where our validator is the leader and falls
   * within the specified window. If no such slot is found the
   * function returns null.
   *
   * @param {number} nowMs Current timestamp in milliseconds.
   * @param {number} windowSlots Number of slots ahead to consider for the window.
   * @returns {{startsAtMs: number, slot: number}|null}
   */
  async nextLeaderWindow(nowMs, windowSlots = 2) {
    await this.refresh();
    if (!Array.isArray(this.cachedSchedule) || this.cachedSchedule.length === 0) {
      return null;
    }
    let currentSlot;
    try {
      currentSlot = await this.connection.getSlot();
    } catch (e) {
      return null;
    }
    const maxSlot = currentSlot + windowSlots;
    const nextSlot = this.cachedSchedule.find((s) => s >= currentSlot && s <= maxSlot);
    if (nextSlot === undefined) return null;
    const slotsAway = nextSlot - currentSlot;
    const msUntilSlot = slotsAway * this.slotTimeMs;
    const startsAtMs = nowMs + msUntilSlot;
    return { startsAtMs, slot: nextSlot };
  }

  /**
   * Determine whether the caller should hold the transaction until
   * just before a leader slot. Returns an object with `holdMs`
   * specifying how many milliseconds to wait and `fireAt` which is
   * the timestamp at which to fire. If timing information is
   * unavailable the holdMs will be zero.
   *
   * @param {number} nowMs Current timestamp in milliseconds.
   * @param {Object} leaderTiming Configuration containing
   *        `preflightMs` (number) and `windowSlots` (number).
   * @returns {{holdMs:number, fireAt:number}}
   */
  async shouldHoldAndFire(nowMs, leaderTiming) {
    if (!leaderTiming || !leaderTiming.enabled) {
      return { holdMs: 0, fireAt: nowMs };
    }
    try {
      const window = await this.nextLeaderWindow(nowMs, leaderTiming.windowSlots);
      if (!window) {
        return { holdMs: 0, fireAt: nowMs };
      }
      const targetMs = window.startsAtMs - leaderTiming.preflightMs;
      const holdMs = Math.max(targetMs - nowMs, 0);
      return { holdMs, fireAt: targetMs };
    } catch (e) {
      return { holdMs: 0, fireAt: nowMs };
    }
  }
}

module.exports = LeaderScheduler;