// backend/api/armSessions.js
// Routes: arm / extend / disarm / status. 2FA-gated. Rate-limit recommended.
// Assumes prisma schema with `User(requireArmToTrade:boolean)` and `Wallet` table
// where wallet.encrypted (JSON) stores the envelope blob.

// Legacy support: if wallet.encrypted is *legacy* (iv:tag:cipher hex string) or a
// legacy `privateKey` exists, the arm endpoint will automatically migrate
// the secret under the hood on first arm. Clients no longer need to send
// `migrateLegacy=true`; the server auto-detects and upgrades in place.

const express = require("express");
const router = express.Router();
const { body, validationResult } = require("express-validator");
const argon2 = require("argon2"); // for pass-phrase hashing when migrating
const bs58 = require("bs58");

const prisma = require("../prisma/prisma");
const requireAuth = require("../middleware/requireAuth");
const check2FA = require("../middleware/auth/check2FA");

// ⚠️ Paths as in your repo layout
const { arm, extend, disarm, status } = require("../armEncryption/armGuardian");
const {
  unwrapDEKWithPassphrase,
  encryptPrivateKey,
  decryptPrivateKeyWithDEK,
} = require("../armEncryption/envelopeCrypto");
const legacy = require("../middleware/auth/encryption"); // your legacy (iv:tag:cipher) helper
const { encrypt } = require("../middleware/auth/encryption");
const autoReturn = require("../armEncryption/returnBalanceAfterSession/autoReturnScheduler");
const { decryptEnvelope, encryptEnvelope, buildEnvelopeJson, } = require("../armEncryption/envelopeCryptoUnprotected");

