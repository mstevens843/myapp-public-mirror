const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { Keypair, Connection, clusterApiUrl, PublicKey } = require("@solana/web3.js");
const prisma = require("../prisma/prisma");
const crypto = require("crypto");
const bs58 = require("bs58");
const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const requireAuth = require("../middleware/requireAuth");
const { encrypt, decrypt } = require("../middleware/auth/encryption");
const { loadWalletsFromDb } = require("../services/utils/wallet/walletManager");
const authenticate = require("../middleware/requireAuth")
const { supabase } = require('../lib/supabase')
const check2FA = require("../middleware/auth/check2FA");
const { sendPasswordResetEmail } = require("../utils/emailVerification");
const speakeasy = require("speakeasy");
const qrcode = require("qrcode");
const nacl = require("tweetnacl");
nacl.util = require("tweetnacl-util");
const { v4: uuidv4 } = require("uuid");
const { CSRF_COOKIE, generateCsrfToken, setCsrfCookie } = require("../middleware/csrf");

// Validation, CSRF and auth cookie helpers
const validate = require("../middleware/validate");
const { loginSchema, refreshSchema } = require("./schemas/auth.schema");
const {
  setAccessCookie,
  setRefreshCookie,
  clearAuthCookies,
  REFRESH_TOKEN_TTL_MS,
} = require("../utils/authCookies");

// 🔐 Unprotected envelope wallet service (DB/env aware)
// (replaces inline wrappers; keeps routes skinny)
const {
  createUnprotectedWallet,
  // unlockUnprotectedWallet, migratePlaintextToUnprotected  // available if/when needed
} = require("../armEncryption/unprotected");
console.log("✅ wallets/unprotected service loaded →", typeof createUnprotectedWallet);
console.log("🧠 Running auth.js from →", __filename);

const connection = new Connection(process.env.SOLANA_RPC_URL, "confirmed");

// -----------------------------------------------------------------------------
// Determine whether to emit verbose logs. In production we disable console.log
// entirely to prevent accidental leakage of secrets such as private keys,
// tokens or user identifiers into logs. During development (NODE_ENV !==
// 'production'), logs behave normally.
const DEBUG = process.env.NODE_ENV !== 'production';
if (!DEBUG) {
  // Disable logging in production. Use a proper logging framework instead of
  // console.log when sensitive data must be recorded.
  console.log = () => {};
}


async function loadUserWallets() {
  const loadedWallets = await loadWalletsFromDb({
    prisma,
    userId: req.user.id,
  });
  if (loadedWallets) {setWallets(loadedWallets);}}


function generateRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () =>
    crypto.randomBytes(4).toString("hex").toUpperCase());}


const { createClient } = require('@supabase/supabase-js');
const supabaseServer = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ROLE_KEY);
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


router.post("/phantom", async (req, res) => {
  console.log("↘️  /api/auth/phantom ct:", req.headers["content-type"]);
  console.log("↘️  /api/auth/phantom cookies:", Object.keys(req.cookies || {}));
  console.log("↘️  /api/auth/phantom body keys:", Object.keys(req.body || {}));
  try {
    const { phantomPublicKey, signature, message } = req.body;

    if (!phantomPublicKey || !signature || !message) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // 1) Verify message signature from Phantom
    let verified = false;
    try {
      verified = nacl.sign.detached.verify(
        nacl.util.decodeUTF8(message),
        Buffer.from(signature, "base64"),
        bs58.decode(phantomPublicKey)
      );
    } catch (err) {
      console.error("🛑 Signature verification failed:", err);
      return res.status(400).json({ error: "Invalid signature format" });
    }
    if (!verified) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    // 2) Lookup existing user by phantomPublicKey (no creation here)
    // const user = await prisma.user.findUnique({ where: { phantomPublicKey } });
    const user = await prisma.user.findUnique({
      where: { phantomPublicKey },
      select: {
        id: true,
        userId: true,
        type: true,
        activeWalletId: true,
        phantomPublicKey: true,
        is2FAEnabled: true,
        require2faLogin: true,
        require2faArm: true,
         requireArmToTrade: true,
        wallets: {
          select: {
            id: true,
            label: true,
           publicKey: true,
            isProtected: true,
           passphraseHint: true,
          }
        } 
      }
    });

    // 2a) New wallet → FE should go to /generate
    if (!user) {
      return res.json({ success: true, userExists: false });
    }

    // 2b) 2FA login gate: ask FE to route to /verify-2fa (do NOT set cookies yet)
    if (user.is2FAEnabled && user.require2faLogin) {
      return res.json({
        success: true,
        userExists: true,
        twoFARequired: true,
        userId: user.userId,
      });
    }

    // 3) Existing user (no 2FA gate) → issue cookies + return flags
    // Align expirations with your standard login route (15m/30d).
    const accessToken  = jwt.sign({ id: user.id, type: user.type }, JWT_SECRET, { expiresIn: "15m" });
    const refreshToken = jwt.sign({ id: user.id },                            JWT_SECRET, { expiresIn: "30d" });

    await prisma.refreshToken.create({ data: { token: refreshToken, userId: user.id } });

    // Set HttpOnly cookies + CSRF token (double submit)
    setAccessCookie(res, accessToken);
    setRefreshCookie(res, refreshToken);
    {
      const csrfToken = generateCsrfToken();
      setCsrfCookie(res, csrfToken);
    }

return res.json({
  success: true,
  userExists: true,
  twoFARequired: false,
  userId: user.userId,
  type: user.type,
  accessToken,
  refreshToken,
  user // 👈 send full profile with wallets + isProtected
});
  } catch (err) {
    console.error("🔥 Auth error (phantom):", err.stack || err);
    res.status(500).json({ error: "Server error" });
  }
});



