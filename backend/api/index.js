const express = require('express');
const router = express.Router();

const featureFlagMiddleware = require('../middleware/featureFlag');
const requestId = require('../middleware/requestId');
const idempotency = require('../middleware/idempotency');

const modeRouter = require('./modes');
const tradeRouter = require('./trades');
const portfolio = require('./portfolio.js');
const walletBalance = require('./wallets');
const manualRouter = require('./manual');
const telegramRouter = require('./telegram');
const launchMulti = require('./launch-multi');
const orders = require('./orders.js');
const tpsl = require('./tpsl');
const prefs = require('./prefs.js');
const safety = require('./safety.js');
const auth = require('./auth.js');
const { authLimiter } = require('../middleware/rateLimit');
const paymentRoutes = require('./payment');
const accountsRoute = require('./accounts');
const schedulerRoutes = require('./schedulerRoutes');
const internalRouter = require('./internalJobs');
const healthRouter = require('./health');
const requireAuth = require('../middleware/requireAuth');
const flagsRouter = require("./flags");
const { asyncLocalStorage } = require('../prisma/prisma');
const armEncryptionRouter = require('./armSessions');

console.log('✅ API router loaded.');

// 🔒 kill caching on auth/account endpoints
const noCache = (_req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');
  if (typeof res.removeHeader === 'function') res.removeHeader('ETag');
  next();
};

// 🔍 Global log to see every hit on /api
router.use((req, _res, next) => {
  console.log(`➡️ API HIT: ${req.method} ${req.path}`);
  next();
});

// Attach a request ID to all incoming requests
router.use(requestId);

// Feature flags
router.use(featureFlagMiddleware);

// Require auth everywhere except /auth, /payment, /internalJobs
router.use((req, res, next) => {
  if (
    req.path.startsWith('/auth') ||
    req.path.startsWith('/payment') ||
    req.path.startsWith('/internalJobs')
  ) {
    console.log('🔓 Public or internal route, skipping requireAuth:', req.path);
    return next();
  }
  console.log('🔒 Protected route, applying requireAuth:', req.path);
  requireAuth(req, res, next);
});

// ─────────────────── RLS pilot context ───────────────────
router.use((req, _res, next) => {
  try {
    if (!asyncLocalStorage) return next();
    const flag = process.env.FEATURE_RLS_PILOT;
    if (!flag || !/^(1|true|yes)$/i.test(flag.trim())) return next();

    const userId =
      (req.user && (req.user.id || req.user.userId || req.user.user_id)) || null;
    if (!userId) return next();

    asyncLocalStorage.run(userId, () => next());
  } catch (err) {
    console.error('RLS pilot middleware error:', err.message);
    return next();
  }
});

// ───────────────── Idempotency (POST only) ───────────────
router.use(async (req, res, next) => {
  if (req.method !== 'POST') return next();
  const { isEnabled } = require('../utils/featureFlags');
  if (!isEnabled('IDEMPOTENCY')) return next();
  try {
    await idempotency(req, res, next);
  } catch (err) {
    console.error('Idempotency middleware error:', err.message);
    return next();
  }
});

// Routers
router.use(
  '/mode',
  (req, _res, next) => {
    console.log('⚙️ /mode router hit');
    req.setModeProcess = (proc) => {
      req.currentModeProcess = proc;
    };
    next();
  },
  modeRouter
);

router.use('/trades', tradeRouter);
console.log('✅ /trades router loaded');
router.use('/portfolio', portfolio);
console.log('✅ /portfolio router loaded');
router.use('/wallets', walletBalance);
console.log('✅ /wallets router loaded');
router.use('/manual', manualRouter);
console.log('✅ /manual router loaded');
router.use('/telegram', telegramRouter);
console.log('✅ /telegram router loaded');
router.use('/launch-multi', launchMulti);
console.log('✅ /launch-multi router loaded');
router.use('/orders', orders);
console.log('✅ /orders router loaded');
router.use('/tpsl', tpsl);
console.log('✅ /tpsl router loaded');
router.use('/prefs', prefs);
console.log('✅ /prefs router loaded');
router.use('/safety', safety);
console.log('✅ /safety router loaded');
router.use('/schedule', schedulerRoutes);
console.log('✅ /schedule router loaded');

// 🔑 Auth: rate limit + NO CACHE
router.use('/auth', noCache, authLimiter, auth);
console.log('✅ /auth router loaded');

// 💳 Payments (webhooks etc.)
router.use('/payment', paymentRoutes);
console.log('✅ /payment router loaded');

// 👤 Account endpoints: NO CACHE
router.use('/account', noCache, accountsRoute);
console.log('✅ /account router loaded');

router.use('/internalJobs', internalRouter);
router.use('/arm-encryption', armEncryptionRouter);
router.use('/health', healthRouter);
console.log('✅ /internalJobs router loaded');
router.use("/flags", flagsRouter);

module.exports = router;
