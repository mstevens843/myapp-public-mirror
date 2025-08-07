require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const express = require("express");
const router = express.Router();
const { Connection, Keypair, PublicKey, Transaction, SystemProgram } = require("@solana/web3.js");
const path = require("path");
const fs = require("fs");
const bs58 = require("bs58");
const { getCurrentWallet, loadWalletsFromDb } = require("../services/utils/wallet/walletManager");
const { getFullNetWorthApp } = require("../utils/getFullNetworth");
// const loadSettings  = require("../telegram/utils/tpSlStorage").loadSettings; // 
const getWalletTokensWithMeta = require("../services/strategies/paid_api/getWalletTokensWithMeta"); // wallet-level helper
const axios = require("axios");
const getTokenPrice = require("../services/strategies/paid_api/getTokenPrice"); // 🆕
const { getTokenName }  = require("../services/utils/analytics/getTokenName");
const pLimit = require("p-limit");
const limit = pLimit(4);  
const connection = new Connection(process.env.SOLANA_RPC_URL);
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const authenticate = require("../middleware/requireAuth")
const { encrypt, decrypt } = require("../middleware/auth/encryption");
const check2FA = require("../middleware/auth/check2FA");
const { getTokenAccountsAndInfo, getMintDecimals } = require("../utils/tokenAccounts");
const { encryptPrivateKey } = require("../armEncryption/envelopeCrypto");   // 👈 NEW
const crypto  = require("crypto");    


const MIN_VALUE_USD = 0.50;
const EXCLUDE_MINTS = new Set([
  "So11111111111111111111111111111111111111112", // wSOL
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCER9SADJdTjaiCviCqiSBamEn3DcSjh3rCt"  // USDC legacy
]);

const MIN_IMPORT_USD = 0.25;                              // 💰 dust bar


const injectUntracked = async (userId, walletIds = null) => {
  let wrote = false;

  const wallets = await prisma.wallet.findMany({
    where : { userId, ...(walletIds ? { id: { in: walletIds } } : {}) },
    select: { id: true, label: true, publicKey: true }
  });

  for (const w of wallets) {
    const balances = await getTokenAccountsAndInfo(new PublicKey(w.publicKey));

    for (const { mint, amount } of balances) {
      if (amount <= 0 || EXCLUDE_MINTS.has(mint)) continue;

      const decimals = await getMintDecimals(mint).catch(() => 0);
      const price    = await getTokenPrice(userId, mint).catch(() => 0);
      const valueUsd = (Number(amount) / 10 ** decimals) * price;
      if (valueUsd <= MIN_IMPORT_USD) continue; // skip dust

      const rawBalance = BigInt(Math.floor(Number(amount) * 10 ** decimals));

      const trackedRows = await prisma.trade.findMany({
        where  : { walletId: w.id, mint, exitedAt: null },
        select : { outAmount: true, closedOutAmount: true }
      });

      const tracked = trackedRows.reduce((s, r) => s + (r.outAmount - (r.closedOutAmount ?? 0n)), 0n);
      if (tracked >= rawBalance) continue;

      const delta = rawBalance - tracked;
      if (delta === 0n) continue;

      await prisma.trade.create({
        data: {
          mint,
          tokenName       : await getTokenName(mint).catch(() => null),
          entryPrice      : null,
          entryPriceUSD   : null,
          inAmount        : 0n,
          outAmount       : delta,
          closedOutAmount : 0n,
          strategy        : "unknown",
          walletLabel     : w.label,
          unit            : "token",
          decimals,
          type            : "import",
          side            : "import",
          botId           : "import",
          walletId        : w.id
        }
      });

      wrote = true;
      console.log(`🆕 injectUntracked → ${mint} (${w.label}) Δ ${delta}`);
    }
  }
  return wrote;
};

