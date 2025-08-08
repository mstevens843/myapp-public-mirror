const { z } = require("zod");

/*
 * Schema for creating a scheduled strategy. Requires a mode and config
 * describing how the strategy should behave. Launch ISO is expected
 * to be an ISO 8601 string and is optional (if omitted the strategy
 * launches immediately). A schedule must target a wallet via either
 * walletId or walletLabel. Additional optional fields include name,
 * targetToken and limit.
 */

const scheduleCreateSchema = z.object({
  name: z.string().nullable().optional(),
  mode: z.string().min(1, "mode is required"),
  config: z.any(),
  launchISO: z.string().optional(),
  targetToken: z.string().optional().nullable(),
  limit: z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().optional()),
  walletLabel: z.string().optional(),
  walletId: z.string().optional(),
}).refine((data) => {
  return Boolean(data.walletLabel || data.walletId);
}, {
  message: "walletId or walletLabel is required",
});

module.exports = {
  scheduleCreateSchema,
};