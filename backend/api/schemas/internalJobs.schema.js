const { z } = require("zod");

// GET /internal/positions?userId&walletLabel?
const positionsQuery = z.object({
  userId: z.string().min(1),
  walletLabel: z.string().min(1).optional(),
});

const mint = z.string().min(10, "Valid mint required");

// POST /manual/buy and /buy
const internalBuySchema = z.object({
  userId: z.string().min(1),
  walletLabel: z.string().min(1).optional(),
  mint,
  amountInSOL: z.coerce.number().positive().optional(),
  amountInUSDC: z.coerce.number().positive().optional(),
  slippage: z.coerce.number().min(0).max(100).optional(),
  strategy: z.string().min(1).optional(),
  tp: z.coerce.number().positive().optional(),
  sl: z.coerce.number().positive().optional(),
  tpPercent: z.coerce.number().min(1).max(100).optional(),
  slPercent: z.coerce.number().min(1).max(100).optional(),
  force: z.boolean().optional(),
}).refine(d => d.amountInSOL || d.amountInUSDC, {
  message: "Either amountInSOL or amountInUSDC is required",
  path: ["amountInSOL"],
});

// POST /sell
const internalSellSchema = z.object({
  userId: z.string().min(1),
  mint,
  walletLabel: z.string().min(1).optional(),
  percent: z.coerce.number().min(0).max(100).optional(),
  amount: z.coerce.number().positive().optional(),
  slippage: z.coerce.number().min(0).max(100).optional(),
  triggerType: z.string().min(1).optional(),
  force: z.boolean().optional(),
  strategy: z.string().min(1).optional(),
}).refine(d => d.percent || d.amount, {
  message: "Provide percent or amount",
  path: ["percent"],
});

module.exports = {
  positionsQuery,
  internalBuySchema,
  internalSellSchema,
};