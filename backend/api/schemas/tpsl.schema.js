const { z } = require("zod");

/*
 * Schema for creating or updating a Take Profit/Stop Loss rule. A rule
 * applies to a specific token (mint) and wallet and may define take
 * profit and/or stop loss thresholds either as absolute price targets
 * (tp/sl) or percentages of the entry price (tpPercent/slPercent).
 * At least one of these thresholds must be provided. Percentages must
 * fall between 1 and 100 inclusive.
 */

const ruleSchema = z.object({
  mint: z.string().min(1, "mint is required"),
  tp: z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().positive().optional()),
  sl: z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().positive().optional()),
  tpPercent: z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().int().min(1).max(100).optional()),
  slPercent: z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().int().min(1).max(100).optional()),
  walletId: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.union([z.string(), z.number()])).optional(),
  force: z.preprocess((v) => v === 'true' ? true : v === 'false' ? false : v, z.boolean()).optional().default(false),
  strategy: z.string().optional().default('manual'),
}).refine((data) => {
  // Ensure at least one threshold is provided
  return data.tp != null || data.sl != null || data.tpPercent != null || data.slPercent != null;
}, {
  message: "At least one of tp, sl, tpPercent or slPercent must be provided",
});

module.exports = {
  ruleSchema,
};