// ── Pagination helper (idempotent) ───────────────────────────────────────────
function __getPage(req, defaults = { take: 100, skip: 0, cap: 500 }) {
  const cap = Number(defaults.cap || 500);
  let take = parseInt(req.query?.take ?? defaults.take, 10);
  let skip = parseInt(req.query?.skip ?? defaults.skip, 10);
  if (!Number.isFinite(take) || take <= 0) take = defaults.take;
  if (!Number.isFinite(skip) || skip < 0) skip = defaults.skip;
  take = Math.min(Math.max(1, take), cap);
  skip = Math.max(0, skip);
  return { take, skip };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers

// Open-ended TTL normalizer: allow any integer minutes ≥ 1, with a default.
// No upper bound.
function ttlNormalize(reqVal, def = 240) {
  const n = Math.floor(Number(reqVal ?? def));
  if (!Number.isFinite(n) || n < 1) return def;
  return n;
}

/* helper that prints a compact preview without leaking secrets */
function preview(data, len = 120) {
  try {
    const str = typeof data === "string" ? data : JSON.stringify(data);
    return str.length > len ? str.slice(0, len) + "…(" + str.length + ")" : str;
  } catch {
    return "[unserialisable]";
  }
}

router.post("/arm", requireAuth, check2FA, async (req, res) => {
  /* ───── 1. Input validation ───── */
  console.log("🟢 /arm hit", { walletId: req.body && req.body.walletId });
  const {
    walletId,
    passphrase,
    ttlMinutes,
    // migrateLegacy is accepted for backwards compatibility but ignored.
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
        // ⬅️ add stable userId for HKDF + AAD
        userId: true,
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
        privateKey: true, // include legacy key for automatic migration
      },
    }),
  ]);

  if (!wallet) {
    console.warn("⛔ Wallet not found");
    return res.status(404).json({ error: "Wallet not found" });
  }

  // ⬅️ AAD must use stable user.userId (not req.user.id)
  const aad = `user:${user.userId}:wallet:${walletId}`;

  let blob = wallet.encrypted;
  let migrating = false;

  // Determine if this wallet uses a legacy encrypted key or holds an
  // unencrypted base58 secret.
  const pkVal = wallet.privateKey;
  const isLegacyString = typeof blob === "string" && blob.includes(":");
  const isLegacyPK =
    !!pkVal &&
    !Buffer.isBuffer(pkVal) &&
    ((typeof pkVal === "object" && pkVal.ct) || (typeof pkVal === "string" && pkVal.includes(":")));

  let pkStringForDetect;
  if (pkVal) {
    if (Buffer.isBuffer(pkVal)) pkStringForDetect = pkVal.toString();
    else if (typeof pkVal === "string") pkStringForDetect = pkVal;
    else pkStringForDetect = null;
  }
  const isBase58PK = !!pkStringForDetect && !pkStringForDetect.includes(":");

  // ⬅️ NEW: detect unprotected HKDF envelope stored in encrypted column
  const isEnvelope =
    !!blob &&
    typeof blob === "object" &&
    (
      (blob.data && blob.data.wrapped && blob.data.kekWrappedDek) ||
      (blob.wrapped && blob.kekWrappedDek)
    );

  const needsMigration = !wallet.isProtected || isLegacyString || isLegacyPK || isBase58PK || isEnvelope;

  // Emit debug information without leaking key material.
  console.log("🔍 arm debug", {
    walletId,
    isLegacyString,
    isLegacyPK,
    isBase58PK,
    isEnvelope,
    isProtected: wallet.isProtected,
    pkType: Buffer.isBuffer(pkVal) ? "Buffer" : typeof pkVal,
  });

  // ───── 3. Migration path ─────
  if (needsMigration) {
    migrating = true;
    try {
      // Decrypt or decode the existing secret key based on its format.
      let pkBuf;
      if (isLegacyPK) {
        console.log("🔑 Decrypting legacy privateKey…");
        pkBuf = legacy.decrypt(pkVal, { aad });
      } else if (isLegacyString) {
        console.log("🔑 Decrypting legacy blob…");
        pkBuf = legacy.decrypt(blob, { aad });
      } else if (isEnvelope) {
        console.log("🔑 Unwrapping HKDF envelope…");
        const core = blob.data || blob;
        pkBuf = decryptEnvelope({
          envelope: core,
          userId: user.userId,                 // HKDF salt
          serverSecret: process.env.ENCRYPTION_SECRET,
        });
      } else if (!wallet.isProtected || isBase58PK) {
        const raw = (() => {
          if (!pkVal) return null;
          if (Buffer.isBuffer(pkVal)) return pkVal.toString();
          if (typeof pkVal === "string") return pkVal;
          return null;
        })();
        console.log("🔑 Decoding base58 privateKey…", Buffer.isBuffer(pkVal) ? "Buffer" : typeof pkVal);
        if (!raw || typeof raw !== "string") {
          throw new Error("Unsupported unprotected wallet format");
        }
        try {
          const decoded = bs58.decode(raw.trim());
          if (decoded.length !== 64) throw new Error();
          pkBuf = Buffer.from(decoded);
        } catch {
          throw new Error("Unsupported unprotected wallet format");
        }
      } else {
        throw new Error("Unsupported unprotected wallet format");
      }

      // Re-encrypt under the supplied pass-phrase
      console.log("🔒 Re-encrypting to envelope-v1…");
      const wrapped = await encryptPrivateKey(pkBuf, {
        passphrase,
        aad,
      });
      try {
        pkBuf.fill(0);
      } catch {}

      // Compute Argon2 hash of the pass-phrase
      const passHash = await argon2.hash(passphrase);

      if (applyToAll) {
        await prisma.$transaction(async (tx) => {
          // 1. user default hash + hint
          await tx.user.update({
            where: { id: userId },
            data: {
              defaultPassphraseHash: passHash,
              passphraseHint: passphraseHint || null,
            },
          });

          // 2. migrate all wallets that still need it
          const toUpgrade = await tx.wallet.findMany({
            where: {
              userId,
              OR: [{ privateKey: { not: null } }, { isProtected: false }],
            },
            select: { id: true, encrypted: true, isProtected: true, privateKey: true },
          });

          for (const w of toUpgrade) {
            if (w.id === walletId) continue;
            // ⬅️ use stable user.userId for AAD
            const upgradeAad = `user:${user.userId}:wallet:${w.id}`;
            let pk;
            const enc = w.encrypted;
            const strLegacy = typeof enc === "string" && enc.includes(":");

            // ⬅️ NEW: detect HKDF envelope during bulk upgrade
            const encIsEnvelope =
              !!enc &&
              typeof enc === "object" &&
              (
                (enc.data && enc.data.wrapped && enc.data.kekWrappedDek) ||
                (enc.wrapped && enc.kekWrappedDek)
              );

            if (encIsEnvelope) {
              const core2 = enc.data || enc;
              pk = decryptEnvelope({
                envelope: core2,
                userId: user.userId,
                serverSecret: process.env.ENCRYPTION_SECRET,
              });
            } else if (w.privateKey) {
              pk = legacy.decrypt(w.privateKey, { aad: upgradeAad });
            } else if (strLegacy) {
              pk = legacy.decrypt(enc, { aad: upgradeAad });
            } else {
              continue;
            }

            const newWrap = await encryptPrivateKey(pk, {
              passphrase,
              aad: upgradeAad,
            });
            try {
              pk.fill(0);
            } catch {}
            await tx.wallet.update({
              where: { id: w.id },
              data: {
                encrypted: newWrap,
                isProtected: true,
                passphraseHash: null,
                passphraseHint: null,
                privateKey: null,
              },
            });
          }

          // 3. update current wallet to global (passphraseHash = null)
          await tx.wallet.update({
            where: { id: walletId },
            data: {
              encrypted: wrapped,
              isProtected: true,
              passphraseHash: null,
              passphraseHint: null,
              privateKey: null,
            },
          });
        });

        blob = wrapped;
        wallet.isProtected = true;
        wallet.passphraseHash = null;
        wallet.privateKey = null;
      } else {
        // per-wallet pass-phrase
        await prisma.wallet.update({
          where: { id: walletId },
          data: {
            encrypted: wrapped,
            isProtected: true,
            passphraseHash: passHash,
            passphraseHint: passphraseHint || null,
            privateKey: null,
          },
        });
        blob = wrapped;
        wallet.isProtected = true;
        wallet.passphraseHash = passHash;
        wallet.privateKey = null;
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

  // ───── 5. Verify pass-phrase for protected wallets ─────
  const firstTime = !wallet.passphraseHash && !user.defaultPassphraseHash;

  if (!migrating && !firstTime) {
    let validPass = false;
    if (wallet.passphraseHash) {
      try {
        validPass = await argon2.verify(wallet.passphraseHash, passphrase);
      } catch {
        validPass = false;
      }
    }
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
      data: { passphraseHash: newHash },
    });
  }

  /* ───── 6. Unwrap DEK using provided pass-phrase ───── */
  let DEK;
  try {
    DEK = await unwrapDEKWithPassphrase(blob, passphrase, aad);
  } catch (err) {
    console.error("❌ Passphrase unwrap failed:", err.message);
    return res.status(401).json({ error: "Invalid passphrase" });
  }

  /* ───── 7. Cache session and respond ───── */
  const ttlMin = ttlNormalize(ttlMinutes, 240);
  arm(userId, walletId, DEK, ttlMin * 60_000);
  console.log(`🛡️ ARMED wallet ${walletId} for ${ttlMin} min`);

  try {
    const ar = req.body?.autoReturn || {};
    const enabledOverride =
      typeof req.body?.autoReturnEnabled === "boolean"
        ? !!req.body.autoReturnEnabled
        : typeof ar.enabled === "boolean"
        ? !!ar.enabled
        : undefined;
    const destOverride = req.body?.destOverride || ar.destPubkey || undefined;
    const expiresAtMs = Date.now() + ttlMin * 60_000;

    console.log(
      `[AutoReturn] schedule on arm user:${userId} wallet:${walletId} expiresAt:${new Date(
        expiresAtMs
      ).toISOString()} enabledOverride:${enabledOverride} destOverride:${destOverride ? "yes" : "no"}`
    );

    autoReturn.schedule(userId, walletId, expiresAtMs, {
      enabledOverride,
      destOverride,
    });
  } catch (e) {
    console.warn("⚠️ AutoReturn schedule failed:", e.message || e);
  }

  return res.json({
    ok: true,
    walletId,
    label: wallet.label,
    armedForMinutes: ttlMin,
    migrated: migrating,
  });
});