// POST /auth/generate-vault  (web3 signup)
router.post("/generate-vault", async (req, res) => {
  try {
    const { phantomPublicKey, agreedToTerms } = req.body;
    if (!phantomPublicKey) {
      return res.status(400).json({ error: "Missing phantomPublicKey" });
    }
    if (!agreedToTerms) {
      return res.status(400).json({ error: "Must agree to Terms and Privacy Policy" });
    }

    const existing = await prisma.user.findUnique({ where: { phantomPublicKey } });
    if (existing) {
      return res.status(400).json({ error: "User already exists" });
    }

    const now   = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);

    // one transaction; consistently use `tx` as the transactional prisma client
    const transaction = await prisma.$transaction(async (tx) => {
      // 1) make vault keypair
      const keypair   = Keypair.generate();
      const publicKey = keypair.publicKey.toBase58();

      // 2) create a brand-new external userId (AAD for envelope HKDF)
      const newUserId = uuidv4();

      // 3) create the new user row
      const user = await tx.user.create({
        data: {
          userId: newUserId,
          type: "web3",
          phantomPublicKey,
          agreedToTermsAt: new Date(),
        },
      });

      // 4) persist wallet via service (unprotected envelope; NEVER plaintext)
      const createdWallet = await createUnprotectedWallet({
        prismaClient: tx,
        dbUserId:     user.id,                 // FK → User.id
        aadUserId:    newUserId,               // HKDF salt / AAD identifier
        label:        "starter",
        secretKey:    Buffer.from(keypair.secretKey),
        publicKey,                             // optional, but we have it
      });

      // 5) set vault key + active wallet
      await tx.user.update({
        where: { id: user.id },
        data : { vaultPublicKey: publicKey, activeWalletId: createdWallet.id },
      });

      // 6) defaults
      await tx.userPreference.create({ data: { userId: user.id } });

      // 7) seed portfolio tables
      await tx.portfolioTracker.create({ data: { userId: user.id, startTs: now, lastMonthlyTs: now } });
      await tx.netWorthHistory.create({
        data: { userId: user.id, ts: now, date: today, value: 0, minute: new Date(now).toISOString().slice(0, 16) }
      });
      await tx.netWorthSnapshot.create({
        data: { userId: user.id, ts: now, netWorth: 0, sol: 0, usdc: 0, openPositions: 0 }
      });

      // keep legacy return values (privateKey base58) for clients that still expect it
      const privateKeyBase58 = bs58.encode(keypair.secretKey).toString();
      return { user, createdWallet, privateKey: privateKeyBase58, publicKey };
    });

    // JWTs + cookies + csrf
    const accessToken  = jwt.sign({ id: transaction.user.id, type: transaction.user.type }, JWT_SECRET, { expiresIn: "365d" });
    const refreshToken = jwt.sign({ id: transaction.user.id }, JWT_SECRET, { expiresIn: "365d" });

    await prisma.refreshToken.create({ data: { token: refreshToken, userId: transaction.user.id } });
    setAccessCookie(res, accessToken);
    setRefreshCookie(res, refreshToken);
    setCsrfCookie(res, generateCsrfToken());

res.status(201).json({
  accessToken,
  refreshToken,
  vaultPublicKey:  transaction.publicKey,
  vaultPrivateKey: transaction.privateKey,   // legacy bridge
  userId:          transaction.user.id,      // ← local DB id (consistent with /register)
  externalUserId:  transaction.user.userId,  // ← keep for web3 flows
  type:            transaction.user.type,
  activeWalletId:  transaction.createdWallet.id,
});
  } catch (err) {
    console.error("🔥 Vault gen error:", err.stack || err);
    res.status(500).json({ error: "Failed to generate vault" });
  }
});




router.post("/vault-balance", async (req, res) => {
  try {
    const { phantomPublicKey } = req.body;
    console.log("📥 /vault-balance → Received phantomPublicKey:", phantomPublicKey);

    if (!phantomPublicKey) {
      console.warn("⚠️ /vault-balance → Missing phantomPublicKey");
      return res.status(400).json({ error: "Missing phantomPublicKey" });
    }

    const user = await prisma.user.findUnique({
      where: { phantomPublicKey },
      select: { vaultPublicKey: true }
    });

    console.log("🔍 /vault-balance → Prisma user result:", user);

    if (!user || !user.vaultPublicKey) {
      console.warn("⚠️ /vault-balance → Vault not found for user:", phantomPublicKey);
      return res.status(404).json({ error: "Vault not found for user" });
    }

const lamports = await connection.getBalance(new PublicKey(user.vaultPublicKey));
    const sol = lamports / 1e9;

    console.log("✅ /vault-balance → Returning balance:", { sol, lamports });

    res.json({ balance: sol, lamports, vaultPublicKey: user.vaultPublicKey });
  } catch (err) {
    console.error("💥 /vault-balance → Error:", err.stack || err);
    res.status(500).json({ error: "Balance check failed" });
  }
});


router.post("/vault-balance-direct", async (req, res) => {
  try {
    const { vaultPubkey } = req.body;
    console.log("📥 /vault-balance-direct → Received vaultPubkey:", vaultPubkey);

    if (!vaultPubkey) {
      console.warn("⚠️ /vault-balance-direct → Missing vaultPubkey");
      return res.status(400).json({ error: "Missing vaultPubkey" });
    }

    const conn = new Connection(process.env.SOLANA_RPC_URL, "confirmed");
    const lamports = await conn.getBalance(new PublicKey(vaultPubkey));
    const sol = lamports / 1e9;

    console.log("✅ /vault-balance-direct → Returning balance:", { sol, lamports });

    res.json({ balance: sol, lamports, vaultPublicKey: vaultPubkey });
  } catch (err) {
    console.error("💥 /vault-balance-direct → Error:", err.stack || err);
    res.status(500).json({ error: "Balance check failed" });
  }
});



