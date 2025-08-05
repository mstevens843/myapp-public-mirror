/** TIME & UTILITY HELPERS
 * - Provides small reusable utilities for timestamps, delays, and async flows. 
 * 
 * Features: 
 * - nowISO(): returns current ISO 8601 timestamp 
 * - wait(ms): awaitable timeout wrapper (sleep) 
 * 
 * Usage: 
 * Used across strategies for logging timestamps or pausing between actions 
 */


/** Retuerns current time in ISO string format
 * ISO timestamp (e.g. 2025-04-18T03:03:33:45.578Z)
 */
function nowISO() {
    return new Date().toISOString();
  }
  
  /** 
   * Waits asynchrously for `ms` in milliseconds
   * ms - milliseconds to wait 
   * returns promise, resolves after timeout. 
   */
  function wait(ms) {
    return new Promise((res) => setTimeout(res, ms));
  }
  
  module.exports = { nowISO, wait };
  