const { z } = require("zod");

// GET /history
const historyQuery = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(300).optional(),
  offset: z.coerce.number().int().min(0).default(0).optional(),
});

// GET /download
const downloadQuery = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  strategy: z.string().default("all").optional(),
  preset: z.enum(["raw","tax"]).default("raw").optional(),
});

// GET /positions
const positionsQuery = z.object({
  walletLabel: z.string().min(1).optional(),
});

// POST /open – (not used in current file but define for completeness)
const openTradeSchema = z.object({
  mint: z.string().min(10),
  amount: z.coerce.number().positive(),
  priceUSD: z.coerce.number().positive().optional(),
  walletId: z.union([z.coerce.number().int().positive(), z.string().min(1)]).optional(),
  strategy: z.string().min(1).optional(),
});

// DELETE /open/:mint
const deleteOpenParams = z.object({
  mint: z.string().min(10),
});

// POST /clear-dust
const clearDustSchema = z.object({
  walletId: z.union([z.coerce.number().int().positive(), z.string().min(1)]).optional(),
});

module.exports = {
  historyQuery,
  downloadQuery,
  positionsQuery,
  openTradeSchema,
  deleteOpenParams,
  clearDustSchema,
};