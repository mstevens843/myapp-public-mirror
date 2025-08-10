const { z } = require("zod");

const walletIdType = z.union([z.coerce.number().int().positive(), z.string().min(1)]);

// POST /arm
const armSchema = z.object({
  walletId: walletIdType,
  passphrase: z.string(),
  ttlMinutes: z.coerce.number().int().min(30).max(720).optional(),
  applyToAll: z.boolean().optional(),
  passphraseHint: z.string().max(200).optional(),
  forceOverwrite: z.boolean().optional(),
});

// POST /extend
const extendSchema = z.object({
  walletId: walletIdType,
  ttlMinutes: z.coerce.number().int().min(30).max(720),
});

// POST /disarm
const disarmSchema = z.object({
  walletId: walletIdType,
});

// POST /remove-protection
const removeProtectionSchema = z.object({
  walletId: walletIdType,
  passphrase: z.string(),
});

// GET /status/:walletId
const statusParams = z.object({
  walletId: z.string().min(1),
});

// POST /setup-protection
const setupProtectionSchema = z.object({
  walletId: walletIdType,
  passphrase: z.string(),
  applyToAll: z.boolean().optional(),
  passphraseHint: z.string().max(200).optional(),
  forceOverwrite: z.boolean().optional(),
});

module.exports = {
  armSchema,
  extendSchema,
  disarmSchema,
  removeProtectionSchema,
  statusParams,
  setupProtectionSchema,
};