router.post("/check-user", async (req, res) => {
  try {
    const { phantomPublicKey } = req.body;
    if (!phantomPublicKey) {
      return res.status(400).json({ error: "Missing phantomPublicKey" });
    }

    // 1. find by wallet
    const user = await prisma.user.findUnique({ where: { phantomPublicKey } });
    if (!user) return res.status(404).json({ exists: false });

    /* NEW: login-time MFA toggle */
    if (user.is2FAEnabled && user.require2faLogin) {
      return res.json({ twoFARequired: true, userId: user.userId });
    }


    // 3. issue tokens using correct ID field
    const accessToken  = jwt.sign(
      { id: user.id, type: user.type },
      JWT_SECRET,
      { expiresIn: "365d" }
    );

    const refreshToken = jwt.sign(
      { id: user.id },
      JWT_SECRET,
      { expiresIn: "365d" }
    );

    await prisma.refreshToken.create({
      data: { token: refreshToken, userId: user.id }
    });

    // 4. set cookie (helpers + CSRF)  ← changed
    setAccessCookie(res, accessToken);
    setRefreshCookie(res, refreshToken);
    {
      const csrfToken = generateCsrfToken();
      setCsrfCookie(res, csrfToken);
    }

    // 5. success payload
    res.json({
      exists: true,
      type  : user.type,
      userId: user.userId,
      phantomPublicKey: user.phantomPublicKey,
      twoFARequired: false,
      accessToken,
      refreshToken,
    });

  } catch (err) {
    console.error("check-user DB error:", err);
    res.status(500).json({ error: "DB error" });
  }
});




// GET /auth/me
// routes/auth.route.js (or wherever your /auth routes live)
// GET /auth/me
router.get("/me", requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },                 // ← always present now
      select: {
        id: true, username: true, email: true, type: true, createdAt: true,
        is2FAEnabled: true,
        require2faLogin: true,
        require2faArm: true,
        requireArmToTrade: true,
        defaultPassphraseHash: true,
        passphraseHint: true,
        phantomPublicKey: true,
        plan: true, subscriptionStatus: true,
        usage: true, usageResetAt: true, credits: true,
        activeWalletId: true,
        // Expose a minimal view of wallets including protection status.  The
        // isProtected flag indicates whether a wallet has been encrypted
        // with a pass‑phrase (local or global).  We do not expose the
        // passphraseHash itself to the client for security reasons.
        wallets: {
          select: {
            id: true,
            label: true,
            publicKey: true,
            isProtected: true,
            passphraseHint: true, 
          },
        },
        userPreferences: {
          select: {
            autoBuyEnabled:true, autoBuyAmount:true, slippage:true
          }},
        telegramPreferences: { select:{ enabled:true, chatId:true } }
      }
    });

    if (!user) return res.status(404).json({ error:"User not found" });

    const activeWallet = user.activeWalletId
      ? await prisma.wallet.findUnique({
          where:{ id: user.activeWalletId },
          select:{ id:true, label:true, publicKey:true, passphraseHint:true, isProtected:true }
        })
      : null;

    const [scheduled, limits, dca] = await Promise.all([
      prisma.scheduledStrategy.count({ where:{ userId:user.id } }),
      prisma.limitOrder.count({ where:{ userId:user.id, status:"open" } }),
      prisma.dcaOrder.count({ where:{ userId:user.id,  status:"active" } })
    ]);

    // Derive a simple flag for the presence of a global wallet pass‑phrase. We
    // do not expose the hash itself to the client for security reasons. The
    // client can use this to disable the “Use for all wallets” checkbox.
    const hasGlobalPassphrase = !!user.defaultPassphraseHash;
    return res.json({
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          type: user.type,
          phantomPublicKey: user.phantomPublicKey,
          createdAt: user.createdAt,
          is2FAEnabled: user.is2FAEnabled,
          require2faLogin: user.require2faLogin,
          require2faArm: user.require2faArm,
          requireArmToTrade: user.requireArmToTrade,
          hasGlobalPassphrase,
          passphraseHint: user.passphraseHint,
        },
      plan: {
        plan: user.plan,
        subscriptionStatus: user.subscriptionStatus,
        usage: user.usage,
        usageResetAt: user.usageResetAt,
        credits: user.credits,
      },
      preferences: user.userPreferences,
      telegram:    user.telegramPreferences,
      activeWallet,
      wallets:     user.wallets,
      counts: {
        scheduledStrategies: scheduled,
        limitOrders:         limits,
        dcaOrders:           dca,
      },
    });
  } catch (err) {
    console.error("/auth/me ⇒", err);
    return res.status(500).json({ error:"Server error" });
  }
});



// POST /auth/enable-2fa
router.post("/enable-2fa", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    // ✅ Manually generate base32 secret, skip generateSecret
    const secret = speakeasy.generateSecret({ length: 32 }).base32;

    // ✅ Construct a CLEAN otpauth URL with NO colon
    const otpauth_url = `otpauth://totp/SolPulse?secret=${secret}`;

    // 🔐 Generate recovery codes
    const recoveryCodes = generateRecoveryCodes();
    const hashedCodes = await Promise.all(
      recoveryCodes.map(code => bcrypt.hash(code, 10))
    );

    // 🔐 Store in DB
    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorSecret: secret,
        is2FAEnabled: false,
        recoveryCodes: hashedCodes
      }
    });

    // ✅ Generate QR code from clean otpauth URL
    const qrCodeDataURL = await qrcode.toDataURL(otpauth_url);

    res.json({
      message: "Scan this QR code in Google Authenticator",
      qrCodeDataURL,
      recoveryCodes
    });
  } catch (err) {
    console.error("Enable 2FA error:", err);
    res.status(500).json({ error: "Failed to enable 2FA" });
  }
});



router.post("/request-password-reset", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: "Email is required." });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.status(404).json({ error: "No user found with this email." });
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordResetToken: token,
      passwordResetExpires: expires,
    },
  });