/*
 * Route: POST /setup-protection
 *
 * This endpoint sets a passphrase on an unprotected or legacy wallet without
 * immediately arming it. It performs the same migration logic as the
 * /arm route but does not require 2FA and does not unlock the wallet.
 */
router.post("/setup-protection", requireAuth, async (req, res) => {
  console.log("🔐 /setup-protection called", { walletId: req.body && req.body.walletId });
  const { walletId, passphrase, applyToAll, passphraseHint, forceOverwrite } = req.body || {};

  if (!walletId || passphrase === undefined) {
    console.warn("⛔ Missing walletId / passphrase");
    return res.status(400).json({ error: "walletId & passphrase required" });
  }

  const dbUserId = req.user.id;

  const [user, wallet] = await Promise.all([
    prisma.user.findUnique({
      where: { id: dbUserId },
      // ⬅️ need user.userId for HKDF salt + AAD (stable across auth sessions)
      select: { id: true, userId: true, defaultPassphraseHash: true, passphraseHint: true },
    }),
    prisma.wallet.findFirst({
      where: { id: walletId, userId: dbUserId },
      select: {
        id: true,
        label: true,
        encrypted: true,
        isProtected: true,
        passphraseHash: true,
        passphraseHint: true,
        privateKey: true,
      },
    }),
  ]);

  if (!user || !wallet) {
    console.warn("⛔ Wallet not found");
    return res.status(404).json({ error: "Wallet not found" });
  }

  // IMPORTANT: AAD must use the stable user.userId (not req.user.id)
  const aad = `user:${user.userId}:wallet:${walletId}`;
  let blob = wallet.encrypted;
  let migrating = false;

  const isLegacyString = typeof blob === "string" && blob.includes(":");
  const pkVal = wallet.privateKey;
  const isLegacyPK =
    !!pkVal &&
    !Buffer.isBuffer(pkVal) &&
    ((typeof pkVal === "object" && pkVal.ct) || (typeof pkVal === "string" && pkVal.includes(":")));

  let pkStringForDetect = null;
  if (pkVal) {
    if (Buffer.isBuffer(pkVal)) pkStringForDetect = pkVal.toString();
    else if (typeof pkVal === "string") pkStringForDetect = pkVal;
  }
  const isBase58PK = !!pkStringForDetect && !pkStringForDetect.includes(":");

  // NEW: detect new unarmed HKDF envelope stored in encrypted column
  const isEnvelope =
    !!blob &&
    typeof blob === "object" &&
    (
      (blob.data && blob.data.wrapped && blob.data.kekWrappedDek) || // { data: { wrapped, kekWrappedDek } }
      (blob.wrapped && blob.kekWrappedDek) // { wrapped, kekWrappedDek }
    );

  const needsMigration =
    !wallet.isProtected || isLegacyString || isLegacyPK || isBase58PK || isEnvelope || forceOverwrite;

  console.log("🔍 setup-protection debug", {
    walletId,
    isLegacyString,
    isLegacyPK,
    isBase58PK,
    isEnvelope,
    isProtected: wallet.isProtected,
    forceOverwrite,
    pkType: Buffer.isBuffer(pkVal) ? "Buffer" : typeof pkVal,
  });

  if (!needsMigration) {
    return res.status(400).json({ error: "Wallet already protected" });
  }

  migrating = true;
  try {
    let pkBuf;

    if (isLegacyPK) {
      pkBuf = legacy.decrypt(pkVal, { aad });
    } else if (isLegacyString) {
      pkBuf = legacy.decrypt(blob, { aad });
    } else if (isEnvelope) {
      // unwrap using server-secret HKDF + user.userId
      const core = blob.data || blob;
      pkBuf = decryptEnvelope({
        envelope: core,
        userId: user.userId,
        serverSecret: process.env.ENCRYPTION_SECRET,
      });
    } else if (!wallet.isProtected || isBase58PK) {
      const raw =
        Buffer.isBuffer(pkVal) ? pkVal.toString() :
        (typeof pkVal === "string" ? pkVal : null);
      if (!raw || typeof raw !== "string") {
        throw new Error("Unsupported unprotected wallet format");
      }
      try {
        const decoded = bs58.decode(raw.trim());
        if (decoded.length !== 64) throw new Error();
        pkBuf = Buffer.from(decoded);
      } catch {
        throw new Error("Unsupported unprotected wallet format");
      }
    } else {
      throw new Error("Cannot overwrite passphrase without existing key material");
    }

    const wrapped = await encryptPrivateKey(pkBuf, { passphrase, aad });
    try { pkBuf.fill(0); } catch {}

    const passHash = await argon2.hash(passphrase);

    if (applyToAll) {
      await prisma.$transaction(async (tx) => {
        // set defaults on user
        await tx.user.update({
          where: { id: dbUserId },
          data: {
            defaultPassphraseHash: passHash,
            passphraseHint: passphraseHint || null,
          },
        });

        const toUpgrade = await tx.wallet.findMany({
          where: {
            userId: dbUserId,
            OR: [{ privateKey: { not: null } }, { isProtected: false }],
          },
          select: { id: true, encrypted: true, isProtected: true, privateKey: true },
        });

        for (const w of toUpgrade) {
          if (w.id === walletId) continue;

          const upgradeAad = `user:${user.userId}:wallet:${w.id}`;
          const enc = w.encrypted;

          const encIsEnvelope =
            !!enc &&
            typeof enc === "object" &&
            (
              (enc.data && enc.data.wrapped && enc.data.kekWrappedDek) ||
              (enc.wrapped && enc.kekWrappedDek)
            );

          let pk = null;

          if (encIsEnvelope) {
            const core2 = enc.data || enc;
            try {
              pk = decryptEnvelope({
                envelope: core2,
                userId: user.userId,
                serverSecret: process.env.ENCRYPTION_SECRET,
              });
            } catch { pk = null; }
          } else if (typeof enc === "string" && enc.includes(":")) {
            try { pk = legacy.decrypt(enc, { aad: upgradeAad }); } catch { pk = null; }
          } else if (w.privateKey) {
            const s = Buffer.isBuffer(w.privateKey) ? w.privateKey.toString() :
                      (typeof w.privateKey === "string" ? w.privateKey : null);
            if (s && !s.includes(":")) {
              try {
                const d = bs58.decode(s.trim());
                if (d.length === 64) pk = Buffer.from(d);
              } catch { /* skip */ }
            }
          }

          if (!pk) continue;

          const newWrap = await encryptPrivateKey(pk, { passphrase, aad: upgradeAad });
          try { pk.fill(0); } catch {}

          await tx.wallet.update({
            where: { id: w.id },
            data: {
              encrypted: newWrap,
              isProtected: true,
              passphraseHash: null,
              passphraseHint: null,
              privateKey: null,
            },
          });
        }

        await tx.wallet.update({
          where: { id: walletId },
          data: {
            encrypted: wrapped,
            isProtected: true,
            passphraseHash: null,
            passphraseHint: null,
            privateKey: null,
          },
        });
      });

      blob = wrapped;
    } else {
      await prisma.wallet.update({
        where: { id: walletId },
        data: {
          encrypted: wrapped,
          isProtected: true,
          passphraseHash: passHash,
          passphraseHint: passphraseHint || null,
          privateKey: null,
        },
      });
      blob = wrapped;
    }

    console.log("✅ Wallet protection setup complete");
  } catch (err) {
    console.error("❌ Setup-protection failed:", err.message);
    return res.status(500).json({ error: err.message || "Wallet protection setup failed" });
  }

  return res.json({ ok: true, walletId, label: wallet.label, migrated: migrating });
});

