// backend/api/automationSessions.js
// Routes: arm / extend / disarm / status. 2FA-gated. Rate-limit recommended.
// Assumes prisma schema with `User(requireArmToTrade:boolean)` and `Wallet` table
// where wallet.encrypted (JSON) stores the envelope blob.
//
// Legacy support: if wallet.encrypted is *legacy* (iv:tag:cipher hex string),
// set `migrateLegacy=true` in the arm payload to upgrade-in-place.

// const express = require("express");
// const router = express.Router();

// const prisma = require("../prisma");
// const requireAuth = require("../middleware/requireAuth");
// const check2FA = require("../middleware/check2FA"); // user uploaded
// const { arm, extend, disarm, status } = require("../core/crypto/sessionKeyCache");
// const { unwrapDEKWithPassphrase, encryptPrivateKey } = require("../core/crypto/envelopeCrypto");
// const legacy = require("../middleware/auth/encryption"); // your legacy (iv:tag:cipher) helper

// // helpers
// function ttlClamp(min, def, max, reqVal) {
//   const n = Number(reqVal || def);
//   return Math.max(min, Math.min(n, max));
// }

// router.post("/arm", requireAuth, check2FA, async (req, res) => {
//   try {
//     const { walletId, passphrase, ttlMinutes, migrateLegacy } = req.body || {};
//     if (!walletId || !passphrase) return res.status(400).json({ error: "walletId & passphrase required" });

//     const userId = req.user.id;
//     const wallet = await prisma.wallet.findFirst({
//       where: { id: walletId, userId },
//       select: { id: true, label: true, encrypted: true }
//     });
//     if (!wallet) return res.status(404).json({ error: "Wallet not found" });

//     let blob = wallet.encrypted;

//     // If legacy string (colon-separated hex), optionally migrate to envelope
//     if (typeof blob === "string" && blob.includes(":")) {
//       if (!migrateLegacy) return res.status(400).json({ error: "Legacy format: set migrateLegacy=true to upgrade" });
//       // decrypt with legacy env key, then re-encrypt with envelope using user's passphrase
//       const pkBuf = legacy.decrypt(blob, { aad: `user:${userId}:wallet:${walletId}` }); // legacy module may ignore AAD
//       const wrapped = await encryptPrivateKey(pkBuf, {
//         passphrase,
//         aad: `user:${userId}:wallet:${walletId}`
//       });
//       pkBuf.fill(0);
//       await prisma.wallet.update({ where: { id: walletId }, data: { encrypted: wrapped, isProtected: true } });
//       blob = wrapped;
//     }

//     if (!blob || blob.v !== 1) return res.status(400).json({ error: "Unsupported wallet format; upgrade required" });

//     // Unwrap DEK with passphrase
//     const DEK = await unwrapDEKWithPassphrase(blob, passphrase);

//     // Cache DEK in memory with TTL
//     const ttlMin = ttlClamp(30, 240, 720, ttlMinutes); // clamp: min30, default240(=4h), max12h
//     arm(userId, walletId, DEK, ttlMin * 60_000);
//     // NOTE: do NOT zeroize DEK here—it's held in memory until disarm/expiry.

//     return res.json({
//       ok: true,
//       walletId,
//       label: wallet.label,
//       armedForMinutes: ttlMin
//     });
//   } catch (e) {
//     return res.status(400).json({ error: e.message || "arm failed" });
//   }
// });

// router.post("/extend", requireAuth, check2FA, async (req, res) => {
//   const { walletId, ttlMinutes } = req.body || {};
//   if (!walletId) return res.status(400).json({ error: "walletId required" });
//   const ttlMin = ttlClamp(30, 120, 720, ttlMinutes);
//   const ok = extend(req.user.id, walletId, ttlMin * 60_000);
//   if (!ok) return res.status(400).json({ error: "Not armed" });
//   return res.json({ ok: true, walletId, extendedToMinutes: ttlMin });
// });

// router.post("/disarm", requireAuth, check2FA, async (req, res) => {
//   const { walletId } = req.body || {};
//   if (!walletId) return res.status(400).json({ error: "walletId required" });
//   disarm(req.user.id, walletId);
//   return res.json({ ok: true, walletId, disarmed: true });
// });

// router.get("/status/:walletId", requireAuth, async (req, res) => {
//   const { walletId } = req.params;
//   const s = status(req.user.id, walletId);
//   return res.json({ walletId, ...s });
// });

// module.exports = router;


// backend/api/armSession.js
const express = require('express');
const { body, validationResult } = require('express-validator');
const sessionMgr = require('../services/armSessionManager');
const { unwrapDEK } = require('../utils/encryption/armEncryption');

// Replace this with your real 2FA verification
const verify2FA = async (userId, code) => true;

const router = express.Router();
const TTL_PRESETS = { '2h': 2 * 60 * 60 * 1000, '4h': 4 * 60 * 60 * 1000, '8h': 8 * 60 * 60 * 1000 };

router.post('/start', [
  body('walletId').notEmpty(),
  body('passphrase').isString().isLength({ min: 1 }),
  body('ttl').isString(),
  body('code').isString().optional(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: 'Invalid params', details: errors.array() });
  const { user } = req;
  const { walletId, passphrase, ttl, ttlMs, code } = req.body;
  if (!(await verify2FA(user.id, code)))
    return res.status(401).json({ error: 'Invalid 2FA code' });
  const wallet = await req.prisma.wallet.findUnique({ where: { id: walletId, userId: user.id } });
  if (!wallet || !wallet.isProtected)
    return res.status(400).json({ error: 'Wallet not protected or not found' });
  const dek = await unwrapDEK(wallet, passphrase);
  const ttlFinal = ttl === 'custom'
    ? Math.min(Math.max(Number(ttlMs), 5 * 60 * 1000), 24 * 60 * 60 * 1000)
    : (TTL_PRESETS[ttl] || TTL_PRESETS['4h']);
  sessionMgr.arm(user.id, walletId, dek, ttlFinal);
  res.json({
    walletId,
    label: wallet.label,
    expiresAt: Date.now() + ttlFinal,
  });
});

router.post('/extend', [
  body('walletId').notEmpty(),
  body('ttl').isString(),
  body('code').isString().optional(),
], async (req, res) => {
  const { user } = req;
  const { walletId, ttl, code } = req.body;
  if (!(await verify2FA(user.id, code)))
    return res.status(401).json({ error: 'Invalid 2FA code' });
  const extraMs = TTL_PRESETS[ttl] || TTL_PRESETS['2h'];
  const ok = sessionMgr.extend(user.id, walletId, extraMs);
  if (!ok) return res.status(400).json({ error: 'No active session to extend' });
  res.json({ expiresAt: Date.now() + extraMs });
});

router.post('/disarm', [
  body('walletId').notEmpty(),
  body('code').isString().optional(),
], async (req, res) => {
  const { user } = req;
  const { walletId, code } = req.body;
  if (!(await verify2FA(user.id, code)))
    return res.status(401).json({ error: 'Invalid 2FA code' });
  sessionMgr.disarm(user.id, walletId);
  res.json({ ok: true });
});

// GET /arm-session/status/:walletId
// Returns whether the session is armed and milliseconds left.
router.get('/status/:walletId', requireAuth, async (req, res) => {
  const { walletId } = req.params;
  if (!walletId) return res.status(400).json({ error: 'walletId required' });
  const { armed, msLeft } = sessionMgr.status(req.user.id, walletId);
  return res.json({ walletId, armed, msLeft });
});


module.exports = router;