const link = `${process.env.FRONTEND_URL}/auth/reset-password?token=${token}`;
await sendPasswordResetEmail(user.email, link);

  res.json({ message: "Password reset link sent." });
});


router.post("/verify-reset-token", async (req, res) => {
  const { token } = req.body;

  if (!token) return res.status(400).json({ error: "Missing token." });

  const user = await prisma.user.findFirst({
    where: {
      passwordResetToken: token,
      passwordResetExpires: { gt: new Date() },
    },
  });

  if (!user) {
    return res.status(400).json({ error: "Invalid or expired token." });
  }

  res.json({ message: "Valid token." });
});




//  Verify & activate 2FA
router.post("/verify-2fa", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { token } = req.body;

    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user.twoFactorSecret) {
      return res.status(400).json({ error: "2FA not initialized for user." });
    }

    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: "base32",
      token
    });

    if (!verified) {
      return res.status(400).json({ error: "Invalid 2FA token." });
    }

    await prisma.user.update({
      where: { id: userId },
      data: { is2FAEnabled: true }
    });

    res.json({ message: "2FA has been enabled!" });
  } catch (err) {
    console.error("Verify 2FA error:", err);
    res.status(500).json({ error: "Failed to verify 2FA" });
  }
});


// POST /auth/disable-2fa
router.post("/disable-2fa", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorSecret: null,
        is2FAEnabled: false,
        require2faLogin: false,
        require2faArm: false,
        requireArmToTrade: false,
      },
    });

    res.json({ message: "2FA has been disabled." });
  } catch (err) {
    console.error("Disable 2FA error:", err);
    res.status(500).json({ error: "Failed to disable 2FA" });
  }
});



// POST /auth/register
router.post("/register", async (req, res) => {
  try {
    const { username, email, password, confirmPassword, agreedToTerms } = req.body;
    // …all your validation + supabase signup…

    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { emailRedirectTo: `${process.env.FRONTEND_URL}/email-confirmed` }
    });
    if (error) return res.status(400).json({ error: error.message });
    const supabaseUser = data.user;

    // Optional: quick pre-check to give a fast error (still race-safe via tx catch)
    const dup = await prisma.user.findUnique({ where: { username } });
    if (dup) return res.status(400).json({ error: "Username already taken." });

    const transaction = await prisma.$transaction(async (tx) => {
      const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
      const now   = Date.now();
      const today = new Date(now).toISOString().slice(0, 10);

      // 1) user
      let user;
      try {
        user = await tx.user.create({
          data: {
            userId: supabaseUser.id,    // external ID (HKDF salt / AAD)
            username,
            email,
            type: "web",
            createdAt: new Date(),
            usageResetAt: new Date(Date.now() + THIRTY_DAYS_MS),
            credits: 0,
            agreedToTermsAt: new Date(),
          },
        });
      } catch (err) {
        if (err.code === "P2002" && err.meta?.target?.includes("username")) {
          const e = new Error("Username already taken.");
          e.status = 400; e.expose = true;
          throw e; // ❗throw, don't res.json() here
        }
        throw err;
      }

      // 2) starter wallet via unprotected service
      const kp        = Keypair.generate();
      const publicKey = kp.publicKey.toBase58();
      const createdWallet = await createUnprotectedWallet({
        prismaClient: tx,
        dbUserId:     user.id,       // FK → User.id
        aadUserId:    user.userId,   // HKDF salt / AAD
        label:        "starter",
        secretKey:    Buffer.from(kp.secretKey),
        publicKey,
      });

      // 3) active wallet + seeds
      await tx.user.update({ where: { id: user.id }, data: { activeWalletId: createdWallet.id }});
      await tx.userPreference.create({ data: { userId: user.id }});
      await tx.portfolioTracker.create({ data: { userId: user.id, startTs: now, lastMonthlyTs: now }});
      await tx.netWorthHistory.create({
        data: { userId: user.id, ts: now, date: today, value: 0, minute: new Date(now).toISOString().slice(0, 16) }
      });
      await tx.netWorthSnapshot.create({
        data: { userId: user.id, ts: now, netWorth: 0, sol: 0, usdc: 0, openPositions: 0 }
      });

      return { user, createdWallet };
    });

    // tokens + cookies + csrf
    const accessToken  = jwt.sign({ id: transaction.user.id, type: "web" }, JWT_SECRET, { expiresIn: "7d" });
    const refreshToken = jwt.sign({ id: transaction.user.id }, JWT_SECRET, { expiresIn: "30d" });
    await prisma.refreshToken.create({ data: { token: refreshToken, userId: transaction.user.id } });

    setAccessCookie(res, accessToken);
    setRefreshCookie(res, refreshToken);
    setCsrfCookie(res, generateCsrfToken());

    return res.json({
      accessToken,
      refreshToken,
      userId: transaction.user.id,
      activeWalletId: transaction.createdWallet.id,
      wallet: {
        id:        transaction.createdWallet.id,
        publicKey: transaction.createdWallet.publicKey,
        label:     transaction.createdWallet.label,
      },
    });
  } catch (err) {
    if (err.expose && err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("Register error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});



router.post("/resend-confirm", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Missing email." });

  // 🔑 tell Supabase which template to resend
  const { error } = await supabase.auth.resend({
    type: "signup",          // <-- the missing piece
    email,
    // options: {
    //   // optional: where the user should land after clicking the link
    //   emailRedirectTo: process.env.EMAIL_REDIRECT_URL || "https://your‑app.com/welcome"
    // }
  });

  if (error) {
    console.error("Resend error:", error.message);
    return res.status(400).json({ error: error.message });
  }

  res.json({ message: "Confirmation email resent." });
});



// POST /auth/login
router.post("/login", validate({ body: loginSchema }), async (req, res) => {
  const { email, username, password, is2FAEnabled } = req.body;

  if (!email && !username) return res.status(400).json({ error: "Missing fields" });
  if (!password) return res.status(400).json({ error: "Password is required" });

  try {
    // Resolve email from username if needed
    let resolvedEmail = email;
    if (!resolvedEmail && username) {
      const userByUsername = await prisma.user.findUnique({
        where: { username }
      });
      if (!userByUsername) {
        return res.status(400).json({ error: "Invalid username." });
      }
      resolvedEmail = userByUsername.email;
    }

    // Supabase login
    const { data, error } = await supabase.auth.signInWithPassword({
      email: resolvedEmail,
      password
    });

    if (error) {
      console.error("Supabase login error:", error.message);
      return res.status(400).json({ error: error.message });
    }

    // Email must be verified
    if (!data.user.email_confirmed_at) {
      return res.status(403).json({
        error: "Email not verified yet.",
        unconfirmed: true
      });
    }

    // Pull our local user with the exact fields the UI needs
    const user = await prisma.user.findUnique({
      where: { userId: data.user.id },
      select: {
        id: true,
        userId: true,
        email: true,
        username: true,
        type: true,
        activeWalletId: true,
        phantomPublicKey: true,
        is2FAEnabled: true,
        require2faLogin: true,
        require2faArm: true,
        requireArmToTrade: true,
        wallets: {
          select: {
            id: true,
            label: true,
            publicKey: true,
            isProtected: true,
            passphraseHint: true,
          }
        }
      }
    });

    if (!user) return res.status(400).json({ error: "User not found in local system." });

    // 2FA gate for login (independent from ARM-only flows)
    if (user.is2FAEnabled && user.require2faLogin) {
      return res.json({
        message: "2FA required",
        twoFARequired: true,
        userId: user.id
      });
    }

    // Issue access + refresh tokens
    const accessToken  = jwt.sign({ id: user.id, type: user.type }, JWT_SECRET, { expiresIn: "15m" });
    const refreshToken = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: "30d" });

    await prisma.refreshToken.create({ data: { token: refreshToken, userId: user.id } });

    // Cookies + CSRF (double-submit)
    setAccessCookie(res, accessToken);
    setRefreshCookie(res, refreshToken);
    {
      const csrfToken = generateCsrfToken();
      setCsrfCookie(res, csrfToken);
    }

    // 🎯 Return full user payload so the frontend can hydrate immediately
    return res.json({
      success: true,
      twoFARequired: false,
      user,              // << includes wallets[].isProtected + activeWalletId
      accessToken,       // for non-browser clients; browsers rely on cookies
      refreshToken
    });
  } catch (err) {
    console.error("🔥 /auth/login error:", err.stack || err);
    return res.status(500).json({ error: "Server error" });
  }
});



