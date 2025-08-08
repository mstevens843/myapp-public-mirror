/*
 * Simple AsyncLocalStorage-based request context helper.
 *
 * This module provides a mechanism to propagate per-request
 * metadata, such as the `req.id` identifier assigned in
 * `middleware/requestId.js`, across asynchronous boundaries.
 *
 * The context is initialised for each incoming request via
 * the requestId middleware.  Downstream modules can then call
 * `getReqId()` to retrieve the current request ID without
 * explicitly threading it through every function call.  This is
 * particularly useful for logging and external HTTP calls where
 * correlating logs with the originating request is important.
 */

const { AsyncLocalStorage } = require('async_hooks');

// Single global instance for the application.  Storing multiple
// AsyncLocalStorage instances doesn’t buy us anything here and
// complicates teardown.
const storage = new AsyncLocalStorage();

/**
 * Run the supplied function within a request context.  The context
 * contains the request identifier and can hold additional fields in
 * the future.  Callers should never nest runs; each request should
 * create one top-level context.  Additional nested runs will just
 * shadow the existing context.
 *
 * @param {string} reqId The identifier assigned to the incoming request
 * @param {Function} fn   The function to execute within the context
 */
function runWithReqId(reqId, fn) {
  storage.run({ reqId }, fn);
}

/**
 * Retrieve the current request ID from the AsyncLocalStorage.  If no
 * context exists (e.g. outside of an HTTP request) this returns
 * `undefined`.  Consumers should gracefully handle an undefined ID.
 *
 * @returns {string|undefined} The current request identifier
 */
function getReqId() {
  const store = storage.getStore();
  return store ? store.reqId : undefined;
}

module.exports = { runWithReqId, getReqId };