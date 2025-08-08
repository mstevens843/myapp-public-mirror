// Re-export the metrics helpers from the middleware module.  Many parts
// of the codebase import metrics via `./utils/metrics`, so to avoid
// refactoring those references we proxy through to the actual
// implementation in `middleware/metrics.js`.  See that file for
// detailed documentation.

module.exports = require('../middleware/metrics');