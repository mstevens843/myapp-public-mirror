/**
 * Feature flag middleware
 *
 * This Express middleware checks every incoming request path against the
 * disabled endpoint prefixes defined in backend/config/featureFlags.js.  If
 * the request targets a disabled endpoint a 503 Service Unavailable
 * response is returned.  Otherwise the request proceeds to the next
 * middleware.  This layer runs before authentication to ensure blocked
 * endpoints are short‑circuited as early as possible.
 */

const { isEndpointEnabled } = require('../config/featureFlags');

module.exports = function featureFlagMiddleware(req, res, next) {
  try {
    const path = req.path || req.originalUrl || '';
    if (!isEndpointEnabled(path)) {
      return res
        .status(503)
        .json({ error: 'This endpoint is disabled by feature flag' });
    }
  } catch (err) {
    // If the feature flag check throws we fail open to avoid blocking the API
    console.error('Feature flag middleware error:', err);
  }
  next();
};