// POST /auth/logout
router.post("/logout", authenticate, async (req, res) => {
  const userId = req.user.id;

  try {
    // Remove the user's refresh token from the database
    await prisma.refreshToken.deleteMany({
      where: { userId },
    });

  // Clear cookies via helper (access/refresh + csrf)
  clearAuthCookies(res);
  res.json({ message: "Successfully logged out" });
  } catch (err) {
    console.error("Logout error:", err);
    res.status(500).json({ error: "Failed to log out" });
  }
});


router.post("/forgot-password", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Missing email." });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(200).json({ message: "If that email exists, we've sent a reset link." });

  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 30 * 60 * 1000); // 30 min

  await prisma.user.update({
    where: { email },
    data: {
      passwordResetToken: token,
      passwordResetExpires: expires,
    },
  });

  const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
  await sendPasswordResetEmail(email, resetLink);

  res.json({ message: "If that email exists, we've sent a reset link." });
});

router.post("/reset-password", async (req, res) => {
  try {
    const { token, newPassword, confirmPassword } = req.body;

    if (!token || !newPassword || !confirmPassword) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    // 🔐 Password constraints
    const pwRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*]).{6,}$/;
    if (!pwRegex.test(newPassword)) {
      return res.status(400).json({
        error: "Password must be at least 6 characters, with one uppercase, one number, and one special character."
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: "Passwords do not match." });
    }

    // 🔎 Verify token validity
    const user = await prisma.user.findFirst({
      where: {
        passwordResetToken: token,
        passwordResetExpires: { gt: new Date() },
      },
    });

    if (!user) {
      return res.status(400).json({ error: "Invalid or expired token." });
    }

    // 🔁 Update Supabase password using admin client
    const { error } = await supabaseServer.auth.admin.updateUserById(user.userId, {
      password: newPassword
    });

    if (error) {
      console.error("Supabase reset error:", error.message);
      return res.status(400).json({ error: "Failed to update password." });
    }

    // 🧹 Clear reset token
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: null,
        passwordResetExpires: null,
      },
    });

    res.json({ message: "Password reset successful." });
  } catch (err) {
    console.error("Reset password error:", err);
    res.status(500).json({ error: "Server error" });
  }
});




router.post("/verify-2fa-login", async (req, res) => {
  const { userId, token } = req.body;

  if (!userId || !token) {
    return res.status(400).json({ error: "Missing userId or 2FA token." });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      twoFactorSecret   : true,
      is2FAEnabled      : true,
      recoveryCodes     : true,
      require2faLogin   : true,
      requireArmToTrade : true,
      type              : true
    }
  });

  if (!user || !user.is2FAEnabled) {
    return res.status(400).json({ error: "2FA not enabled for this user." });
  }

  // ✅ First try TOTP
  const verified = speakeasy.totp.verify({
    secret   : user.twoFactorSecret,
    encoding : "base32",
    token
  });

  let ok = verified;

  // ✅ Fallback: check recovery codes
  if (!ok) {
    for (const hashed of user.recoveryCodes) {
      if (await bcrypt.compare(token, hashed)) {
        ok = true;
        // Remove the used recovery code
        await prisma.user.update({
          where: { id: userId },
          data: {
            recoveryCodes: {
              set: user.recoveryCodes.filter((c) => c !== hashed)
            }
          }
        });
        break;
      }
    }
  }

  if (!ok) {
    return res.status(403).json({ error: "Invalid 2FA or recovery code." });
  }

  // ✅ Issue tokens
  const accessToken  = jwt.sign({ id: userId, type: user.type }, JWT_SECRET, { expiresIn: "7d" });
  const refreshToken = jwt.sign({ id: userId },                JWT_SECRET, { expiresIn: "30d" });

  await prisma.refreshToken.create({
    data: { token: refreshToken, userId }
  });

  // Set cookies via helpers + CSRF
  setAccessCookie(res, accessToken);
  setRefreshCookie(res, refreshToken);
  {
    const csrfToken = generateCsrfToken();
    setCsrfCookie(res, csrfToken);
  }

  // ✅ ⬇⬇ Return new toggles to frontend
  res.json({
    accessToken,
    refreshToken,
    userId,
    require2faLogin   : user.require2faLogin,
    requireArmToTrade : user.requireArmToTrade
  });
});