// ✅ POST /api/wallets/balance
// Body: { label: "default" }
router.post("/balance", async (req, res) => {
  try {
    const { walletLabel, walletId, pubkey } = req.body;

    /* ── new: fetch by pubkey directly ── */
    if (pubkey) {
      const balanceLamports = await connection.getBalance(new PublicKey(pubkey));
      return res.json({ balance: (balanceLamports / 1e9).toFixed(3) });
    }

    /* fallback: older ‘label points to file’ method */
    if (!label) {
      return res.status(400).json({ error: "Provide label or pubkey." });
    }

    const walletPath = path.join(__dirname, "..", "wallets", label);
    if (!fs.existsSync(walletPath)) {
      return res.status(404).json({ error: `Wallet file '${label}' not found.` });
    }

    const fileContent = fs.readFileSync(walletPath, "utf8").trim();
    let secretKey;

    try {
      // Try JSON format first (Uint8Array)
      const parsed = JSON.parse(fileContent);
      if (!Array.isArray(parsed)) throw new Error();
      secretKey = Uint8Array.from(parsed);
    } catch {
      // Fallback to base58
      try {
        const decoded = bs58.decode(fileContent);
        if (decoded.length !== 64) throw new Error("Invalid base58 key length");
        secretKey = Uint8Array.from(decoded);
      } catch (decodeErr) {
        return res.status(400).json({ error: "Wallet file has invalid format" });
      }
    }

    const keypair = Keypair.fromSecretKey(secretKey);
    const balanceLamports = await connection.getBalance(keypair.publicKey);
    const balanceSol = balanceLamports / 1e9;

  /* -------- add price + USD value -------- */
  const SOL_MINT = "So11111111111111111111111111111111111111112";
  const solPrice = await getTokenPrice(req.user.id, SOL_MINT);         // cached ⇒ fast
  const valueUsd = +(balanceSol * solPrice).toFixed(2);

  res.json({
    balance : +balanceSol.toFixed(3),
    price   : solPrice,          // ← USD per SOL
    valueUsd,                    // ← wallet’s SOL in USD
  });
 } catch (err) {
    console.error("Balance check failed:", err.message);
    res.status(500).json({ error: err.message || "Failed to fetch balance" });
  }
});



// ✅Used for old fetch with the wallets/default.txt file 
// router.post("/networth", authenticate, async (req, res) => {
//   try {
//     const userId = req.user.id;

//     const wallet = await prisma.wallet.findFirst({
//       where: { userId },
//     });

//     if (!wallet) {
//       return res.status(404).json({ error: "No wallet found for this user." });
//     }

//     const result = await getFullNetWorthApp(wallet.publicKey);
//     res.json(result);

//   } catch (err) {
//     console.error("❌ Networth error:", err);
//     res.status(500).json({ error: "Failed to fetch wallet net worth" });
//   }
// });

// GET  /api/wallets/networth   ← idempotent, no body required
router.get("/networth", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    /* 1️⃣ Pull the active-wallet id that was just saved via /wallet/set-active */
    const { activeWalletId } = await prisma.user.findUnique({
      where:  { id: userId },
      select: { activeWalletId: true },
    });

    if (!activeWalletId) {
      return res.status(404).json({ error: "No active wallet set for this user." });
    }

    /* 2️⃣ Grab that wallet’s publicKey */
    const { publicKey } = await prisma.wallet.findUnique({
      where:  { id: activeWalletId },
      select: { publicKey: true },
    });

    if (!publicKey) {
      return res.status(404).json({ error: "Active wallet not found." });
    }

    /* 3️⃣ Compute & return net worth */
    const result = await getFullNetWorthApp(publicKey, userId);
    return res.json(result);
  } catch (err) {
    console.error("❌ Net-worth error:", err);
    return res.status(500).json({ error: "Failed to fetch wallet net worth" });
  }
});


// GET /api/tpsl/:wallet
router.get("/tpsl/:wallet", (req, res) => {
  const { wallet } = req.params;
  // const all = loadSettings();

  for (const userId in all) {
    for (const mint in all[userId]) {
      if (all[userId][mint].wallet === wallet || all[userId][mint].walletLabel === wallet) {
        return res.json(all[userId]);
      }
    }
  }

  res.status(404).json({ error: "No TP/SL config found for this wallet." });
});


