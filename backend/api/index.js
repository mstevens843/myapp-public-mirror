const express = require("express");
const router = express.Router();

const modeRouter = require("./modes");
const tradeRouter = require("./trades");
const portfolio = require("./portfolio.js");
const walletBalance = require("./wallets");
const manualRouter = require("./manual");
const telegramRouter = require("./telegram");
const launchMulti = require("./launch-multi");
const orders = require("./orders.js");
const tpsl = require("./tpsl");
const prefs = require("./prefs.js");
const safety = require("./safety.js");
const auth = require("./auth.js");
const { authLimiter } = require('../middleware/rateLimit');
const paymentRoutes = require('./payment');
const accountsRoute = require("./accounts");
const schedulerRoutes = require("./schedulerRoutes");
const internalRouter = require("./internalJobs"); // 👈 add require here
const healthRouter   = require("./health");
const requireAuth = require("../middleware/requireAuth");
const armEncryptionRouter = require("./armSessions")
console.log("✅ API router loaded.");

// 🔍 Global log to see every hit on /api
router.use((req, res, next) => {
  console.log(`➡️ API HIT: ${req.method} ${req.path}`);
  next();
});

// 🧠 Apply `requireAuth` for ALL routes below EXCEPT /auth & /payment
router.use((req, res, next) => {
  if (
    req.path.startsWith("/auth") || 
    req.path.startsWith("/payment") ||
    req.path.startsWith("/internalJobs")
  ) {
    console.log("🔓 Public or internal route, skipping requireAuth:", req.path);
    return next();
  }
  console.log("🔒 Protected route, applying requireAuth:", req.path);
  requireAuth(req, res, next);
});

// Attach all API sub-routes
router.use("/mode", (req, res, next) => {
  console.log("⚙️ /mode router hit");
  req.setModeProcess = (proc) => {
    req.currentModeProcess = proc;
  };
  next();
}, modeRouter);

router.use("/trades", tradeRouter);
console.log("✅ /trades router loaded");
router.use("/portfolio", portfolio);
console.log("✅ /portfolio router loaded");
router.use("/wallets", walletBalance);
console.log("✅ /wallets router loaded");
router.use("/manual", manualRouter);
console.log("✅ /manual router loaded");
router.use("/telegram", telegramRouter);
console.log("✅ /telegram router loaded");
router.use("/launch-multi", launchMulti);
console.log("✅ /launch-multi router loaded");
router.use("/orders", orders);
console.log("✅ /orders router loaded");
router.use("/tpsl", tpsl);
console.log("✅ /tpsl router loaded");
router.use("/prefs", prefs);
console.log("✅ /prefs router loaded");
router.use("/safety", safety);
console.log("✅ /safety router loaded");
router.use("/schedule", schedulerRoutes);
console.log("✅ /schedule router loaded");
// Apply a stricter rate limit on authentication endpoints to mitigate brute
// force attempts.  See middleware/rateLimit.js for configuration.
router.use("/auth", authLimiter, auth);
console.log("✅ /auth router loaded");
router.use('/payment', paymentRoutes);
console.log("✅ /payment router loaded");
router.use("/account", accountsRoute);
console.log("✅ /account router loaded");
router.use("/internalJobs", internalRouter);
router.use("/arm-encryption", armEncryptionRouter);
// Health API for bot liveness and metrics
router.use("/health", healthRouter);

console.log("✅ /internalJobs router loaded");

module.exports = router;