router.post("/extend", requireAuth, check2FA, async (req, res) => {
  console.log("🔁 /extend called", { walletId: req.body && req.body.walletId });
  const { walletId, ttlMinutes } = req.body || {};
  if (!walletId) {
    console.warn("⛔ /extend missing walletId");
    return res.status(400).json({ error: "walletId required" });
  }
  const ttlMin = ttlNormalize(ttlMinutes, 120);
  const ok = extend(req.user.id, walletId, ttlMin * 60_000);
  if (!ok) {
    console.warn(`⛔ /extend failed → wallet ${walletId} not armed or session expired`);
    return res.status(400).json({ error: "Not armed" });
  }
  console.log(`✅ /extend successful → wallet ${walletId} extended to ${ttlMin} minutes`);

  // Reschedule auto-return to the new expiry
  try {
    const expiresAtMs = Date.now() + ttlMin * 60_000;
    console.log(
      `[AutoReturn] reschedule on extend user:${req.user.id} wallet:${walletId} newExpiresAt:${new Date(
        expiresAtMs
      ).toISOString()}`
    );
    autoReturn.reschedule(req.user.id, walletId, expiresAtMs);
  } catch (e) {
    console.warn("⚠️ AutoReturn reschedule failed:", e.message || e);
  }

  return res.json({ ok: true, walletId, extendedToMinutes: ttlMin });
});

