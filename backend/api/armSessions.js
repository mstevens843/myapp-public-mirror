// backend/api/armSessions.js
// Routes: arm / extend / disarm / status. 2FA-gated. Rate-limit recommended.
// Assumes prisma schema with `User(requireArmToTrade:boolean)` and `Wallet` table
// where wallet.encrypted (JSON) stores the envelope blob.

// Legacy support: if wallet.encrypted is *legacy* (iv:tag:cipher hex string),
// set `migrateLegacy=true` in the arm payload to upgrade-in-place.
const express = require("express");
const router = express.Router();
const { body, validationResult } = require("express-validator");

const argon2 = require("argon2"); // for pass‑phrase hashing when migrating

const prisma = require("../prisma/prisma");
const requireAuth = require("../middleware/requireAuth");
const check2FA = require("../middleware/auth/check2FA"); // user uploaded
const { arm, extend, disarm, status } = require("../armEncryption/sessionKeyCache");
const { unwrapDEKWithPassphrase, encryptPrivateKey } = require("../armEncryption/envelopeCrypto");
const legacy = require("../middleware/auth/encryption"); // your legacy (iv:tag:cipher) helper

// helpers
function ttlClamp(min, def, max, reqVal) {
  const n = Number(reqVal || def);
  return Math.max(min, Math.min(n, max));
}


/* helper that prints a compact preview without leaking secrets */
function preview(data, len = 120) {
  try {
    const str = typeof data === "string"
      ? data
      : JSON.stringify(data);
    return str.length > len ? str.slice(0, len) + "…(" + str.length + ")" : str;
  } catch {
    return "[unserialisable]";
  }
}




