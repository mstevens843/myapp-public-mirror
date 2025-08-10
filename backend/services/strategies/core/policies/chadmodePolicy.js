/**
 * Risk policy for Chad Mode.
 *
 * Chad mode is manual first.  The risk policy here serves as a
 * placeholder for optional guardrails (like equityâ€‘based throttles
 * or panicâ€‘partial hotkeys).  Users should primarily control their
 * own exit, so these functions default to noâ€‘ops.
 */

module.exports = {
  /**
   * For manual trades we typically donâ€™t move the stop; return null.
   *
   * @returns {null} always null
   */
  nextStop() {
    return null;
  },

  /**
   * Manual modes never autoâ€‘exit â€” return false to defer to the user.
   *
   * @returns {boolean} always false
   */
  shouldExit() {
    return false;
  },
};