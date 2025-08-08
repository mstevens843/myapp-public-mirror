const { z } = require("zod");

/*
 * Schema for querying wallet balance. Clients may supply one of
 * pubkey, walletId or walletLabel to identify the wallet. At least one
 * identifier is required. Values are kept as strings to avoid losing
 * precision for bigints in the database layer.
 */

const balanceQuerySchema = z.object({
  pubkey: z.string().optional(),
  walletId: z.string().optional(),
  walletLabel: z.string().optional(),
}).refine((data) => {
  return Boolean(data.pubkey || data.walletId || data.walletLabel);
}, {
  message: "Provide at least one of pubkey, walletId or walletLabel",
});

module.exports = {
  balanceQuerySchema,
};