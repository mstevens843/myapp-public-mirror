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
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

module.exports = validateEnv;