router.post("/arm", requireAuth, check2FA, async (req, res) => {
  /* ───── 1. Input validation ───── */
  console.log("🟢 /arm hit → body:", req.body);
  const {
    walletId,
    passphrase,
    ttlMinutes,
    migrateLegacy,
    applyToAll,
    passphraseHint,
    forceOverwrite,
  } = req.body || {};
  // allow empty string passphrase but not undefined
  if (!walletId || passphrase === undefined) {
    console.warn("⛔ Missing walletId / passphrase");
    return res.status(400).json({ error: "walletId & passphrase required" });
  }

  const userId = req.user.id;

  /* ───── 2. Fetch user + wallet ───── */
  const [user, wallet] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        requireArmToTrade: true,
        defaultPassphraseHash: true,
        passphraseHint: true,
      },
    }),
    prisma.wallet.findFirst({
      where: { id: walletId, userId },
      select: {
        id: true,
        label: true,
        encrypted: true,
        isProtected: true,
        passphraseHash: true,
      },
    }),
  ]);

  if (!wallet) {
    console.warn("⛔ Wallet not found");
    return res.status(404).json({ error: "Wallet not found" });
  }

  // If user requires arm but wallet isn't protected, refuse until migration
  if (user.requireArmToTrade && !wallet.isProtected) {
    return res.status(400).json({ error: "Wallet must be migrated first" });
  }

  // prepare AAD for encryption/decryption
  const aad = `user:${userId}:wallet:${walletId}`;

  let blob = wallet.encrypted;
  let migrating = false;

  // Determine if this wallet is legacy (string) or unprotected
  const isLegacyString = typeof blob === "string" && blob.includes(":");
  const needsMigration = !wallet.isProtected || isLegacyString;

  // ───── 3. Migration path ─────
  if (needsMigration) {
    // When encrypted data is a legacy string we require migrateLegacy flag
    if (isLegacyString && !migrateLegacy) {
      return res.status(400).json({ error: "Legacy format: set migrateLegacy=true to upgrade" });
    }
    migrating = true;
    try {
      // Decrypt the existing private key
      let pkBuf;
      if (isLegacyString) {
        console.log("🔑 Decrypting legacy blob…");
        pkBuf = legacy.decrypt(blob, { aad });
      } else {
        // For safety we do not support decrypting an unprotected envelope here.
        // In practice this branch is hit when `isProtected` is false but the
        // encrypted column is JSON; these wallets have not been arm‑encrypted
        // yet. They should be considered legacy and thus should have been
        // stored as a colon‑delimited string. If encountered, return error.
        throw new Error("Unsupported unprotected wallet format");
      }

      // Re‑encrypt under the supplied pass‑phrase
      console.log("🔒 Re‑encrypting to envelope-v1…");
      const wrapped = await encryptPrivateKey(pkBuf, {
        passphrase,
        aad,
      });
      pkBuf.fill(0);

      // Compute Argon2 hash of the pass‑phrase
      const passHash = await argon2.hash(passphrase);

      if (applyToAll) {
        // Apply this pass‑phrase to all current and future wallets
        await prisma.$transaction(async (tx) => {
          // 1. Update user default hash + hint
          await tx.user.update({
            where: { id: userId },
            data: {
              defaultPassphraseHash: passHash,
              passphraseHint: passphraseHint || null,
            },
          });

          // 2. Find all wallets that need migration: legacy or not protected
          const toUpgrade = await tx.wallet.findMany({
            where: {
              userId,
              isProtected: false,
            },
            select: { id: true, encrypted: true, isProtected: true },
          });

          for (const w of toUpgrade) {
            // skip current wallet as it will be updated separately
            if (w.id === walletId) continue;
            const upgradeAad = `user:${userId}:wallet:${w.id}`;
            let pk;
            const enc = w.encrypted;
            const isStr = typeof enc === "string" && enc.includes(":");
            if (isStr) {
              pk = legacy.decrypt(enc, { aad: upgradeAad });
            } else {
              // already protected with null passphraseHash: skip re‑encrypt
              continue;
            }
            const newWrap = await encryptPrivateKey(pk, {
              passphrase,
              aad: upgradeAad,
            });
            pk.fill(0);
            await tx.wallet.update({
              where: { id: w.id },
              data: {
                encrypted: newWrap,
                isProtected: true,
                passphraseHash: null,
                passphraseHint: null,
              },
            });
          }

          // 3. Update the current wallet to use global (passphraseHash = null)
          await tx.wallet.update({
            where: { id: walletId },
            data: {
              encrypted: wrapped,
              isProtected: true,
              passphraseHash: null,
              passphraseHint: null,
            },
          });
        });
        // After the transaction commit, fetch the updated envelope
        blob = wrapped;
      } else {
        // Per‑wallet pass‑phrase: set hash on this wallet only
        await prisma.wallet.update({
          where: { id: walletId },
          data: {
            encrypted: wrapped,
            isProtected: true,
            passphraseHash: passHash,
            passphraseHint: passphraseHint || null,
          },
        });
        blob = wrapped;
      }
      console.log("✅ Migration complete");
    } catch (err) {
      console.error("❌ Migration failed:", err);
      return res.status(500).json({ error: "Wallet migration failed" });
    }
  }

  /* ───── 4. Envelope format check ───── */
  if (!blob || blob.v !== 1) {
    console.warn("⛔ Unsupported format → blob:", preview(blob));
    return res.status(400).json({ error: "Unsupported wallet format; upgrade required" });
  }

  // ───── 5. Verify pass‑phrase for protected wallets ─────
  const firstTime = !wallet.passphraseHash && !user.defaultPassphraseHash;

  if (!migrating && !firstTime) {
    // Only enforce pass‑phrase matching when wallet is already protected
    let validPass = false;
    if (wallet.passphraseHash) {
      try {
        validPass = await argon2.verify(wallet.passphraseHash, passphrase);
      } catch {
        validPass = false;
      }
    }
    // fallback to user default pass‑phrase
    if (!validPass && user.defaultPassphraseHash) {
      try {
        validPass = await argon2.verify(user.defaultPassphraseHash, passphrase);
      } catch {
        validPass = false;
      }
    }
    if (!validPass) {
      return res.status(401).json({ error: "Invalid passphrase" });
    }
  }
  // ✨ First-time adoption: accept the pass-phrase and store its hash
  if (firstTime) {
      const newHash = await argon2.hash(passphrase);
      await prisma.wallet.update({
        where: { id: wallet.id },
        data : { passphraseHash: newHash },
      });
  }

  /* ───── 6. Unwrap DEK using provided pass‑phrase ───── */
  let DEK;
  try {
    DEK = await unwrapDEKWithPassphrase(blob, passphrase, aad);
  } catch (err) {
    console.error("❌ Passphrase unwrap failed:", err.message);
    return res.status(401).json({ error: "Invalid passphrase" });
  }

  /* ───── 7. Cache session and respond ───── */
  const ttlMin = ttlClamp(30, 240, 720, ttlMinutes);
  arm(userId, walletId, DEK, ttlMin * 60_000);
  console.log(`🛡️ ARMED wallet ${walletId} for ${ttlMin} min`);

  return res.json({
    ok: true,
    walletId,
    label: wallet.label,
    armedForMinutes: ttlMin,
    migrated: migrating,
  });
});





router.post("/extend", requireAuth, check2FA, async (req, res) => {
  const { walletId, ttlMinutes } = req.body || {};
  if (!walletId) return res.status(400).json({ error: "walletId required" });
  const ttlMin = ttlClamp(30, 120, 720, ttlMinutes);
  const ok = extend(req.user.id, walletId, ttlMin * 60_000);
  if (!ok) return res.status(400).json({ error: "Not armed" });
  return res.json({ ok: true, walletId, extendedToMinutes: ttlMin });
});