// ─── GET /wallet/tokens?wallet=PUBKEY ───
router.get("/tokens", async (req, res) => {
  try {
    const owner   = new PublicKey(req.query.wallet);
    const conn    = new Connection(process.env.SOLANA_RPC_URL, "confirmed");

    const { value } = await conn.getParsedTokenAccountsByOwner(
      owner,
      { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") }
    );

    const tokens = value
      .map(acc => acc.account.data.parsed.info)
      .filter(i   => +i.tokenAmount.uiAmount > 0)          // skip dust
      .map(i => ({
        mint     : i.mint,
        amount   : +i.tokenAmount.uiAmount,
        decimals : +i.tokenAmount.decimals,
      }));

    res.json(tokens);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});




router.get("/tokens/default", async (req, res) => {
  try {
    const { current } = require("../services/utils/wallet/walletManager");
    const conn        = new Connection(process.env.SOLANA_RPC_URL, "confirmed");
    const owner       = current().publicKey;
    /**
     * - const { current } = require("../services/utils/wallet/walletManager");
- const owner = current().publicKey;
    + const { activeWalletId } = await prisma.user.findUnique({ … });
+ const { publicKey } = await prisma.wallet.findUnique({ where:{ id: activeWalletId }});
+ const owner = new PublicKey(publicKey);

     */

    // Fetch tokens from wallet
    const { value } = await conn.getParsedTokenAccountsByOwner(
      owner,
      { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") }
    );

    const tokens = value
      .map(a => a.account.data.parsed.info)
      .filter(i => +i.tokenAmount.uiAmount > 0.1)
      .map(i => ({
        mint     : i.mint,
        amount   : +i.tokenAmount.uiAmount,
        decimals : +i.tokenAmount.decimals,
      }));

      /* ── inject native SOL balance ── */
      const SOL_MINT = "So11111111111111111111111111111111111111112";
      const solLamports = await conn.getBalance(owner);
      if (solLamports > 0) {
        tokens.push({
          mint     : SOL_MINT,
          amount   : solLamports / 1e9,
          decimals : 9,
        });
      }
      

    // 🔥 Fetch names/symbols/logo/prices using Birdeye wallet portfolio endpoint
    let metaMap = {};
          /* pre-seed meta so it always has a name/icon */
      metaMap[SOL_MINT] = {
        name   : "Solana",
        symbol : "SOL",
        logo   : "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/info/logo.png",
        price  : 0,
      };

    try {
      const { data } = await axios.get("https://public-api.birdeye.so/v1/wallet/token_list", {
        params: { wallet: owner.toBase58() },
        headers: {
          "x-chain": "solana",
          "X-API-KEY": process.env.BIRDEYE_API_KEY,
        },
        timeout: 5000,
      });

      const items = data?.data?.items || [];
      for (const item of items) {
        metaMap[item.address] = {
          name: item.name,
          symbol: item.symbol,
          logo: item.logoURI,
          price: item.priceUsd,
        };
      }
    } catch (err) {
      console.warn("❌ Birdeye wallet portfolio fetch failed:", err.response?.status || err.message);
    }
    /* ❸ Same per-token fallback used above */
    const unresolved = tokens.filter(t => !metaMap[t.mint]?.price).map(t => t.mint);
    await Promise.all(unresolved.map(mint =>
      limit(async () => {
        try {
          const { data } = await axios.get("https://public-api.birdeye.so/defi/price", {
            params  : { address: mint, ui_amount_mode: "raw" },
            headers : { "x-chain":"solana", "X-API-KEY": process.env.BIRDEYE_API_KEY },
            timeout : 3000,
          });
          const p = data?.data?.value ?? 0;
          if (p > 0) metaMap[mint] = { ...(metaMap[mint] || {}), price: p };
        } catch {/* ignore */ }
      })
    ));

    // Attach name + symbol fallback
   const enriched = tokens
      .map(t => {
        const price = metaMap[t.mint]?.price || 0;
        return {
          ...t,
          name  : metaMap[t.mint]?.name   || `${t.mint.slice(0,4)}…${t.mint.slice(-4)}`,
          symbol: metaMap[t.mint]?.symbol || "",
          logo  : metaMap[t.mint]?.logo   || "",
          price,
          valueUsd: t.amount * price,
        };
      })
      .filter(t =>
        t.mint === SOL_MINT || (t.price > 0 && t.valueUsd >= MIN_VALUE_USD)
     )
      .sort((a, b) => b.valueUsd - a.valueUsd);

    res.json(enriched);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});


router.get("/tokens/default-detailed", async (req, res) => {
  try {
    const { current } = require("../services/utils/wallet/walletManager");
    const conn        = new Connection(process.env.SOLANA_RPC_URL, "confirmed");
    const owner       = current().publicKey;

    // Fetch tokens from wallet
    const { value } = await conn.getParsedTokenAccountsByOwner(
      owner,
      { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") }
    );

    const tokens = value
      .map(a => a.account.data.parsed.info)
      .filter(i => +i.tokenAmount.uiAmount > 0.1)
      .map(i => ({
        mint     : i.mint,
        amount   : +i.tokenAmount.uiAmount,
        decimals : +i.tokenAmount.decimals,
      }));

      /* ── inject native SOL balance ── */
      const SOL_MINT = "So11111111111111111111111111111111111111112";
      const solLamports = await conn.getBalance(owner);
      if (solLamports > 0) {
        tokens.push({
          mint     : SOL_MINT,
          amount   : solLamports / 1e9,
          decimals : 9,
        });
      }
      

    // 🔥 Fetch names/symbols/logo/prices using Birdeye wallet portfolio endpoint
    let metaMap = {};
          /* pre-seed meta so it always has a name/icon */
      metaMap[SOL_MINT] = {
        name   : "Solana",
        symbol : "SOL",
        logo   : "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/info/logo.png",
        price  : 0,
      };

    try {
      const { data } = await axios.get("https://public-api.birdeye.so/v1/wallet/token_list", {
        params: { wallet: owner.toBase58() },
        headers: {
          "x-chain": "solana",
          "X-API-KEY": process.env.BIRDEYE_API_KEY,
        },
        timeout: 5000,
      });

      const items = data?.data?.items || [];
      for (const item of items) {
        metaMap[item.address] = {
          name: item.name,
          symbol: item.symbol,
          logo: item.logoURI,
          price: item.priceUsd,
        };
      }
    } catch (err) {
      console.warn("❌ Birdeye wallet portfolio fetch failed:", err.response?.status || err.message);
    }
    /* ❸ Same per-token fallback used above */
    const unresolved = tokens.filter(t => !metaMap[t.mint]?.price).map(t => t.mint);
    await Promise.all(unresolved.map(mint =>
      limit(async () => {
        try {
          const { data } = await axios.get("https://public-api.birdeye.so/defi/price", {
            params  : { address: mint, ui_amount_mode: "raw" },
            headers : { "x-chain":"solana", "X-API-KEY": process.env.BIRDEYE_API_KEY },
            timeout : 3000,
          });
          const p = data?.data?.value ?? 0;
          if (p > 0) metaMap[mint] = { ...(metaMap[mint] || {}), price: p };
        } catch {/* ignore */ }
      })
    ));

    // Attach name + symbol fallback
   const enriched = tokens
      .map(t => {
        const price = metaMap[t.mint]?.price || 0;
        return {
          ...t,
          name  : metaMap[t.mint]?.name   || `${t.mint.slice(0,4)}…${t.mint.slice(-4)}`,
          symbol: metaMap[t.mint]?.symbol || "",
          logo  : metaMap[t.mint]?.logo   || "",
          price,
          valueUsd: t.amount * price,
        };
      })
      .filter(t =>
        t.mint === SOL_MINT || (t.price > 0 && t.valueUsd >= MIN_VALUE_USD)
     )
      .sort((a, b) => b.valueUsd - a.valueUsd);

    res.json(enriched);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});




// get token name -> frontend
router.post("/token-meta", async (req, res) => {
  try {
    const mints = req.body.mints;
    if (!Array.isArray(mints) || mints.length === 0) {
      return res.status(400).json({ error: "Must provide array of mints" });
    }

    const result = await getWalletTokensWithMeta(mints);
    res.json(result);
  } catch (err) {
    console.error("❌ token-meta route failed:", err.message);
    res.status(500).json({ error: err.message || "Failed to fetch metadata" });
  }
});



// grab wallet from default.txt for rotation bot list
router.get("/labels", (req, res) => {
  /* the multi-wallet loader you already have in
     backend/services/utils/wallet/walletManager.js
     puts every keypair into wm.all()
     and keeps their order. */
 (async () => {
    const wm        = require("../services/utils/wallet/walletManager");
    const wallets   = wm.all();

    // 🔥 one SOL price fetch (cached 30 s)
    const { getSolPrice, SOL_MINT } = require("../services/strategies/paid_api/getTokenPrice");
    const solPrice = await getSolPrice();                // ≤ 1 Birdeye hit

    /* fetch balances in parallel (4-concurrent limiter handy) */
    const pLimit    = require("p-limit");
    const limit     = pLimit(4);
    const connection = new (require("@solana/web3.js").Connection)(process.env.SOLANA_RPC_URL);

    const enriched = await Promise.all(wallets.map((kp, i) =>
      limit(async () => {
        const balLamports = await connection.getBalance(kp.publicKey);
        const balanceSol  = balLamports / 1e9;
        return {
          label   : `wallet-${i + 1}`,
          pubkey  : kp.publicKey.toBase58(),
          balance : +balanceSol.toFixed(3),
          price   : solPrice,
          value   : +(balanceSol * solPrice).toFixed(2),
        };
      })
    ));

    res.json(enriched);
  })().catch(e => {
    console.error("labels route error:", e);
    res.status(500).json({ error: "Failed to load wallet labels" });
  });
 });



// GET /api/wallets/tokens/by-label?label=wallet-2
// Route for rotation bot to get multiple wallets. 
router.get("/tokens/by-label", async (req, res) => {
  try {
    const label = req.query.label;
    if (!label) {
      return res.status(400).json({ error: "Missing ?label" });
    }

    const wm     = require("../services/utils/wallet/walletManager");
    const allKPs = wm.all(); // every loaded keypair
    const idx    = allKPs.findIndex((_, i) => `wallet-${i + 1}` === label);
    if (idx === -1) {
      return res.status(404).json({ error: "Wallet label not found" });
    }

    const owner = allKPs[idx].publicKey;

    // Already enriched with name/symbol/logo
    const tokens = await getWalletTokensWithMeta(owner.toBase58());

    // Attach price + valueUsd to each token
    await Promise.all(
      tokens.map(async (t) => {
        const price = await getTokenPrice(req.user.id, t.mint);
        t.price = price;
        t.valueUsd = +(t.amount * price).toFixed(2);
      })
    );

    res.json(tokens);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});



// POST /api/wallets/validate-mint  { mint: "..." }
// used to validate custom mints added to rotation bot. 
router.post("/validate-mint", async (req, res) => {
  const { mint } = req.body || {};
  const isValid = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint || "");
  if (!isValid) return res.status(400).json({ ok:false, reason:"format" });

  try {
    const getTokenShortTermChange =
      require("../services/strategies/paid_api/getTokenShortTermChanges");

    const d = await getTokenShortTermChange(null, mint, "5m", "1h");
    const change = d?.priceChange5m ?? d?.priceChange1m ?? null;
    if (change === null) {
      return res.status(404).json({ ok:false, reason:"no-data" });
    }
    return res.json({ ok:true, symbol:d.symbol || "", name:d.name || "" });
  } catch (err) {
    console.error("validate-mint:", err.message);
    return res.status(500).json({ ok:false, reason:"api" });
  }
});





// FOR NEW AUTH SYSTEM SAVE WALLET HIDE KEY
router.post("/import-wallet", authenticate, async (req, res) => {
  const { label, privateKey } = req.body;
  const userId = req.user.id;

  console.log("🛂 Authenticated user:", userId);
  console.log("📩 Request body:", { label, privateKey: privateKey?.slice(0, 6) + "..." });

  if (!label || !privateKey)
    return res.status(400).json({ error: "Missing label or privateKey." });

  try {
    /* 1️⃣  Decode the base58 secret key */
    let secretKey;
    try {
      secretKey = bs58.decode(privateKey.trim());
      console.log("🔑 Decoded secretKey length:", secretKey.length);
    } catch (e) {
      return res.status(400).json({ error: "Invalid base58 private key." });
    }
    if (secretKey.length !== 64)
      return res.status(400).json({ error: "Key must be 64-byte ed25519 secret." });

    const keypair   = Keypair.fromSecretKey(secretKey);
    const publicKey = keypair.publicKey.toBase58();
    console.log("🧾 Public key derived:", publicKey);

    /* 2️⃣  Duplicate checks */
    if (await prisma.wallet.findFirst({ where: { userId, publicKey } }))
      return res.status(400).json({ error: "Wallet already saved." });

    if (await prisma.wallet.findFirst({ where: { userId, label } }))
      return res.status(400).json({ error: "Label already exists." });

    /* 3️⃣  Envelope-encrypt the private key immediately */
    const tempPass = crypto.randomBytes(16).toString("hex");   // user will set real pass on first arm
    const envelope = await encryptPrivateKey(Buffer.from(secretKey), {
      passphrase : tempPass,
      aad        : `user:${userId}:wallet:TBD`
    });

    /* 4️⃣  Save ONLY the envelope (JSON) — no plaintext, no legacy string */
    const wallet = await prisma.wallet.create({
      data: {
        userId,
        label,
        publicKey,
        encrypted   : envelope,
        isProtected : false,
        // privateKey left NULL on purpose
      },
    });
    console.log("✅ Wallet saved to DB:", wallet.id);

    /* 5️⃣  Make it active if user has none */
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user.activeWalletId)
      await prisma.user.update({ where: { id: userId }, data: { activeWalletId: wallet.id } });

    /* 6️⃣  Inject untracked SPL positions */
    await injectUntracked(userId, [wallet.id]);

    /* 7️⃣  Done */
    return res.json({
      message         : "Wallet saved.",
      wallet,
      activeWalletId  : wallet.id,
      refetchOpenTrades: true
    });

  } catch (err) {
    if (err.code === "P2002" && err.meta?.target?.includes("userId_label"))
      return res.status(400).json({ error: "Label already exists." });

    console.error("🔥 Wallet import error:", err);
    return res.status(500).json({ error: "Failed to import wallet." });
  }
});



router.post('/send-sol', async (req, res) => {
  const { senderWalletId, recipientAddress, amount } = req.body;

  if (!recipientAddress || !amount) {
    return res.status(400).json({ error: 'Recipient address or amount missing.' });
  }

  try {
    const senderWallet = await prisma.wallet.findUnique({
      where: { id: senderWalletId },
    });

    if (!senderWallet) {
      return res.status(404).json({ error: 'Sender wallet not found.' });
    }

    console.log(`🔐 Decrypting private key for wallet ID ${senderWalletId}`);
    const decryptedPrivateKey = decrypt(senderWallet.privateKey);

    console.log(`📜 Decoding private key`);
    const secretKey = bs58.decode(decryptedPrivateKey.trim());
    const senderKeypair = Keypair.fromSecretKey(secretKey);
    console.log(`🪪 Sender pubkey: ${senderKeypair.publicKey.toBase58()}`);


    console.log(`🌐 Connecting to Solana RPC`);
    const connection = new Connection(process.env.SOLANA_RPC_URL, "confirmed");

    const senderBalanceLamports = await connection.getBalance(senderKeypair.publicKey);
const amountLamports = Math.floor(amount * 1e9);

if (senderBalanceLamports < amountLamports + 5000) { // 5000 lamports buffer for fees
  return res.status(400).json({ error: `Insufficient balance. Available: ${(senderBalanceLamports / 1e9).toFixed(4)} SOL` });
}

    console.log(`💸 Building transaction`);
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: senderKeypair.publicKey,
        toPubkey: new PublicKey(recipientAddress),
        lamports: Math.floor(amount * 1e9), // SOL -> lamports
      })
    );

    console.log(`✍️ Sending transaction`);
    const signature = await connection.sendTransaction(transaction, [senderKeypair]);

    console.log(`⏳ Confirming transaction: ${signature}`);
    await connection.confirmTransaction(signature, 'confirmed');

    console.log(`✅ Transaction confirmed: ${signature}`);
    res.json({ success: true, signature });
  } catch (error) {
    console.error('🔥 Error sending Sol:', error);
    res.status(500).json({ error: 'Failed to send transaction.' });
  }
});



//Test Route (for testing manully
// Backend route that fetches wallets
router.get("/load", authenticate, async (req, res) => {
  try {
    console.log("🔷 /wallets/load called");
    console.log("🔷 Authenticated user ID:", req.user?.id);

    const wallets = await prisma.wallet.findMany({
      where: { userId: req.user.id },
      select: {
        id: true,
        label: true,
        publicKey: true,
        createdAt: true,
      },
    });

    console.log("🔷 Wallets loaded:", wallets.length);

    if (wallets.length === 0) {
      console.warn("⚠️ No wallets found for user:", req.user.id);
      return res.status(404).json({ error: "No wallets found" });
    }

    res.json(wallets);
  } catch (err) {
    console.error("❌ Error loading wallets:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// TEMP: Delete all wallets for current user
router.delete("/wipe", authenticate, async (req, res) => {
  await prisma.wallet.deleteMany({ where: { userId: req.user.id } });
  res.json({ message: "All wallets wiped for user." });
});


router.get("/portfolio", authenticate, async (req, res) => {
  try {
    const walletId = req.query.walletId;
        console.log(`[portfolio] Received request: walletId=${walletId}`);

    if (!walletId) {
      return res.status(400).json({ error: "Missing walletId" });
    }

   const wallet = await prisma.wallet.findUnique({
  where: { id: parseInt(walletId, 10) },
  select: { publicKey: true }
});
        console.log(`[portfolio] Found wallet:`, wallet);


    if (!wallet) {
      return res.status(404).json({ error: "Wallet not found" });
    }

    const conn  = new Connection(process.env.SOLANA_RPC_URL, "confirmed");
    const owner = new PublicKey(wallet.publicKey);
        console.log(`[portfolio] Querying Solana balance for pubkey: ${wallet.publicKey}`);

    const { value } = await conn.getParsedTokenAccountsByOwner(
      owner,
      { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") }
    );
        console.log(`[portfolio] Parsed token accounts count: ${value.length}`);


    const tokens = value
      .map(a => a.account.data.parsed.info)
      .filter(i => +i.tokenAmount.uiAmount > 0.1)
      .map(i => ({
        mint     : i.mint,
        amount   : +i.tokenAmount.uiAmount,
        decimals : +i.tokenAmount.decimals,
      }));
          console.log(`[portfolio] Raw token balances:`, tokens);


    const SOL_MINT = "So11111111111111111111111111111111111111112";
    const solLamports = await conn.getBalance(owner);
        console.log(`[portfolio] SOL lamports: ${solLamports}, SOL: ${solLamports / 1e9}`);

    if (solLamports > 0) {
      tokens.push({
        mint     : SOL_MINT,
        amount   : solLamports / 1e9,
        decimals : 9,
      });
    }

    let metaMap = {
      [SOL_MINT]: {
        name: "Solana",
        symbol: "SOL",
        logo: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/info/logo.png",
        price: 0,
      },
    };

    try {
      const { data } = await axios.get("https://public-api.birdeye.so/v1/wallet/token_list", {
        params: { wallet: owner.toBase58() },
        headers: {
          "x-chain": "solana",
          "X-API-KEY": process.env.BIRDEYE_API_KEY,
        },
        timeout: 5000,
      });

      const items = data?.data?.items || [];
      for (const item of items) {
        metaMap[item.address] = {
          name: item.name,
          symbol: item.symbol,
          logo: item.logoURI,
          price: item.priceUsd,
        };
      }
    } catch (err) {
      console.warn(`⚠️ Birdeye wallet fetch failed:`, err.message);
    }

    const unresolved = tokens.filter(t => !metaMap[t.mint]?.price).map(t => t.mint);
    await Promise.all(unresolved.map(mint =>
      limit(async () => {
        try {
          const { data } = await axios.get("https://public-api.birdeye.so/defi/price", {
            params: { address: mint },
            headers: {
              "x-chain": "solana",
              "X-API-KEY": process.env.BIRDEYE_API_KEY,
            },
            timeout: 3000,
          });
          const p = data?.data?.value ?? 0;
          if (p > 0) metaMap[mint] = { ...(metaMap[mint] || {}), price: p };
        } catch { /* ignore */ }
      })
    ));

    const enriched = tokens
      .map(t => {
        const meta = metaMap[t.mint] || {};
        const price = meta.price || 0;
        return {
          ...t,
          name: meta.name || `${t.mint.slice(0,4)}…${t.mint.slice(-4)}`,
          symbol: meta.symbol || "",
          logo: meta.logo || "",
          price,
          valueUsd: +(t.amount * price).toFixed(2),
        };
      })
      .sort((a, b) => b.valueUsd - a.valueUsd);
          console.log(`[portfolio] Enriched portfolio:`, enriched);

    res.json(enriched);

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});



router.get("/:id/tokens", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const walletId = parseInt(req.params.walletId);

    if (isNaN(walletId)) {
      return res.status(400).json({ error: "Invalid wallet ID" });
    }

    // 🔍 Confirm this wallet belongs to this user
    const wallet = await prisma.wallet.findFirst({
      where: {
        id: walletId,
        userId: userId
      }
    });

    if (!wallet) {
      return res.status(404).json({ error: "Wallet not found for this user." });
    }

    const conn = new Connection(process.env.SOLANA_RPC_URL, "confirmed");
    const owner = new PublicKey(wallet.publicKey);

    // ✅ Ensure fallback constant exists
    const MIN_VALUE_USD = 1;

    // Fetch tokens from wallet
    const { value } = await conn.getParsedTokenAccountsByOwner(
      owner,
      { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") }
    );

    const tokens = value
      .map(a => a.account.data.parsed.info)
      .filter(i => +i.tokenAmount.uiAmount > 0.1)
      .map(i => ({
        mint     : i.mint,
        amount   : +i.tokenAmount.uiAmount,
        decimals : +i.tokenAmount.decimals,
      }));

      /* ── inject native SOL balance ── */
      const SOL_MINT = "So11111111111111111111111111111111111111112";
      const solLamports = await conn.getBalance(owner);
      if (solLamports > 0) {
        tokens.push({
          mint     : SOL_MINT,
          amount   : solLamports / 1e9,
          decimals : 9,
        });
      }
      

    // 🔥 Fetch names/symbols/logo/prices using Birdeye wallet portfolio endpoint
    let metaMap = {};
          /* pre-seed meta so it always has a name/icon */
      metaMap[SOL_MINT] = {
        name   : "Solana",
        symbol : "SOL",
        logo   : "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/info/logo.png",
        price  : 0,
      };

    try {
      const { data } = await axios.get("https://public-api.birdeye.so/v1/wallet/token_list", {
        params: { wallet: owner.toBase58() },
        headers: {
          "x-chain": "solana",
          "X-API-KEY": process.env.BIRDEYE_API_KEY,
        },
        timeout: 5000,
      });

      const items = data?.data?.items || [];
      for (const item of items) {
        metaMap[item.address] = {
          name: item.name,
          symbol: item.symbol,
          logo: item.logoURI,
          price: item.priceUsd,
        };
      }
    } catch (err) {
      console.warn("❌ Birdeye wallet portfolio fetch failed:", err.response?.status || err.message);
    }
    /* ❸ Same per-token fallback used above */
    const unresolved = tokens.filter(t => !metaMap[t.mint]?.price).map(t => t.mint);
    await Promise.all(unresolved.map(mint =>
      limit(async () => {
        try {
          const { data } = await axios.get("https://public-api.birdeye.so/defi/price", {
            params  : { address: mint, ui_amount_mode: "raw" },
            headers : { "x-chain":"solana", "X-API-KEY": process.env.BIRDEYE_API_KEY },
            timeout : 3000,
          });
          const p = data?.data?.value ?? 0;
          if (p > 0) metaMap[mint] = { ...(metaMap[mint] || {}), price: p };
        } catch {/* ignore */ }
      })
    ));

    // Attach name + symbol fallback
   const enriched = tokens
      .map(t => {
        const price = metaMap[t.mint]?.price || 0;
        return {
          ...t,
          name  : metaMap[t.mint]?.name   || `${t.mint.slice(0,4)}…${t.mint.slice(-4)}`,
          symbol: metaMap[t.mint]?.symbol || "",
          logo  : metaMap[t.mint]?.logo   || "",
          price,
          valueUsd: t.amount * price,
        };
      })
      .filter(t =>
        t.mint === SOL_MINT || (t.price > 0 && t.valueUsd >= MIN_VALUE_USD)
     )
      .sort((a, b) => b.valueUsd - a.valueUsd);

    res.json(enriched);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});


module.exports = router;