router.post("/disarm", requireAuth, check2FA, async (req, res) => {
  console.log("🔻 /disarm called", { walletId: req.body && req.body.walletId });
  const { walletId } = req.body || {};
  if (!walletId) {
    console.warn("⛔ /disarm missing walletId");
    return res.status(400).json({ error: "walletId required" });
  }
  try {
    disarm(req.user.id, walletId);
    console.log(`✅ Wallet ${walletId} disarmed by user ${req.user.id}`);
    try {
      console.log(`[AutoReturn] cancel on disarm user:${req.user.id} wallet:${walletId}`);
      autoReturn.cancel(req.user.id, walletId);
    } catch (e) {
      console.warn("⚠️ AutoReturn cancel failed:", e.message || e);
    }
    return res.json({ ok: true, walletId, disarmed: true });
  } catch (e) {
    console.error(`❌ Disarm failed for wallet ${walletId}:`, e.message);
    return res.status(500).json({ error: "Failed to disarm" });
  }
});

router.get("/status/:walletId", requireAuth, async (req, res) => {
  const { walletId } = req.params;
  const includeGuardian =
    String(req.query.guardian || "").toLowerCase() === "1" ||
    String(req.query.guardian || "").toLowerCase() === "true";

  const s = status(req.user.id, walletId);

  // Normalise to milliseconds if your cache exposes seconds under an alt key.
  let msLeft = 0;
  if (s && typeof s.msLeft === "number") {
    msLeft = s.msLeft;
  } else if (s && typeof s.msLeftSec === "number") {
    msLeft = Math.max(0, Math.floor(s.msLeftSec * 1000));
  } else if (s && typeof s.secondsLeft === "number") {
    msLeft = Math.max(0, Math.floor(s.secondsLeft * 1000));
  }

  // One-shot: will be truthy right after a sweep, then auto-clears
  const recent = autoReturn.consumeRecentTrigger(req.user.id, walletId);
  const autoReturnTriggered = !!recent;

  // 🔍 Optional guardian snapshot (counts) – only when explicitly requested
  let guardian = null;
  if (includeGuardian) {
    const wid = Number(walletId);
    try {
      const [limitOpen, dcaActive, tpSlActive, botsRunning] = await Promise.all([
        prisma.limitOrder.count({
          where: { userId: req.user.id, walletId: wid, status: "open" },
        }),
        prisma.dcaOrder.count({
          where: { userId: req.user.id, walletId: wid, status: "active" },
        }),
        prisma.tpSlRule.count({
          where: {
            userId: req.user.id,
            walletId: wid,
            enabled: true,
            status: "active",
          },
        }),
        prisma.strategyRunStatus.count({
          where: {
            userId: req.user.id,
            isPaused: false,
            stoppedAt: null,
            OR: [
              { config: { path: ["walletId"], equals: wid } },          // numeric
              { config: { path: ["walletId"], equals: String(wid) } },  // string
            ],
          },
        }),
      ]);
      guardian = {
        limitOpen,
        dcaActive,
        tpSlActive,
        botsRunning: 0,
        botsRunning,
        hasBlocking: limitOpen + dcaActive + tpSlActive + botsRunning > 0,
      };
    } catch (e) {
      console.warn("⚠️ guardian count failed:", e.message || e);
      guardian = {
        limitOpen: 0,
        dcaActive: 0,
        tpSlActive: 0,
        hasBlocking: false,
        error: true,
      };
    }
  }

  return res.json({
    walletId,
    armed: !!(s && s.armed && msLeft > 0),
    msLeft,
    autoReturnTriggered,
    ...(guardian ? { guardian } : {}),
  });
});

