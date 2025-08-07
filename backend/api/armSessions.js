// backend/api/armSessions.js
// Routes: arm / extend / disarm / status. 2FA-gated. Rate-limit recommended.
// Assumes prisma schema with `User(requireArmToTrade:boolean)` and `Wallet` table
// where wallet.encrypted (JSON) stores the envelope blob.

// Legacy support: if wallet.encrypted is *legacy* (iv:tag:cipher hex string) or a
// legacy `privateKey` exists, the arm endpoint will automatically migrate
// the secret under the hood on first arm. Clients no longer need to send
// `migrateLegacy=true`; the server auto‑detects and upgrades in place.
const express = require("express");
const router = express.Router();
const { body, validationResult } = require("express-validator");

const argon2 = require("argon2"); // for pass‑phrase hashing when migrating

const prisma = require("../prisma/prisma");
const requireAuth = require("../middleware/requireAuth");
const check2FA = require("../middleware/auth/check2FA"); // user uploaded
const { arm, extend, disarm, status } = require("../armEncryption/sessionKeyCache");
const { unwrapDEKWithPassphrase, encryptPrivateKey, decryptPrivateKeyWithDEK } = require("../armEncryption/envelopeCrypto");
const legacy = require("../middleware/auth/encryption"); // your legacy (iv:tag:cipher) helper
const bs58 = require("bs58");
const { encrypt } = require("../middleware/auth/encryption");

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
  const isLegacyPK = !!pkVal && (
    (typeof pkVal === "object" && pkVal.ct) ||
    (typeof pkVal === "string" && pkVal.includes(":"))
  );
  const isBase58PK = !!pkVal && typeof pkVal === "string" && !pkVal.includes(":");
  const needsMigration = !wallet.isProtected || isLegacyString || isLegacyPK || isBase58PK;

  // Emit verbose debug logs about migration decisions for troubleshooting
  console.log("🔍 arm debug:", {
    walletId,
    isLegacyString,
    isLegacyPK,
    isBase58PK,
    isProtected: wallet.isProtected,
    pkType: typeof pkVal,
    pkPreview: pkVal && typeof pkVal === 'string' ? pkVal.slice(0, 10) + '…' : pkVal,
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
        console.log("🔑 Decoding base58 privateKey…", typeof pkVal, pkVal ? pkVal.slice(0, 8) + "…" : pkVal);
        // decode whichever is available; pkVal must be a string at this point
        if (!pkVal || typeof pkVal !== 'string') {
          throw new Error("Unsupported unprotected wallet format");
        }
        try {
          const decoded = bs58.decode(pkVal.trim());
          if (decoded.length !== 64) throw new Error();
          pkBuf = Buffer.from(decoded);
        } catch {
          throw new Error("Unsupported unprotected wallet format");
        }
      } else {
        throw new Error("Unsupported unprotected wallet format");
      }

      // Re‑encrypt under the supplied pass‑phrase
      console.log("🔒 Re‑encrypting to envelope-v1…");
      const wrapped = await encryptPrivateKey(pkBuf, {
        passphrase,
        aad,
      });
      // best-effort wipe the plaintext
      try { pkBuf.fill(0); } catch {}

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
        // Per‑wallet pass‑phrase: set hash on this wallet only
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
 *   forceOverwrite  – optional boolean allowing overwriting existing per‑wallet
 *                     passphrases during applyToAll; otherwise existing
 *                     protected wallets are left untouched
 *
 * Returns:
 *   { ok: true, walletId, label, migrated }
 */
router.post("/setup-protection", requireAuth, async (req, res) => {
  console.log("🔐 /setup-protection called → req.body:", req.body);
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
  const isLegacyPK = !!pkVal && (
    (typeof pkVal === "object" && pkVal.ct) ||
    (typeof pkVal === "string" && pkVal.includes(":"))
  );
  const isBase58PK = !!pkVal && typeof pkVal === "string" && !pkVal.includes(":");
  // Always migrate if wallet is not yet protected or we detect any
  // legacy/base58 secret.  Also honour forceOverwrite to allow replacing
  // existing per‑wallet passphrases when applying to all.
  const needsMigration = !wallet.isProtected || isLegacyString || isLegacyPK || isBase58PK || forceOverwrite;

  // Emit verbose debug logs so we can understand migration decisions.
  console.log("🔍 setup-protection debug:", {
    walletId,
    isLegacyString,
    isLegacyPK,
    isBase58PK,
    isProtected: wallet.isProtected,
    forceOverwrite,
    pkType: typeof pkVal,
    pkPreview: pkVal && typeof pkVal === 'string' ? pkVal.slice(0, 10) + '…' : pkVal,
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
      // Base58 encoded secret stored in wallet.privateKey
      if (!pkVal || typeof pkVal !== 'string') {
        throw new Error("Unsupported unprotected wallet format");
      }
      try {
        const decoded = bs58.decode(pkVal.trim());
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
          if (w.privateKey) {
            pk = legacy.decrypt(w.privateKey, { aad: upgradeAad });
          } else if (strLegacy) {
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

  return res.json({ ok: true, walletId, label: wallet.label, migrated });
});





router.post("/extend", requireAuth, check2FA, async (req, res) => {
  // Log incoming request for troubleshooting
  console.log("🔁 /extend called → body:", req.body);
  const { walletId, ttlMinutes } = req.body || {};
  if (!walletId) {
    console.warn("⛔ /extend missing walletId");
    return res.status(400).json({ error: "walletId required" });
  }
  // Clamp TTL within allowed bounds and extend the session
  const ttlMin = ttlClamp(30, 120, 720, ttlMinutes);
  const ok = extend(req.user.id, walletId, ttlMin * 60_000);
  if (!ok) {
    console.warn(`⛔ /extend failed → wallet ${walletId} not armed or session expired`);
    return res.status(400).json({ error: "Not armed" });
  }
  console.log(`✅ /extend successful → wallet ${walletId} extended to ${ttlMin} minutes`);
  return res.json({ ok: true, walletId, extendedToMinutes: ttlMin });
});






router.post("/disarm", requireAuth, check2FA, async (req, res) => {
  // Log disarm request to help trace issues
  console.log("🔻 /disarm called → body:", req.body);
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
 * Remove pass‑phrase protection from an existing wallet.  This operation
 * requires the caller to provide the current pass‑phrase for the wallet
 * (or the user’s default pass‑phrase if the wallet uses that).  The server
 * will verify the pass‑phrase, unwrap the DEK and secret key, then
 * re‑encrypt the key using the legacy helper and store it in the
 * `privateKey` field.  The envelope (`encrypted`) and pass‑phrase
 * metadata are cleared, and `isProtected` is set to false.  Any active
 * arm session for the wallet is terminated.  After removal the wallet
 * behaves as an unprotected legacy wallet.
 */
router.post("/remove-protection", requireAuth, async (req, res) => {
  console.log("🔓 /remove-protection called → req.body:", req.body);
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
    // Verify pass‑phrase against per‑wallet or global hash
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
    // Encrypt the base58 secret using legacy helper with AAD
    const legacyEnc = encrypt(pkBase58, { aad });
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
        privateKey: legacyEnc,
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
    body("armDefaultMinutes").optional().isInt({ min: 30, max: 720 }),
  ],
  async (req, res) => {
    // Log incoming toggle request for troubleshooting
    console.log("⚙️ /require-arm called → body:", req.body);
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