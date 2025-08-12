// backend/prisma/prisma.js
//
// Prisma client instantiation with optional row‑level security (RLS)
// support.  When FEATURE_RLS_PILOT is truthy an AsyncLocalStorage is
// created and a Prisma middleware sets `app.user_id` for each query.
// This allows Postgres RLS policies to reference the current user.  The
// AsyncLocalStorage instance is exported alongside the client for
// consumption by the API router.

'use strict';

const { PrismaClient } = require('@prisma/client');
const { AsyncLocalStorage } = require('async_hooks');

const prisma = new PrismaClient();
let asyncLocalStorage = null;

const isRlsEnabled = (() => {
  const flag = process.env.FEATURE_RLS_PILOT;
  if (!flag) return false;
  return /^(1|true|yes)$/i.test(flag.trim());
})();

if (isRlsEnabled) {
  asyncLocalStorage = new AsyncLocalStorage();
  prisma.$use(async (params, next) => {
    const userId = asyncLocalStorage.getStore();
    if (userId) {
      try {
        await prisma.$executeRawUnsafe(`set local app.user_id = '${userId}'`);
      } catch (err) {
        console.error('RLS pilot: failed to set app.user_id', err.message);
      }
    }
    return next(params);
  });
}

module.exports = prisma;
module.exports.asyncLocalStorage = asyncLocalStorage;