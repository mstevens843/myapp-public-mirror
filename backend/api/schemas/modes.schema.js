const { z } = require("zod");

const walletAwareConfig = z.object({
  walletLabel: z.string().min(1).optional(),
}).passthrough(); // allow strategy-specific keys

// POST /start
const startSchema = z.object({
  mode: z.string().min(1),
  config: walletAwareConfig,
  autoRestart: z.boolean().optional(),
});

// POST /pause, /resume, /delete
const botIdSchema = z.object({
  botId: z.string().min(1),
});

// POST /start-multi
const startMultiSchema = z.object({
  strategies: z.array(z.object({
    mode: z.string().min(1),
    config: walletAwareConfig,
    autoRestart: z.boolean().optional(),
  })).min(1),
});

// POST /save-config
const saveConfigSchema = z.object({
  mode: z.string().min(1),
  name: z.string().default(""),
  config: walletAwareConfig,
});

// GET /list-configs (no query required)

// DELETE /delete-config/:id
const deleteConfigParams = z.object({
  id: z.string().min(1),
});

// PUT /edit-config/:id
const editConfigParams = deleteConfigParams;
const editConfigSchema = z.object({
  name: z.string().default("").optional(),
  config: walletAwareConfig,
});

module.exports = {
  startSchema,
  botIdSchema,
  startMultiSchema,
  saveConfigSchema,
  deleteConfigParams,
  editConfigParams,
  editConfigSchema,
};