router.get("/csrf", (req, res) => {
  let token = req.cookies?.[CSRF_COOKIE];
  if (!token) {
    token = generateCsrfToken();
    setCsrfCookie(res, token);
  }
  res.json({ csrfToken: token });
});


router.post("/refresh", validate({ body: refreshSchema }), async (req, res) => {
  // Accept refresh tokens either from the body or from the cookie for convenience
  const tokenFromBody = req.body.refreshToken;
  const tokenFromCookie = (req.cookies && (req.cookies["__Host-refresh_token"] || req.cookies["refresh_token"])) || null; // ← added __Host fallback
  const oldToken = tokenFromBody || tokenFromCookie;

  if (!oldToken) {
    return res.status(401).json({ error: "Refresh token is required" });
  }

  try {
    // Verify signature and extract payload. We expect the payload to contain an id field.
    const decoded = jwt.verify(oldToken, JWT_SECRET);
    const userId = decoded.id || decoded.userId;
    if (!userId) {
      throw new Error("Invalid refresh token payload");
    }

    // Ensure token exists in the database (i.e. not blacklisted)
    const exists = await prisma.refreshToken.findUnique({ where: { token: oldToken } });
    if (!exists) {
      return res.status(401).json({ error: "Invalid or expired refresh token" });
    }

    // Remove the old token so it cannot be reused (rotation)
    await prisma.refreshToken.deleteMany({ where: { token: oldToken } });

    // Issue new tokens
    const newAccessToken  = jwt.sign({ id: userId, type: decoded.type }, JWT_SECRET, { expiresIn: "15m" });
    const newRefreshToken = jwt.sign({ id: userId },              JWT_SECRET, { expiresIn: "30d" });

    // Persist new refresh token and set cookies
    await prisma.refreshToken.create({ data: { token: newRefreshToken, userId } });
    setAccessCookie(res, newAccessToken);
    setRefreshCookie(res, newRefreshToken);

    // Rotate CSRF token as well
    {
      const csrfToken = generateCsrfToken();
      setCsrfCookie(res, csrfToken);
    }

    return res.json({ accessToken: newAccessToken, refreshToken: newRefreshToken });
  } catch (err) {
    console.error("Refresh error:", err.message);
    return res.status(401).json({ error: "Invalid or expired refresh token" });
  }
});


// Generate a new wallet (envelope-encrypted, no extra side-effects)
// Generate a new wallet (envelope-encrypted, no extra side-effects)
router.post("/wallet/generate", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { label } = req.body;

    if (label) {
      const dup = await prisma.wallet.findFirst({ where: { userId, label } });
      if (dup) return res.status(400).json({ error: "Label already exists." });
    }

    // pull external userId (AAD for HKDF)
    const user = await prisma.user.findUnique({
      where : { id: userId },
      select: { id: true, userId: true, activeWalletId: true }
    });
    if (!user) return res.status(404).json({ error: "User not found." });

    // create keypair and persist via service
    const wallet    = Keypair.generate();
    const publicKey = wallet.publicKey.toBase58();

    const newWallet = await createUnprotectedWallet({
      prismaClient: prisma,
      dbUserId:     user.id,                   // FK → User.id
      aadUserId:    user.userId,               // HKDF salt / AAD identifier
      label:        label || "New Wallet",
      secretKey:    Buffer.from(wallet.secretKey),
      publicKey,
    });

    // ensure activeWalletId set at least once
    let activeWalletId = user.activeWalletId;
    if (!activeWalletId) {
      await prisma.user.update({ where: { id: userId }, data: { activeWalletId: newWallet.id } });
      activeWalletId = newWallet.id;
    }

    return res.json({ wallet: newWallet, activeWalletId });
  } catch (err) {
    console.error("🔥 Wallet generate error:", err.stack || err);
    return res.status(500).json({ error: "Failed to generate wallet." });
  }
});




// Set active wallet for the current user
// Set active wallet for the current user




router.get("/wallets/export/:walletId", authenticate, check2FA, async (req, res) => {
  const { walletId } = req.params;
  const userId = req.user.id;

  console.log(`Received request to export wallet with ID: ${walletId} for user: ${userId}`);  // Log incoming request

  try {
    // Find the wallet by ID
    console.log("Finding wallet in the database...");  // Log database search
    const wallet = await prisma.wallet.findUnique({
      where: { id: parseInt(walletId, 10), userId }, // Ensure walletId is parsed as an integer
    });

    if (!wallet) {
      console.error(`Wallet with ID: ${walletId} not found for user: ${userId}`);  // Log if wallet is not found
      return res.status(404).json({ error: "Wallet not found." });
    }

    // Determine which key material is available.  Legacy wallets store an
    // encrypted privateKey string, whereas newer wallets use an envelope in
    // the `encrypted` field.  We cannot derive the raw secret key from an
    // envelope without the user entering a passphrase and arming the wallet.
    if (wallet.privateKey) {
      console.log("Wallet found, decrypting private key...");
      try {
        const decryptedPrivateKey = decrypt(wallet.privateKey);
        console.log("Successfully decrypted private key.");
        // Return the decrypted base58 string to the caller
        return res.json({ privateKey: decryptedPrivateKey.toString() });
      } catch (err) {
        console.error("Error decrypting private key:", err);
        return res.status(500).json({ error: "Failed to decrypt wallet." });
      }
    }

    // If the wallet has an envelope instead of a legacy privateKey, instruct
    // the user to arm the wallet through the appropriate session API.
    if (wallet.encrypted) {
      return res.status(401).json({ error: "Cannot export a protected wallet without an armed session." });
    }

    // Fallback when neither field is present
    return res.status(400).json({ error: "Wallet has no exportable key material." });
  } catch (err) {
    console.error("Error while exporting wallet:", err);  // Log error details
    res.status(500).json({ error: "Failed to export wallet." });
  }
});


