const { z } = require("zod");

// POST /set-chat-id
const setChatIdSchema = z.object({
  chatId: z.union([z.string().min(1), z.coerce.number()]),
});

// GET /chat-id – no input

// GET /preferences – no input

// POST /preferences
const setPreferencesSchema = z.object({
  alertsEnabled: z.boolean().optional(),
  dailyDigest: z.boolean().optional(),
  priceAlerts: z.boolean().optional(),
}).passthrough(); // allow future keys

// POST /test – optional message override
const sendTestSchema = z.object({
  message: z.string().min(1).optional(),
});

// POST /clear – no input

module.exports = {
  setChatIdSchema,
  setPreferencesSchema,
  sendTestSchema,
};