/* ========================================================================
 *  USER-LEVEL SECURITY TOGGLE
 *  POST /api/user/security/require-arm  (same router, just mount path)
 * ====================================================================== */
router.post(
  "/require-arm",
  requireAuth,
  [body("requireArmToTrade").isBoolean(), body("armDefaultMinutes").optional().isInt({ min: 1 })],
  async (req, res) => {
    console.log("⚙️ /require-arm called", {
      requireArmToTrade: req.body && req.body.requireArmToTrade,
      armDefaultMinutes: req.body && req.body.armDefaultMinutes,
    });
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ error: "Invalid params", details: errors.array() });

    const { requireArmToTrade, armDefaultMinutes } = req.body;

    try {
      await prisma.user.update({
        where: { id: req.user.id },
        data: {
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

/**
 * GET /api/auto-return/status
 *
 * Returns the authenticated user’s current auto-return configuration.
 */
router.get("/status", requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        autoReturnEnabledDefault: true,
        autoReturnDestPubkey: true,
      },
    });
    return res.json(user || {});
  } catch (err) {
    console.error("autoReturn GET status error:", err);
    res.status(500).json({ error: "Failed to load auto-return status" });
  }
});

/**
 * POST /api/auto-return/setup
 *
 * Configure auto-return settings for the authenticated user.
 */
