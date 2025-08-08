const { z } = require("zod");

// POST /create-solana-session
const createSolanaSessionSchema = z.object({
  plan: z.enum(["standard","pro","credits"]),
  amount: z.coerce.number().positive().optional(), // required for credits; validated in handler too
});

// POST /verify-solana-session
const verifySolanaSessionSchema = z.object({
  sessionId: z.string().min(6),
});

// GET /subscription-status – no body

// POST /create-checkout-session
const createCheckoutSessionSchema = z.object({
  priceId: z.string().min(1).optional(),
  plan: z.enum(["free","standard","pro"]).optional(),
  mode: z.enum(["subscription","payment"]).optional(),
});

// POST /change-plan
const changePlanSchema = z.object({
  plan: z.enum(["free","standard","pro"]),
});

// GET /get-payment-method – no body

// POST /purchase-credits
const purchaseCreditsSchema = z.object({
  amountUSD: z.coerce.number().positive(),
});

// POST /create-setup-intent – no body

// POST /delete-payment-method – may accept paymentMethodId
const deletePaymentMethodSchema = z.object({
  paymentMethodId: z.string().min(1).optional(),
});

// POST /cancel-subscription, /uncancel – no body

module.exports = {
  createSolanaSessionSchema,
  verifySolanaSessionSchema,
  createCheckoutSessionSchema,
  changePlanSchema,
  purchaseCreditsSchema,
  deletePaymentMethodSchema,
};