// Delete wallet from the database
// DELETE /wallets/delete/:walletId
router.delete("/wallets/delete/:walletId", authenticate, async (req, res) => {
  const { walletId } = req.params;
  const userId = req.user.id;
  const idInt   = parseInt(walletId, 10);              // 🔑 reuse this everywhere

  console.log(`↘️  DELETE wallet ${idInt} for user ${userId}`);

  try {
    // 1. Verify wallet exists and belongs to user
    const wallet = await prisma.wallet.findUnique({
      where: { id: idInt, userId },
    });
    if (!wallet) {
      console.log("❌ Wallet not found");
      return res.status(404).json({ error: "Wallet not found." });
    }

    // 2. Cascade-delete refresh tokens & trades
    await prisma.refreshToken.deleteMany({ where: { walletId: idInt } });
    await prisma.trade.deleteMany({        where: { walletId: idInt } });
    await prisma.closedTrade.deleteMany({  where: { walletId: idInt } });

    // 3. Delete the wallet itself
    await prisma.wallet.delete({ where: { id: idInt } });

    // 4. 🔥  If it was the active wallet, pick a fallback (or null)
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user.activeWalletId === idInt) {
      const fallback = await prisma.wallet.findFirst({
        where: { userId, id: { not: idInt } },
        select: { id: true },
      });
      await prisma.user.update({
        where: { id: userId },
        data: { activeWalletId: fallback ? fallback.id : null },
      });
      console.log(
        `🪄 Re-assigned activeWalletId →`,
        fallback ? fallback.id : "NULL (no wallets left)"
      );
    }

    console.log(`✅ Wallet ${idInt} deleted`);
    res.json({ message: "Wallet deleted successfully." });
  } catch (err) {
    console.error("🔥 Delete wallet error:", err);
    res.status(500).json({ error: "Failed to delete wallet." });
  }
});


router.get("/tokens/by-wallet", authenticate, async (req, res) => {
  try {
    const { walletId } = req.query;
    if (!walletId) {
      return res.status(400).json({ error: "walletId query param required" });
    }

    const dbWallet = await prisma.wallet.findUnique({
      where: { id: parseInt(walletId, 10), userId: req.user.id },
    });

    if (!dbWallet) {
      console.error(`❌ Wallet not found for user ${req.user.id} and walletId ${walletId}`);
      return res.status(404).json({ error: "Wallet not found" });
    }

    // Use legacy privateKey if present.  For envelope‑encrypted wallets we
    // require an armed session; expose an error if not available.
    let owner;
    if (dbWallet.privateKey) {
      try {
        const decryptedPrivateKey = decrypt(dbWallet.privateKey);
        const secretKey = bs58.decode(decryptedPrivateKey.toString().trim());
        const keypair = Keypair.fromSecretKey(secretKey);
        owner = keypair.publicKey;
      } catch (err) {
        console.error('Error decrypting wallet for token lookup:', err.message);
        return res.status(500).json({ error: 'Failed to decrypt wallet.' });
      }
    } else if (dbWallet.encrypted) {
      return res.status(401).json({ error: 'Protected or unarmed wallet. Please arm the wallet before fetching tokens.' });
    } else {
      return res.status(400).json({ error: 'Wallet has no usable key material.' });
    }

    const ownerPkStr = owner.toBase58();
    console.log(`🔍 Fetching tokens for wallet ${walletId} owner ${ownerPkStr}`);

    const conn = new Connection(process.env.SOLANA_RPC_URL, "confirmed");

    const { value } = await conn.getParsedTokenAccountsByOwner(
      owner,
      { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") }
    );

    const tokens = value
      .map(a => a.account.data.parsed.info)
      .filter(i => +i.tokenAmount.uiAmount > 0.1)
      .map(i => ({
        mint: i.mint,
        amount: +i.tokenAmount.uiAmount,
        decimals: +i.tokenAmount.decimals,
      }));

    const SOL_MINT = "So11111111111111111111111111111111111111112";
    const solLamports = await conn.getBalance(owner);
    if (solLamports > 0) {
      tokens.push({
        mint: SOL_MINT,
        amount: solLamports / 1e9,
        decimals: 9,
      });
    }

    // 👇 Add enrichment logic here
    const enriched = tokens.map(t => ({
      ...t,
      name: t.mint === SOL_MINT ? "Solana" : t.mint,
      symbol: t.mint === SOL_MINT ? "SOL" : "",
      logo: "",
      price: 0,
      valueUsd: 0,
    }));

    console.log(`✅ Returning ${enriched.length} tokens`);

    res.json(enriched);
  } catch (err) {
    console.error("🔥 Error fetching tokens:", err.stack || err.message);
    res.status(500).json({ error: "Server error" });
  }
});



router.post("/wallet/set-active", authenticate, async (req, res) => {
  // const walletId = parseInt(req.body.walletId, 10);
  const walletId = Number(req.body.walletId);

    // Bail out if it’s not a positive integer
  if (!Number.isInteger(walletId) || walletId <= 0) {
    console.log("❌ Invalid walletId:", req.body.walletId);
    return res.status(400).json({ error: "Invalid walletId." });
  }


  const userId = req.user.id;

  console.log("📥 POST /wallet/set-active called by user:", userId, "with walletId:", walletId);

  if (!walletId) {
    console.log("❌ Missing walletId in request body.");
    return res.status(400).json({ error: "Missing walletId." });
  }

  try {
    console.log("🔍 Looking for wallet with ID:", walletId, "owned by user:", userId);
    const wallet = await prisma.wallet.findFirst({
      where: { id: walletId, userId },
    });

    if (!wallet) {
      console.log("❌ Wallet not found: walletId:", walletId, "userId:", userId);
      return res.status(404).json({ error: "Wallet not found." });
    }

    console.log("✅ Wallet found. Proceeding to update user.activeWalletId to:", walletId);
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { activeWalletId: walletId },
    });

    console.log("✅ DB updated user:", updatedUser);

    console.log("✅ Successfully set active wallet:", walletId, "for user:", userId);
    // return res.json({ message: "Active wallet updated.", wallet });
    return res.json({ activeWalletId: walletId });
  } catch (err) {
    console.error("🔥 Unexpected error in /wallet/set-active:", err);
    return res.status(500).json({ error: "Failed to set active wallet." });
  }
});