router.post("/setup", requireAuth, async (req, res) => {
  const {
    enabled,
    destPubkey,
    graceSeconds,
    sweepTokens,
    solMinKeepLamports,
    feeBufferLamports,
    excludeMints,
    usdcMints,
  } = req.body || {};

  if (destPubkey !== undefined && destPubkey !== null) {
    if (typeof destPubkey !== "string" || destPubkey.trim().length === 0) {
      return res.status(400).json({ error: "Invalid destination pubkey" });
    }
  }
  try {
    const patch = {};
    if (enabled !== undefined) patch.autoReturnEnabledDefault = !!enabled;
    if (destPubkey !== undefined) {
      patch.autoReturnDestPubkey = destPubkey;
      patch.autoReturnDestVerifiedAt = new Date();
    }
    if (graceSeconds !== undefined) patch.autoReturnGraceSeconds = parseInt(graceSeconds);
    if (sweepTokens !== undefined) patch.autoReturnSweepTokens = !!sweepTokens;
    if (solMinKeepLamports !== undefined)
      patch.autoReturnSolMinKeepLamports = BigInt(solMinKeepLamports);
    if (feeBufferLamports !== undefined)
      patch.autoReturnFeeBufferLamports = BigInt(feeBufferLamports);
    if (excludeMints !== undefined)
      patch.autoReturnExcludeMints = Array.isArray(excludeMints) ? excludeMints : [excludeMints];
    if (usdcMints !== undefined)
      patch.autoReturnUsdcMints = Array.isArray(usdcMints) ? usdcMints : [usdcMints];

    await prisma.user.update({ where: { id: req.user.id }, data: patch });
    return res.json({ ok: true });
  } catch (err) {
    console.error("autoReturn POST setup error:", err);
    res.status(500).json({ error: "Failed to update auto-return settings" });
  }
});

// Aliases for legacy FE paths
router.get("/auto-return/settings", requireAuth, async (req, res) => {
  const u = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { autoReturnEnabledDefault: true, autoReturnDestPubkey: true },
  });
  return res.json({
    destPubkey: u?.autoReturnDestPubkey || "",
    defaultEnabled: !!u?.autoReturnEnabledDefault,
  });
});

router.post("/auto-return/settings", requireAuth, async (req, res) => {
  const { destPubkey, defaultEnabled, enabled } = req.body || {};
  const patch = {};
  if (destPubkey !== undefined) patch.autoReturnDestPubkey = destPubkey;
  if (defaultEnabled !== undefined || enabled !== undefined) {
    patch.autoReturnEnabledDefault = !!(defaultEnabled ?? enabled);
  }
  await prisma.user.update({ where: { id: req.user.id }, data: patch });
  res.json({ ok: true });
});



/*
 * Route: POST /remove-protection
 */
