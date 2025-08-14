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

const prisma = require("../prisma/prisma");
const requireAuth = require("../middleware/requireAuth");
const check2FA = require("../middleware/auth/check2FA"); // user uploaded
const { arm, extend, disarm, status } = require("../armEncryption/sessionKeyCache");
const { unwrapDEKWithPassphrase, encryptPrivateKey, decryptPrivateKeyWithDEK } = require("../armEncryption/envelopeCrypto");
const legacy = require("../middleware/auth/encryption"); // your legacy (iv:tag:cipher) helper
const bs58 = require("bs58");
const { encrypt } = require("../middleware/auth/encryption");

// ── Pagination helper (idempotent) ───────────────────────────────────────────
function __getPage(req, defaults = { take: 100, skip: 0, cap: 500 }) {
  const cap  = Number(defaults.cap || 500);
  let take   = parseInt(req.query?.take ?? defaults.take, 10);
  let skip   = parseInt(req.query?.skip ?? defaults.skip, 10);
  if (!Number.isFinite(take) || take <= 0) take = defaults.take;
  if (!Number.isFinite(skip) || skip <  0) skip = defaults.skip;
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
  // Log invocation without echoing sensitive body contents
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
  // NOTE: Historically we blocked arming unprotected wallets outright when
  // requireArmToTrade was enabled.  With automatic migration support we
  // remove this guard so first-time arm can both migrate and arm in one
  // step.  If a wallet truly cannot be migrated (e.g. missing both
  // privateKey and legacy ciphertext) later logic will throw.

  // prepare AAD for encryption/decryption
  const aad = `user:${userId}:wallet:${walletId}`;

  let blob = wallet.encrypted;
  let migrating = false;

  // Determine if this wallet uses a legacy encrypted key or holds an
  // unencrypted base58 secret.  Legacy private keys are either objects with
  // a `ct` property or strings containing a colon (iv:tag:cipher).  A plain
  // base58 string is considered an unprotected secret and needs migration
  // as well.  We compute separate flags to handle each case.  See
  // setup-protection for similar logic.
  const pkVal = wallet.privateKey;
  const isLegacyString = typeof blob === "string" && blob.includes(":");
  // Determine whether the privateKey holds a legacy encrypted blob.  Buffers
  // returned by bs58.encode are considered base58, not legacy.  Only objects
  // with a ct property or colon-delimited strings are treated as legacy.
  const isLegacyPK = !!pkVal && !Buffer.isBuffer(pkVal) && (
    (typeof pkVal === "object" && pkVal.ct) ||
    (typeof pkVal === "string" && pkVal.includes(":"))
  );
  // Determine whether the privateKey represents a base58-encoded secret.  We
  // accept both strings and Buffers here; for Buffers we convert to string.
  let pkStringForDetect;
  if (pkVal) {
    if (Buffer.isBuffer(pkVal)) pkStringForDetect = pkVal.toString();
    else if (typeof pkVal === "string") pkStringForDetect = pkVal;
    else pkStringForDetect = null;
  }
  const isBase58PK = !!pkStringForDetect && !pkStringForDetect.includes(":");
  const needsMigration = !wallet.isProtected || isLegacyString || isLegacyPK || isBase58PK;

  // Emit debug information without leaking key material.  Only high level
  // flags are logged here; pkPreview has been removed to avoid exposing
  // portions of private keys.
  console.log("🔍 arm debug", {
    walletId,
    isLegacyString,
    isLegacyPK,
    isBase58PK,
    isProtected: wallet.isProtected,
    pkType: Buffer.isBuffer(pkVal) ? 'Buffer' : typeof pkVal,
  });

  // ───── 3. Migration path ─────
  if (needsMigration) {
    migrating = true;
    try {
      // Decrypt or decode the existing secret key based on its format.  Base58
      // strings are decoded directly, while legacy formats use the legacy
      // decrypt helper.  If the wallet is unprotected but no key material is
      // present, we cannot proceed.
      let pkBuf;
      if (isLegacyPK) {
        console.log("🔑 Decrypting legacy privateKey…");
        pkBuf = legacy.decrypt(pkVal, { aad });
      } else if (isLegacyString) {
        console.log("🔑 Decrypting legacy blob…");
        pkBuf = legacy.decrypt(blob, { aad });
      } else if (!wallet.isProtected || isBase58PK) {
        // Decode a base58-encoded private key.  Accept both Buffers and strings.
        const raw = (() => {
          if (!pkVal) return null;
          if (Buffer.isBuffer(pkVal)) return pkVal.toString();
          if (typeof pkVal === 'string') return pkVal;
          return null;
        })();
        // Log without printing any portion of the raw key
        console.log("🔑 Decoding base58 privateKey…", Buffer.isBuffer(pkVal) ? 'Buffer' : typeof pkVal);
        if (!raw || typeof raw !== 'string') {
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
      // best-effort wipe the plaintext
      try { pkBuf.fill(0); } catch {}

      // Compute Argon2 hash of the pass-phrase
      const passHash = await argon2.hash(passphrase);

      if (applyToAll) {
        // Apply this pass-phrase to all current and future wallets
        await prisma.$transaction(async (tx) => {
          // 1. Update user default hash + hint
          await tx.user.update({
            where: { id: userId },
            data: {
              defaultPassphraseHash: passHash,
              passphraseHint: passphraseHint || null,
            },
          });

          // 2. Find all wallets that need migration: either have a legacy
          // privateKey or legacy string, or are unprotected.  We select
          // privateKey to handle both cases.  Skip already protected wallets.
          const toUpgrade = await tx.wallet.findMany({
            where: {
              userId,
              OR: [
                { privateKey: { not: null } },
                { isProtected: false },
              ],
            },
            select: { id: true, encrypted: true, isProtected: true, privateKey: true },
          });

          for (const w of toUpgrade) {
            // skip current wallet as it will be updated separately
            if (w.id === walletId) continue;
            const upgradeAad = `user:${userId}:wallet:${w.id}`;
            let pk;
            const enc = w.encrypted;
            const strLegacy = typeof enc === "string" && enc.includes(":");
            if (w.privateKey) {
              pk = legacy.decrypt(w.privateKey, { aad: upgradeAad });
            } else if (strLegacy) {
              pk = legacy.decrypt(enc, { aad: upgradeAad });
            } else {
              // cannot migrate unprotected envelope without legacy material
              continue;
            }
            const newWrap = await encryptPrivateKey(pk, {
              passphrase,
              aad: upgradeAad,
            });
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

          // 3. Update the current wallet to use global (passphraseHash = null)
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
        // After the transaction commit, use the updated envelope for unwrap
        blob = wrapped;
        // Reflect updates in local wallet representation
        wallet.isProtected = true;
        wallet.passphraseHash = null;
        wallet.privateKey = null;
      } else {
        // Per-wallet pass-phrase: set hash on this wallet only
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
        // Reflect updates locally for subsequent logic
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
    // Only enforce pass-phrase matching when wallet is already protected
    let validPass = false;
    if (wallet.passphraseHash) {
      try {
        validPass = await argon2.verify(wallet.passphraseHash, passphrase);
      } catch {
        validPass = false;
      }
    }
    // fallback to user default pass-phrase
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

  /* ───── 6. Unwrap DEK using provided pass-phrase ───── */
  let DEK;
  try {
    DEK = await unwrapDEKWithPassphrase(blob, passphrase, aad);
  } catch (err) {
    console.error("❌ Passphrase unwrap failed:", err.message);
    return res.status(401).json({ error: "Invalid passphrase" });
  }

  /* ───── 7. Cache session and respond ───── */
  // Default to 240 minutes if missing/invalid, but allow any integer ≥1
  const ttlMin = ttlNormalize(ttlMinutes, 240);
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

/*
 * Route: POST /setup-protection
 *
 * This endpoint sets a passphrase on an unprotected or legacy wallet without
 * immediately arming it. It performs the same migration logic as the
 * /arm route but does not require 2FA and does not unlock the wallet.
 * Clients should call this endpoint when protecting a wallet for the first
 * time. To subsequently unlock a protected wallet for trading, use the
 * /arm route which enforces 2FA (when enabled) and creates a timed session.
 *
 * Accepts:
 *   walletId        – the ID of the wallet to protect (required)
 *   passphrase      – the new passphrase to encrypt the wallet with (required)
 *   applyToAll      – optional boolean to apply this passphrase to all
 *                     existing and future wallets (global passphrase)
 *   passphraseHint  – optional string hint stored on the user or wallet
 *   forceOverwrite  – optional boolean allowing overwriting existing per-wallet
 *                     passphrases during applyToAll; otherwise existing
 *                     protected wallets are left untouched
 *
 * Returns:
 *   { ok: true, walletId, label, migrated }
 */
router.post("/setup-protection", requireAuth, async (req, res) => {
  // Do not log full request bodies; only log the walletId to avoid leaking passphrases
  console.log("🔐 /setup-protection called", { walletId: req.body && req.body.walletId });
  const {
    walletId,
    passphrase,
    applyToAll,
    passphraseHint,
    forceOverwrite,
  } = req.body || {};

  // Validate required fields
  if (!walletId || passphrase === undefined) {
    console.warn("⛔ Missing walletId / passphrase");
    return res.status(400).json({ error: "walletId & passphrase required" });
  }

  const userId = req.user.id;

  // Fetch user and wallet
  const [user, wallet] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
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
        passphraseHint: true,
        privateKey: true,
      },
    }),
  ]);

  if (!wallet) {
    console.warn("⛔ Wallet not found");
    return res.status(404).json({ error: "Wallet not found" });
  }

  // Prepare associated data for encryption/decryption
  const aad = `user:${userId}:wallet:${walletId}`;
  let blob = wallet.encrypted;
  let migrating = false;

  // Determine if migration is needed: unprotected, legacy envelope, legacy
  // privateKey or plain base58 key.  A legacy private key is either an
  // object with a `ct` property or a string containing a colon.  A
  // base58 string with no colon is considered an unprotected secret.
  const isLegacyString = typeof blob === "string" && blob.includes(":");
  const pkVal = wallet.privateKey;
  // Determine whether privateKey holds a legacy encrypted blob.  Buffers
  // returned by bs58.encode are considered base58.  Only objects with a
  // `ct` property or colon-delimited strings are treated as legacy.
  const isLegacyPK = !!pkVal && !Buffer.isBuffer(pkVal) && (
    (typeof pkVal === "object" && pkVal.ct) ||
    (typeof pkVal === "string" && pkVal.includes(":"))
  );
  // Determine whether privateKey is a base58 string/Buffer (not containing a colon)
  let pkStringForDetect;
  if (pkVal) {
    if (Buffer.isBuffer(pkVal)) pkStringForDetect = pkVal.toString();
    else if (typeof pkVal === "string") pkStringForDetect = pkVal;
    else pkStringForDetect = null;
  }
  const isBase58PK = !!pkStringForDetect && !pkStringForDetect.includes(":");
  // Always migrate if wallet is not yet protected or we detect any
  // legacy/base58 secret.  Also honour forceOverwrite to allow replacing
  // existing per-wallet passphrases when applying to all.
  const needsMigration = !wallet.isProtected || isLegacyString || isLegacyPK || isBase58PK || forceOverwrite;

  // Emit debug logs without exposing key material.  pkPreview has been removed.
  console.log("🔍 setup-protection debug", {
    walletId,
    isLegacyString,
    isLegacyPK,
    isBase58PK,
    isProtected: wallet.isProtected,
    forceOverwrite,
    pkType: Buffer.isBuffer(pkVal) ? 'Buffer' : typeof pkVal,
  });

  if (!needsMigration) {
    // Wallet is already protected and no forceOverwrite flag; nothing to do
    return res.status(400).json({ error: "Wallet already protected" });
  }

  migrating = true;
  try {
    // Decrypt or decode the existing private key based on its format.  Base58
    // strings are decoded directly, while legacy formats use the legacy
    // decrypt helper.  If the wallet is unprotected but no key material is
    // present, bail out.
    let pkBuf;
    if (isLegacyPK) {
      // Legacy encrypted private key stored in wallet.privateKey
      pkBuf = legacy.decrypt(pkVal, { aad });
    } else if (isLegacyString) {
      // Legacy colon-delimited string stored in wallet.encrypted
      pkBuf = legacy.decrypt(blob, { aad });
    } else if (!wallet.isProtected || isBase58PK) {
      // Base58 encoded secret stored in wallet.privateKey.  Accept both strings
      // and Buffers.  Convert to string prior to decoding.
      const raw = (() => {
        if (!pkVal) return null;
        if (Buffer.isBuffer(pkVal)) return pkVal.toString();
        if (typeof pkVal === 'string') return pkVal;
        return null;
      })();
      if (!raw || typeof raw !== 'string') {
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
      // Wallet is already protected but forceOverwrite implies we may change passphrase;
      // to do this we need to unwrap the key using the existing passphrase.  We
      // cannot perform this without the passphrase from the user, so we
      // decline.  Clients should call /arm to rewrap an existing wallet.
      throw new Error("Cannot overwrite passphrase without existing key material");
    }

    // Re-encrypt the private key under the new passphrase
    const wrapped = await encryptPrivateKey(pkBuf, {
      passphrase,
      aad,
    });
    // Best-effort wipe plaintext from memory
    try {
      pkBuf.fill(0);
    } catch {}

    // Compute Argon2 hash of new passphrase
    const passHash = await argon2.hash(passphrase);

    if (applyToAll) {
      // Apply this passphrase to all wallets.  This will override
      // per-wallet passphrases.  We ignore forceOverwrite here because
      // we're explicitly overwriting everything.
      await prisma.$transaction(async (tx) => {
        // 1. Update user with global passphrase hash & hint
        await tx.user.update({
          where: { id: userId },
          data: {
            defaultPassphraseHash: passHash,
            passphraseHint: passphraseHint || null,
          },
        });

        // 2. Find wallets needing migration or unprotected; update them all
        const toUpgrade = await tx.wallet.findMany({
          where: {
            userId,
            OR: [
              { privateKey: { not: null } },
              { isProtected: false },
            ],
          },
          select: { id: true, encrypted: true, isProtected: true, privateKey: true },
        });
        for (const w of toUpgrade) {
          // Skip current wallet; we'll update separately
          if (w.id === walletId) continue;
          const upgradeAad = `user:${userId}:wallet:${w.id}`;
          let pk;
          const enc = w.encrypted;
          const strLegacy = typeof enc === "string" && enc.includes(":");
          const pkVal = w.privateKey;
          if (pkVal) {
            // Determine whether the stored privateKey is a legacy encrypted
            // payload (object with ct or colon-delimited string) or a base58
            // encoded secret.  When base58 we decode directly; when legacy we
            // decrypt via the legacy helper.  Other formats are skipped.
            const isLegacyPK = !!pkVal && !Buffer.isBuffer(pkVal) && (
              (typeof pkVal === "object" && pkVal.ct) ||
              (typeof pkVal === "string" && pkVal.includes(":"))
            );
            let base58ForDetect;
            if (pkVal) {
              if (Buffer.isBuffer(pkVal)) base58ForDetect = pkVal.toString();
              else if (typeof pkVal === "string") base58ForDetect = pkVal;
            }
            const isBase58PK = !!base58ForDetect && !base58ForDetect.includes(":");
            if (isLegacyPK) {
              pk = legacy.decrypt(pkVal, { aad: upgradeAad });
            } else if (isBase58PK) {
              // Decode the base58-encoded secret key.  Skip if invalid.
              try {
                const raw = base58ForDetect.trim();
                const decoded = bs58.decode(raw);
                if (decoded.length !== 64) throw new Error();
                pk = Buffer.from(decoded);
              } catch {
                // Invalid base58 format; cannot migrate
                continue;
              }
            } else {
              // Unsupported format; skip this wallet
              continue;
            }
          } else if (strLegacy) {
            // Fallback to legacy string stored in encrypted field
            pk = legacy.decrypt(enc, { aad: upgradeAad });
          } else {
            // Cannot migrate unprotected envelope without legacy material
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

        // 3. Update the current wallet to use the global passphrase
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
      // Reflect updates locally
      wallet.isProtected = true;
      wallet.passphraseHash = null;
      wallet.privateKey = null;
    } else {
      // Per-wallet passphrase: update just this wallet
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
    console.log("✅ Wallet protection setup complete");
  } catch (err) {
    console.error("❌ Setup-protection failed:", err.message);
    return res.status(500).json({ error: err.message || "Wallet protection setup failed" });
  }

  // Use the migrating flag to indicate whether a legacy or base58 key was upgraded.
  return res.json({ ok: true, walletId, label: wallet.label, migrated: migrating });
});

router.post("/extend", requireAuth, check2FA, async (req, res) => {
  // Log incoming request without echoing sensitive body contents
  console.log("🔁 /extend called", { walletId: (req.body && req.body.walletId) });
  const { walletId, ttlMinutes } = req.body || {};
  if (!walletId) {
    console.warn("⛔ /extend missing walletId");
    return res.status(400).json({ error: "walletId required" });
  }
  // Extend by any integer minutes ≥1; default to 120 when missing/invalid
  const ttlMin = ttlNormalize(ttlMinutes, 120);
  const ok = extend(req.user.id, walletId, ttlMin * 60_000);
  if (!ok) {
    console.warn(`⛔ /extend failed → wallet ${walletId} not armed or session expired`);
    return res.status(400).json({ error: "Not armed" });
  }
  console.log(`✅ /extend successful → wallet ${walletId} extended to ${ttlMin} minutes`);
  return res.json({ ok: true, walletId, extendedToMinutes: ttlMin });
});

router.post("/disarm", requireAuth, check2FA, async (req, res) => {
  // Log disarm request without dumping the full body
  console.log("🔻 /disarm called", { walletId: (req.body && req.body.walletId) });
  const { walletId } = req.body || {};
  if (!walletId) {
    console.warn("⛔ /disarm missing walletId");
    return res.status(400).json({ error: "walletId required" });
  }
  try {
    disarm(req.user.id, walletId);
    console.log(`✅ Wallet ${walletId} disarmed by user ${req.user.id}`);
    return res.json({ ok: true, walletId, disarmed: true });
  } catch (e) {
    console.error(`❌ Disarm failed for wallet ${walletId}:`, e.message);
    return res.status(500).json({ error: "Failed to disarm" });
  }
});

/*
 * Route: POST /remove-protection
 *
 * Remove pass-phrase protection from an existing wallet.  This operation
 * requires the caller to provide the current pass-phrase for the wallet
 * (or the user’s default pass-phrase if the wallet uses that).  The server
 * will verify the pass-phrase, unwrap the DEK and secret key, then
 * re-encrypt the key using the legacy helper and store it in the
 * `privateKey` field.  The envelope (`encrypted`) and pass-phrase
 * metadata are cleared, and `isProtected` is set to false.  Any active
 * arm session for the wallet is terminated.  After removal the wallet
 * behaves as an unprotected legacy wallet.
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
        select: { defaultPassphraseHash: true },
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
    // Derive secret key from envelope
    const aad = `user:${userId}:wallet:${walletId}`;
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
    // Encode to base58
    const pkBase58 = bs58.encode(Buffer.from(pkBuf));
    // Clear sensitive buffers
    try { pkBuf.fill(0); } catch {}
    try { DEK.fill(0); } catch {}
    // Encrypt the base58 secret using legacy helper with AAD.  The encrypt()
    // helper returns an object with base64-encoded iv, tag and cipher text.
    // Prisma cannot store nested objects into a string column so we convert
    // this payload into the legacy colon-delimited hex format.  This format
    // is supported by the decrypt() helper via the `_decryptLegacy` path.
    const legacyEnc = encrypt(pkBase58, { aad });
    // Convert the base64 payload into hex strings and join with colons.  This
    // mirrors the previous "ivHex:tagHex:cipherHex" storage format.  When
    // decrypting, the legacy.decrypt() helper will detect a colon-delimited
    // string and invoke the legacy decryption routine.
    const ivHex  = Buffer.from(legacyEnc.iv,  'base64').toString('hex');
    const tagHex = Buffer.from(legacyEnc.tag, 'base64').toString('hex');
    const ctHex  = Buffer.from(legacyEnc.ct,  'base64').toString('hex');
    const legacyString = `${ivHex}:${tagHex}:${ctHex}`;
    // Remove any active session
    try {
      disarm(userId, walletId);
    } catch (e) {
      console.warn("⚠️ Error disarming during remove-protection:", e.message);
    }
    // Persist changes: clear envelope & passphrase, set privateKey
    await prisma.wallet.update({
      where: { id: walletId },
      data: {
        encrypted: null,
        isProtected: false,
        passphraseHash: null,
        passphraseHint: null,
        // Store the colon-delimited string representation in privateKey.  This
        // preserves at-rest encryption while remaining compatible with our
        // legacy decrypt() helper.
        privateKey: legacyString,
      },
    });
    console.log(`✅ Removed protection for wallet ${walletId}`);
    return res.json({ ok: true, walletId, removed: true });
  } catch (err) {
    console.error("🔥 remove-protection error:", err.stack || err);
    return res.status(500).json({ error: "Failed to remove protection" });
  }
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
    // Allow any default ≥ 1 minute; no maximum.
    body("armDefaultMinutes").optional().isInt({ min: 1 }),
  ],
  async (req, res) => {
    // Log incoming toggle request without dumping the full body
    console.log("⚙️ /require-arm called", { requireArmToTrade: req.body && req.body.requireArmToTrade, armDefaultMinutes: req.body && req.body.armDefaultMinutes });
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

/**
 * GET /api/auto-return/status
 *
 * Returns the authenticated user’s current auto-return configuration.  The
 * destination public key, default enabled flag and verification timestamp
 * are exposed.  If no configuration exists the result may contain null
 * values or omitted fields.
 */
router.get('/status', requireAuth, async (req, res) => {
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
    console.error('autoReturn GET status error:', err);
    res.status(500).json({ error: 'Failed to load auto-return status' });
  }
});

/**
 * POST /api/auto-return/setup
 *
 * Configure the auto-return settings for the authenticated user.  The
 * payload may include a new destination public key and/or default flag.
 * When a destination pubkey is provided we mark it as verified
 * immediately; a real implementation should perform a tiny test transfer
 * and require a signature/2FA challenge before persisting the change.
 */
router.post('/setup', requireAuth, async (req, res) => {
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
  // Basic pubkey validation: must be a non-empty string.  In production
  // you’d parse using bs58 and ensure the correct length.
  if (destPubkey !== undefined && destPubkey !== null) {
    if (typeof destPubkey !== 'string' || destPubkey.trim().length === 0) {
      return res.status(400).json({ error: 'Invalid destination pubkey' });
    }
  }
  try {
    const patch = {};
    if (enabled !== undefined) patch.autoReturnEnabledDefault = !!enabled;
    if (destPubkey !== undefined) {
      patch.autoReturnDestPubkey = destPubkey;
      // Immediately mark as verified; this should be replaced with a real
      // verification handshake (e.g. send 0.000001 SOL and wait for receipt).
      patch.autoReturnDestVerifiedAt = new Date();
    }
    if (graceSeconds !== undefined) patch.autoReturnGraceSeconds = parseInt(graceSeconds);
    if (sweepTokens !== undefined) patch.autoReturnSweepTokens = !!sweepTokens;
    if (solMinKeepLamports !== undefined) patch.autoReturnSolMinKeepLamports = BigInt(solMinKeepLamports);
    if (feeBufferLamports !== undefined) patch.autoReturnFeeBufferLamports = BigInt(feeBufferLamports);
    if (excludeMints !== undefined) patch.autoReturnExcludeMints = Array.isArray(excludeMints) ? excludeMints : [excludeMints];
    if (usdcMints !== undefined) patch.autoReturnUsdcMints = Array.isArray(usdcMints) ? usdcMints : [usdcMints];
    await prisma.user.update({ where: { id: req.user.id }, data: patch });
    return res.json({ ok: true });
  } catch (err) {
    console.error('autoReturn POST setup error:', err);
    res.status(500).json({ error: 'Failed to update auto-return settings' });
  }
});

// Aliases for legacy FE paths
router.get('/auto-return/settings', requireAuth, async (req, res) => {
  const u = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { autoReturnEnabledDefault: true, autoReturnDestPubkey: true },
  });
  return res.json({
    destPubkey: u?.autoReturnDestPubkey || "",
    defaultEnabled: !!u?.autoReturnEnabledDefault,
  });
});

router.post('/auto-return/settings', requireAuth, async (req, res) => {
  const { destPubkey, defaultEnabled, enabled } = req.body || {};
  const patch = {};
  if (destPubkey !== undefined) patch.autoReturnDestPubkey = destPubkey;
  if (defaultEnabled !== undefined || enabled !== undefined) {
    patch.autoReturnEnabledDefault = !!(defaultEnabled ?? enabled);
  }
  await prisma.user.update({ where: { id: req.user.id }, data: patch });
  res.json({ ok: true });
});

module.exports = router;
