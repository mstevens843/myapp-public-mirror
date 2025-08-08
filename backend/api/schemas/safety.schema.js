const { z } = require("zod");

// POST /check-token-safety
const checkTokenSafetySchema = z.object({
  mint: z.string().min(10, "Valid mint required"),
  options: z.record(z.any()).optional(),
});

// GET /:mint
const safetyParams = z.object({
  mint: z.string().min(10),
});

// GET /target-token/:mint
const targetTokenParams = safetyParams;

module.exports = {
  checkTokenSafetySchema,
  safetyParams,
  targetTokenParams,
};