router.post("/disarm", requireAuth, check2FA, async (req, res) => {
  const { walletId } = req.body || {};
  if (!walletId) return res.status(400).json({ error: "walletId required" });
  disarm(req.user.id, walletId);
  return res.json({ ok: true, walletId, disarmed: true });
});






router.get("/status/:walletId", requireAuth, async (req, res) => {
  const { walletId } = req.params;
  const s = status(req.user.id, walletId);
  return res.json({ walletId, ...s });
});




/* ========================================================================
 *  USER-LEVEL SECURITY TOGGLE
 *  POST /api/user/security/require-arm  (same router, just mount path)
 * ====================================================================== */
router.post(
  "/require-arm",
  requireAuth,
  [
    body("requireArmToTrade").isBoolean(),
    body("armDefaultMinutes").optional().isInt({ min: 30, max: 720 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ error: "Invalid params", details: errors.array() });

    const { requireArmToTrade, armDefaultMinutes } = req.body;

    try {
      await prisma.user.update({
        where: { id: req.user.id },
        data : {
          requireArmToTrade,
          ...(armDefaultMinutes ? { armDefaultMinutes } : {}),
        },
      });
      return res.json({
        ok: true,
        requireArmToTrade,
        armDefaultMinutes: armDefaultMinutes ?? undefined,
      });
    } catch (e) {
      console.error("❌ require-arm toggle failed:", e);
      return res.status(500).json({ error: "Could not update setting" });
    }
  }
);

module.exports = router;











// // backend/api/armSession.js
// const express = require('express');
// const { body, validationResult } = require('express-validator');
// const sessionMgr = require('../armEcncryption/armSessionManager');
// const { unwrapDEK } = require('../armEncryption/armEncryption');

// // Replace this with your real 2FA verification
// const verify2FA = async (userId, code) => true;

// const router = express.Router();
// const TTL_PRESETS = { '2h': 2 * 60 * 60 * 1000, '4h': 4 * 60 * 60 * 1000, '8h': 8 * 60 * 60 * 1000 };

// router.post('/start', [
//   body('walletId').notEmpty(),
//   body('passphrase').isString().isLength({ min: 1 }),
//   body('ttl').isString(),
//   body('code').isString().optional(),
// ], async (req, res) => {
//   const errors = validationResult(req);
//   if (!errors.isEmpty()) return res.status(400).json({ error: 'Invalid params', details: errors.array() });
//   const { user } = req;
//   const { walletId, passphrase, ttl, ttlMs, code } = req.body;
//   if (!(await verify2FA(user.id, code)))
//     return res.status(401).json({ error: 'Invalid 2FA code' });
//   const wallet = await req.prisma.wallet.findUnique({ where: { id: walletId, userId: user.id } });
//   if (!wallet || !wallet.isProtected)
//     return res.status(400).json({ error: 'Wallet not protected or not found' });
//   const dek = await unwrapDEK(wallet, passphrase);
//   const ttlFinal = ttl === 'custom'
//     ? Math.min(Math.max(Number(ttlMs), 5 * 60 * 1000), 24 * 60 * 60 * 1000)
//     : (TTL_PRESETS[ttl] || TTL_PRESETS['4h']);
//   sessionMgr.arm(user.id, walletId, dek, ttlFinal);
//   res.json({
//     walletId,
//     label: wallet.label,
//     expiresAt: Date.now() + ttlFinal,
//   });
// });

// router.post('/extend', [
//   body('walletId').notEmpty(),
//   body('ttl').isString(),
//   body('code').isString().optional(),
// ], async (req, res) => {
//   const { user } = req;
//   const { walletId, ttl, code } = req.body;
//   if (!(await verify2FA(user.id, code)))
//     return res.status(401).json({ error: 'Invalid 2FA code' });
//   const extraMs = TTL_PRESETS[ttl] || TTL_PRESETS['2h'];
//   const ok = sessionMgr.extend(user.id, walletId, extraMs);
//   if (!ok) return res.status(400).json({ error: 'No active session to extend' });
//   res.json({ expiresAt: Date.now() + extraMs });
// });

// router.post('/disarm', [
//   body('walletId').notEmpty(),
//   body('code').isString().optional(),
// ], async (req, res) => {
//   const { user } = req;
//   const { walletId, code } = req.body;
//   if (!(await verify2FA(user.id, code)))
//     return res.status(401).json({ error: 'Invalid 2FA code' });
//   sessionMgr.disarm(user.id, walletId);
//   res.json({ ok: true });
// });

// // GET /arm-session/status/:walletId
// // Returns whether the session is armed and milliseconds left.
// router.get('/status/:walletId', requireAuth, async (req, res) => {
//   const { walletId } = req.params;
//   if (!walletId) return res.status(400).json({ error: 'walletId required' });
//   const { armed, msLeft } = sessionMgr.status(req.user.id, walletId);
//   return res.json({ walletId, armed, msLeft });
// });


// module.exports = router;