router.get("/wallet/active", authenticate, async (req, res) => {
  const userId = req.user.id;
  console.log("📥 GET /wallet/active called by user:", userId);

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { activeWalletId: true },
    });

    if (!user) {
      console.log("❌ User not found in DB:", userId);
      return res.status(404).json({ error: "User not found." });
    }

    if (!user.activeWalletId) {
      console.log("⚠️ No active wallet set for user:", userId);
      return res.status(404).json({ error: "No active wallet set." });
    }

    console.log("✅ Active wallet retrieved for user:", userId, "walletId:", user.activeWalletId);
    return res.json({ activeWalletId: user.activeWalletId });
  } catch (err) {
    console.error("🔥 Unexpected error in /wallet/active:", err);
    return res.status(500).json({ error: "Failed to fetch active wallet." });
  }
});



// ─────────────────────────────────────────────
//  POST /auth/convert-supabase
// ─────────────────────────────────────────────
router.post("/convert-supabase", async (req, res) => {
  const cryptoWeb = require("node:crypto").webcrypto;
  if (!globalThis.crypto) globalThis.crypto = cryptoWeb;
  const { supabaseToken } = req.body;
  if (!supabaseToken) {
    console.error("🟥 No supabaseToken provided in request body");
    return res.status(400).json({ error: "Missing Supabase token" });
  }

  console.log("🟨 Received Supabase Token (first 120 chars):");
  console.log(supabaseToken.slice(0, 120));
  console.log("🔍 JWT Decode (Header & Payload) pre-verification:");

  try {
    const [headerB64, payloadB64] = supabaseToken.split(".");
    const headerRaw = Buffer.from(headerB64, "base64").toString("utf8");
    const payloadRaw = Buffer.from(payloadB64, "base64").toString("utf8");

    console.log("🧠 Header:", headerRaw);
    console.log("📦 Payload:", payloadRaw);
  } catch (e) {
    console.error("⚠️ Failed to decode token parts before verification:", e.message);
  }

  console.log("🔧 Verifying token with env:");
  console.log("🔑 SUPABASE_JWT_SECRET:", process.env.SUPABASE_JWT_SECRET?.slice(0, 10) + "...[REDACTED]");
  console.log("🌐 SUPABASE_URL:", process.env.SUPABASE_URL);

  let payload;
  try {
    const { jwtVerify } = await import("jose");
    const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET);

    const verified = await jwtVerify(supabaseToken, secret, {
      issuer: `${process.env.SUPABASE_URL}/auth/v1`,
      audience: "authenticated",
    });

    payload = verified.payload;
    console.log("✅ JWT verified successfully");
    console.log("👤 Payload.sub:", payload.sub);
    console.log("🌍 Payload.iss:", payload.iss);
    console.log("🎯 Payload.aud:", payload.aud);
    console.log("🕒 Exp:", payload.exp, "| iat:", payload.iat);
  } catch (err) {
    console.error("🟥 [convert-supabase] JWT verify failed:", err.message);
    return res.status(401).json({ error: "Invalid Supabase token" });
  }

  const supabaseUid = payload.sub;
  if (!supabaseUid) {
    console.error("🟥 JWT payload missing `sub` field");
    return res.status(401).json({ error: "Invalid Supabase token" });
  }

  console.log("🔎 Looking up local user by userId:", supabaseUid);

  const localUser = await prisma.user.findUnique({
    where: { userId: supabaseUid },
  });

  if (!localUser) {
    console.warn("🟨 Local user not found for Supabase UID:", supabaseUid);
    return res.status(404).json({ error: "User not found" });
  }

  console.log("✅ Local user found:", localUser.id, "| type:", localUser.type);

  const jwtLib = require("jsonwebtoken");

  const accessToken = jwtLib.sign(
    { id: localUser.id, type: localUser.type || "web" },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

  const refreshToken = jwtLib.sign(
    { id: localUser.id },
    process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );

  console.log("🧾 Created access & refresh tokens");

  await prisma.refreshToken.create({
    data: { token: refreshToken, userId: localUser.id },
  });

  console.log("📦 Saved refresh token to DB");

  // Set cookies via helpers + CSRF
  setAccessCookie(res, accessToken);
  setRefreshCookie(res, refreshToken);
  {
    const csrfToken = generateCsrfToken();
    setCsrfCookie(res, csrfToken);
  }

  res.json({
    accessToken,
    refreshToken,
    userId: localUser.id,
    activeWallet: localUser.activeWalletId || null,
  });
});

module.exports = router;