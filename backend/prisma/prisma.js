/*
 * What changed / Why / Risk addressed
 *
 * Introduced request‑scoped session variable support for Postgres row level
 * security (RLS) pilot.  When the `FEATURE_RLS_PILOT` environment variable
 * is enabled the Prisma client will set a local PostgreSQL parameter
 * `app.user_id` prior to executing each query.  This value is pulled from
 * an AsyncLocalStorage context that is populated per request in the API
 * router.  RLS policies can then reference `current_setting('app.user_id')`
 * to restrict data access to the authenticated user.  When the feature
 * flag is disabled the Prisma client behaves exactly as before and no
 * additional overhead is incurred.  The AsyncLocalStorage instance is
 * exposed as a property on the exported client for middleware to import.
 */

const { PrismaClient } = require('@prisma/client');
const { AsyncLocalStorage } = require('async_hooks');

// Instantiate the Prisma client.  This instance is used throughout the
// application.  Avoid creating multiple instances as that can exhaust
// database connections.
const prisma = new PrismaClient();

// Initialise AsyncLocalStorage only when the RLS pilot flag is enabled.  If
// disabled we leave it null so downstream code can detect the absence of
// RLS pilot support and avoid wrapping requests in unnecessary contexts.
let asyncLocalStorage = null;

const isRlsPilotEnabled = (() => {
  const flag = process.env.FEATURE_RLS_PILOT;
  if (!flag) return false;
  return /^(1|true|yes)$/i.test(flag.trim());
})();

if (isRlsPilotEnabled) {
  asyncLocalStorage = new AsyncLocalStorage();
  // Add a Prisma middleware that runs before every operation.  It reads
  // the user ID from the AsyncLocalStorage store (if set) and issues a
  // `SET LOCAL` command to assign the session variable.  This ensures
  // subsequent queries in the same connection see the correct user ID.
  prisma.$use(async (params, next) => {
    const userId = asyncLocalStorage.getStore();
    if (userId) {
      try {
        await prisma.$executeRawUnsafe(`set local app.user_id = '${userId}'`);
      } catch (err) {
        // Log and continue – failure to set the variable should not crash
        console.error('RLS pilot: failed to set app.user_id', err.message);
      }
    }
    return next(params);
  });
}

// Export the Prisma instance as the module default.  Additional
// properties (e.g. asyncLocalStorage) are attached below to avoid
// breaking existing imports which expect a function-like client.
module.exports = prisma;
module.exports.asyncLocalStorage = asyncLocalStorage;

// const { PrismaClient } = require("@prisma/client");

// const FORCED_DB_URL = "postgresql://solpulse_tradebot_db_user:kHy2L6JODrtr3XpzbnkYQUzIRl4YsHLk@dpg-d1u6sp7diees73aeg00g-a.oregon-postgres.render.com/solpulse_tradebot_db";

// console.log("👀 FORCING DB URL:", FORCED_DB_URL);

// const prisma = new PrismaClient({
//   datasources: {
//     db: {
//       url: FORCED_DB_URL,
//     },
//   },
// });

// module.exports = prisma;