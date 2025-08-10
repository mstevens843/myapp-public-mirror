/** Scheduler Utilities 
 * - Provides helper functions to run bot actions repeatedlyy or after a delay. 
 * 
 * Features: 
 * - runInterval(fn, interval): runs a function every `interval` milliseconds. 
 * - runWithDelay(fn, delay): runs a function once after a `delay` in milliseconds
 * 
 * Usage: 
 * - Used in strategies for polling price feeds, checking trade conditions, etc. 
 */


/**
 * Repeatedly runs the given async function every `interval` ms
 * @param {Function} fn - async function to run
 * @param {*} interval - interval in milliseconds
 */
function runInterval(fn, interval) {
    setInterval(async () => {
      try {
        await fn();
      } catch (err) {
        console.error("Scheduler error:", err.message);
      }
    }, interval);
  }
  
  /**
   * Runs the given async function once after a specific delay. 
   * @param {Function} fn - async function to run 
   * @param {*} delay - delay in milliseconds
   */
  function runWithDelay(fn, delay) {
    setTimeout(async () => {
      try {
        await fn();
      } catch (err) {
        console.error("Delayed run error:", err.message);
      }
    }, delay);
  }
  
  module.exports = {
    runInterval,
    runWithDelay,
  };
  