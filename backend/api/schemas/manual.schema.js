const { z } = require("zod");

/**
 * Manual Buy Schema
 * - Requires either amountInSOL or amountInUSDC (positive)
 * - Requires outputMint (token mint address)
 */
const manualBuySchema = z.object({
  outputMint: z.string().min(10, "Valid token mint is required"),
  amountInSOL: z.number().positive().optional(),
  amountInUSDC: z.number().positive().optional(),
  walletId: z.number().int().positive().optional(),
}).refine(
  data => (data.amountInSOL || data.amountInUSDC),
  { message: "Either amountInSOL or amountInUSDC is required", path: ["amountInSOL"] }
);

module.exports = {
  manualBuySchema
};
