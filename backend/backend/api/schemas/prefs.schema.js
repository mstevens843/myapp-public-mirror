const { z } = require("zod");

/*
 * Schema for updating user preferences. Nearly all fields are optional
 * because a client may choose to update only a subset of settings. Numeric
 * values are coerced from strings to numbers, booleans are properly
 * parsed and nested objects are supported. The context (ctx) may be
 * passed via route params; it is not validated here.
 */

const prefsUpdateSchema = z.object({
  defaultMaxSlippage: z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().nonnegative().optional()),
  defaultPriorityFee: z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().nonnegative().optional()),
  confirmBeforeTrade: z.preprocess((v) => {
    if (v === '' || v == null) return undefined;
    if (typeof v === 'string') return v === 'true';
    return v;
  }, z.boolean().optional()),
  alertsEnabled: z.preprocess((v) => {
    if (v === '' || v == null) return undefined;
    if (typeof v === 'string') return v === 'true';
    return v;
  }, z.boolean().optional()),
  slippage: z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().nonnegative().optional()),
  autoBuy: z.object({
    enabled: z.preprocess((v) => {
      if (v === '' || v == null) return undefined;
      if (typeof v === 'string') return v === 'true';
      return v;
    }, z.boolean().optional()),
    amount: z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().nonnegative().optional()),
  }).partial().optional(),
  mevMode: z.string().optional(),
  briberyAmount: z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().nonnegative().optional()),
});

module.exports = {
  prefsUpdateSchema,
};