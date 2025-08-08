/**
 * Ensures that critical environment variables are defined.  If any required
 * variables are missing this function throws an error before the server
 * starts.  This helps avoid undefined behaviour and makes misconfigurations
 * obvious during deployment.  Extend the `required` array as additional
 * secrets and connection strings are introduced.
 */
function validateEnv() {
  const required = [
    'PORT',
    'DATABASE_URL',
    'JWT_SECRET',
    'SOLANA_RPC_URL',
    'ENCRYPTION_SECRET',
  ];
  const missingRequired = required.filter((k) => !process.env[k]);
  if (missingRequired.length) {
    throw new Error(`Missing required environment variables: ${missingRequired.join(', ')}`);
  }
 // Warn about optional variables that are not set.  These control features
  // like payments, rate limiting, CSP behaviour and metrics collection.  To
  // avoid cluttering logs in production we only warn in non-production
  // environments.
  if (process.env.NODE_ENV !== 'production') {
    const optional = [
      'STRIPE_SECRET_KEY',
      'STRIPE_ENDPOINT_SECRET',
      'STRIPE_PRICE_STANDARD',
      'STRIPE_PRICE_PRO',
      'RATE_LIMIT_WINDOW_MS',
      'RATE_LIMIT_MAX_REQUESTS',
      'AUTH_RATE_LIMIT_WINDOW_MS',
      'AUTH_RATE_LIMIT_MAX_REQUESTS',
      'CORS_ALLOWED_ORIGINS',
      'FRONTEND_URL',
      'ENABLE_CSP_REPORT_ONLY',
      'METRICS_ENABLED',
      'ENCRYPTION_SECRET_OLD',
   ];
    optional.forEach((key) => {
      if (!process.env[key]) {
        console.warn(`[config] Optional env var ${key} is not set`);
      }
    });
  }
}

module.exports = validateEnv;