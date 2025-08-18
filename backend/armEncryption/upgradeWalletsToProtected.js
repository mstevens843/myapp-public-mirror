const readline = require("readline/promises");
const { stdin, stdout } = require("node:process");
const argon2 = require("argon2");
const prisma = require("../prisma/prisma");

// ⬇️ UNPROTECTED (server-secret HKDF) helpers
const {
  decryptEnvelope,          // ({ envelope, userId, serverSecret }) -> Buffer pk
} = require("./envelopeCryptoUnprotected");

// ⬇️ PROTECTED (passphrase Argon2id) helpers
const {
  encryptPrivateKey,        // (pkBuf, { passphrase, aad }) -> protected blob JSON
} = require("./envelopeCrypto");

// ---- constants / helpers ----------------------------------------------------
const SERVER_SECRET = process.env.ENCRYPTION_SECRET;
if (!SERVER_SECRET) {
  console.error("ENCRYPTION_SECRET is not set. Aborting.");
  process.exit(1);
}

// Stable AAD convention used for PROTECTED blobs.
// IMPORTANT: your unlock/arm path must use the SAME AAD formula.
function computeAAD(userIdStr, walletId) {
  return `user:${userIdStr}:wallet:${walletId}`;
}

(async () => {
  const [, , dbUserId] = process.argv;
  if (!dbUserId) {
    console.error("Usage: node scripts/upgradeWalletsToProtected.js <dbUserId>");
    process.exit(1);
  }

  // Prompt for passphrase (twice)
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const pass1 = await rl.question("Enter new wallet passphrase: ");
  const pass2 = await rl.question("Confirm passphrase: ");
  await rl.close();
  if (!pass1 || pass1 !== pass2) {
    console.error("Passphrases do not match or are empty. Aborting.");
    process.exit(1);
  }
  const passphrase = pass1;

  // Load user (need user.userId for HKDF/AAD)
  const user = await prisma.user.findUnique({
    where: { id: dbUserId },
    select: { id: true, userId: true },
  });
  if (!user) {
    console.error(`User not found: ${dbUserId}`);
    process.exit(1);
  }

  // Gather wallets that are NOT protected yet
  const wallets = await prisma.wallet.findMany({
    where: { userId: dbUserId, isProtected: false },
    select: { id: true, encrypted: true, privateKey: true },
  });

  if (wallets.length === 0) {
    console.log("No unprotected wallets to upgrade.");
    process.exit(0);
  }

  console.log(`Upgrading ${wallets.length} wallet(s) for user ${dbUserId}…`);

  // Optional: store a per-wallet passphrase hash for quick validation
  // (argon2 encoded string; separate from KEK derivation used inside blob)
  const passphraseHash = await argon2.hash(passphrase, { type: argon2.argon2id });

  for (const w of wallets) {
    try {
      // 1) Get the unprotected envelope JSON
      const core = w.encrypted?.data || w.encrypted;
      if (!core) {
        throw new Error(`Wallet ${w.id} missing unprotected envelope`);
      }

      // 2) Decrypt the raw secret using server-secret HKDF + user.userId
      const rawPk = decryptEnvelope({
        envelope: core,
        userId: user.userId,          // HKDF salt
        serverSecret: SERVER_SECRET,  // ENCRYPTION_SECRET
      });

      // 3) Re-encrypt as PROTECTED with passphrase (Argon2id)
      const aad = computeAAD(user.userId, w.id);
      const protectedBlob = await encryptPrivateKey(rawPk, {
        passphrase,
        aad,
      });

      // Zeroize rawPk in memory
      rawPk.fill(0);

      // 4) Persist: overwrite encrypted, set isProtected, clear plaintext
      await prisma.wallet.update({
        where: { id: w.id },
        data: {
          encrypted: protectedBlob,   // JSON blob for protected mode
          isProtected: true,
          encryptionVersion: 1,
          privateKey: null,           // ensure no plaintext stored
          passphraseHash,             // optional but recommended
        },
      });

      console.log(`✅ Upgraded wallet ${w.id}`);
    } catch (e) {
      console.error(`❌ Failed to upgrade wallet ${w.id}:`, e.message || e);
    }
  }

  console.log("Done.");
  process.exit(0);
})();