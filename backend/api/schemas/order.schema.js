const { z } = require("zod");

/*
 * Schemas for order‑related endpoints. Two main order types exist in the
 * application today: limit orders and DCA (dollar cost average) orders.
 * Each schema coerces incoming numeric values to numbers, validates
 * required fields, and applies sensible defaults for optional values.
 */

/**
 * Schema for creating a limit order. Requires the target mint,
 * the price at which to execute and the amount. Optional fields
 * include the side (buy/sell), a boolean force flag and wallet
 * identifiers. side defaults to 'buy'.
 */
const limitOrderSchema = z.object({
  mint: z.string().min(1, "mint is required"),
  side: z.enum(["buy", "sell"]).optional().default("buy"),
  targetPrice: z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().positive()),
  amount: z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().positive()),
  force: z.preprocess((v) => v === 'true' ? true : v === 'false' ? false : v, z.boolean()).optional().default(false),
  walletLabel: z.string().optional(),
  walletId: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.union([z.string(), z.number()])).optional(),
});

/**
 * Schema for creating a DCA order. Requires the mint, total amount,
 * unit (e.g. 'usdc' or 'sol'), number of buys and the frequency in
 * hours. Optional fields include side, stop conditions and wallet
 * identifiers. Numeric values are coerced from strings.
 */
const dcaOrderSchema = z.object({
  mint: z.string().min(1, "mint is required"),
  side: z.enum(["buy", "sell"]).optional().default("buy"),
  amount: z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().positive()),
  unit: z.string().min(1, "unit is required"),
  numBuys: z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().int().positive()),
  freqHours: z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().int().positive()),
  stopAbove: z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().positive().optional()),
  stopBelow: z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().positive().optional()),
  force: z.preprocess((v) => v === 'true' ? true : v === 'false' ? false : v, z.boolean()).optional().default(false),
  walletLabel: z.string().optional(),
  walletId: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.union([z.string(), z.number()])).optional(),
});

module.exports = {
  limitOrderSchema,
  dcaOrderSchema,
};