router.post("/remove-protection", requireAuth, async (req, res) => {
  // Log invocation without echoing the passphrase or full body
  console.log("🔓 /remove-protection called", { walletId: (req.body && req.body.walletId) });
  const { walletId, passphrase } = req.body || {};
  if (!walletId || passphrase === undefined) {
    console.warn("⛔ Missing walletId or passphrase on remove-protection");
    return res.status(400).json({ error: "walletId & passphrase required" });
  }
  try {
    const userId = req.user.id;
    // Fetch wallet and user
    const [user, wallet] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        // ⬅️ need stable user.userId for AAD and HKDF salt
        select: { defaultPassphraseHash: true, userId: true },
      }),
      prisma.wallet.findFirst({
        where: { id: walletId, userId },
        select: {
          id: true,
          encrypted: true,
          isProtected: true,
          passphraseHash: true,
          privateKey: true,
        },
      }),
    ]);
    if (!wallet) {
      console.warn("⛔ Wallet not found for remove-protection");
      return res.status(404).json({ error: "Wallet not found" });
    }
    if (!wallet.isProtected) {
      console.warn("⚠️ Wallet not protected, nothing to remove");
      return res.status(400).json({ error: "Wallet is not protected" });
    }
    // Verify pass-phrase against per-wallet or global hash
    let validPass = false;
    if (wallet.passphraseHash) {
      try {
        validPass = await argon2.verify(wallet.passphraseHash, passphrase);
      } catch {
        validPass = false;
      }
    }
    if (!validPass && user.defaultPassphraseHash) {
      try {
        validPass = await argon2.verify(user.defaultPassphraseHash, passphrase);
      } catch {
        validPass = false;
      }
    }
    if (!validPass) {
      console.warn("⛔ Invalid passphrase on remove-protection");
      return res.status(401).json({ error: "Invalid passphrase" });
    }
    // Derive secret key from protected envelope
    // ⬅️ AAD must use stable user.userId, not req.user.id
    const aad = `user:${user.userId}:wallet:${walletId}`;
    let DEK;
    try {
      DEK = await unwrapDEKWithPassphrase(wallet.encrypted, passphrase, aad);
    } catch (err) {
      console.error("❌ Failed to unwrap DEK on remove-protection:", err.message);
      return res.status(401).json({ error: "Invalid passphrase" });
    }
    let pkBuf;
    try {
      pkBuf = decryptPrivateKeyWithDEK(wallet.encrypted, DEK, aad);
    } catch (err) {
      console.error("❌ Failed to decrypt private key on remove-protection:", err.message);
      return res.status(500).json({ error: "Failed to decrypt wallet key" });
    }

    // ⬅️ NEW: store as modern UNPROTECTED HKDF envelope (encrypted JSON), not legacy privateKey
    const core = encryptEnvelope({
      walletKey: pkBuf,
      userId: user.userId,                 // HKDF salt
      serverSecret: process.env.ENCRYPTION_SECRET,
    });
    const envelope = buildEnvelopeJson(core);

    // Zeroize sensitive buffers
    try { pkBuf.fill(0); } catch {}
    try { DEK.fill(0); } catch {}

    // Remove any active session
    try {
      disarm(userId, walletId);
    } catch (e) {
      console.warn("⚠️ Error disarming during remove-protection:", e.message);
    }

    // Persist changes: keep encrypted envelope, clear passphrase & legacy fields
    await prisma.wallet.update({
      where: { id: walletId },
      data: {
        encrypted: envelope,   // ← new unarmed HKDF envelope
        isProtected: false,
        passphraseHash: null,
        passphraseHint: null,
        privateKey: null,      // ← no legacy storage
      },
    });
    console.log(`✅ Removed protection for wallet ${walletId}`);
    return res.json({ ok: true, walletId, removed: true });
  } catch (err) {
    console.error("🔥 remove-protection error:", err.stack || err);
    return res.status(500).json({ error: "Failed to remove protection" });
  }
});



// GET /api/arm-encryption/overview?guardian=1
router.get("/overview", requireAuth, async (req, res) => {
  const includeGuardian =
    String(req.query.guardian || "").toLowerCase() === "1" ||
    String(req.query.guardian || "").toLowerCase() === "true";

  // Get all wallets for the user (IDs + labels)
  const wallets = await prisma.wallet.findMany({
    where: { userId: req.user.id },
    select: { id: true, label: true },
  });

  const items = [];
  for (const w of wallets) {
    const s = status(req.user.id, String(w.id));

    // Normalize msLeft exactly like /status/:walletId
    let msLeft = 0;
    if (s && typeof s.msLeft === "number") {
      msLeft = s.msLeft;
    } else if (s && typeof s.msLeftSec === "number") {
      msLeft = Math.max(0, Math.floor(s.msLeftSec * 1000));
    } else if (s && typeof s.secondsLeft === "number") {
      msLeft = Math.max(0, Math.floor(s.secondsLeft * 1000));
    }

    let guardian = null;
    if (includeGuardian) {
      try {
        const [limitOpen, dcaActive, tpSlActive] = await Promise.all([
          prisma.limitOrder.count({
            where: { userId: req.user.id, walletId: w.id, status: "open" },
          }),
          prisma.dcaOrder.count({
            where: { userId: req.user.id, walletId: w.id, status: "active" },
          }),
          prisma.tpSlRule.count({
            where: { userId: req.user.id, walletId: w.id, enabled: true, status: "active" },
          }),
        ]);
        guardian = { limitOpen, dcaActive, tpSlActive };
      } catch (e) {
        guardian = { limitOpen: 0, dcaActive: 0, tpSlActive: 0, error: true };
      }
    }

    items.push({
      walletId: w.id,
      label: w.label,
      armed: !!(s && s.armed && msLeft > 0),
      msLeft,
      ...(guardian ? { guardian } : {}),
    });
  }

  return res.json({ wallets: items });
});




module.exports = router;
