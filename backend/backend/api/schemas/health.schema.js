// backend/services/health/healthSchema.js
// Zod schemas for bot health telemetry: update payloads, registry state, and snapshots.

const { z } = require("zod");

/** Small helper to accept any ISO-ish date the backend emits */
const isIsoDate = (v) => {
  if (typeof v !== "string") return false;
  const t = Date.parse(v);
  return Number.isFinite(t);
};

/** Status reported by the strategy itself */
const HealthStatusEnum = z.enum(["running", "degraded", "stopped"]);

/** Server-derived health color */
const HealthLevelEnum = z.enum(["green", "yellow", "red"]);

/**
 * Telemetry emitted from a strategy loop.
 * This is what your emitHealth(botId, payload) should validate against.
 */
const HealthUpdatePayload = z.object({
  botId: z.string().min(1, "botId required"),
  status: HealthStatusEnum.optional(),
  lastTickAt: z
    .string()
    .refine(isIsoDate, "lastTickAt must be an ISO date string")
    .optional(),
  loopDurationMs: z.number().int().nonnegative().optional(),
  restartCount: z.number().int().min(0).optional(),
  pid: z.number().int().min(0).optional(),
  notes: z.string().max(200).optional(),
});

/**
 * A single bot’s health as stored in the registry/snapshot.
 * Includes server-derived fields: lastTickAgoMs, healthLevel.
 */
const BotHealth = HealthUpdatePayload.extend({
  lastTickAgoMs: z.number().int().min(0).nullable().optional(),
  healthLevel: HealthLevelEnum.optional(),
});

/** Full GET /api/health/bots response shape */
const HealthSnapshot = z.object({
  ts: z.string().refine(isIsoDate, "ts must be an ISO date string"),
  bots: z.record(BotHealth),
});

/** ENV config schema for thresholds (all ms) */
const HealthEnvConfig = z.object({
  HEALTH_WARN_STALE_MS: z.coerce.number().int().positive().default(90_000),
  HEALTH_ALERT_STALE_MS: z.coerce.number().int().positive().default(180_000),
  HEALTH_WARN_LOOP_MS: z.coerce.number().int().positive().default(3_000),
});

/** Convenience parsers (optional) */
function parseHealthUpdate(input) {
  return HealthUpdatePayload.parse(input);
}
function parseHealthSnapshot(input) {
  return HealthSnapshot.parse(input);
}
function readHealthEnv(env = process.env) {
  const cfg = HealthEnvConfig.parse(env);
  return {
    warnStaleMs: cfg.HEALTH_WARN_STALE_MS,
    alertStaleMs: cfg.HEALTH_ALERT_STALE_MS,
    warnLoopMs: cfg.HEALTH_WARN_LOOP_MS,
  };
}

module.exports = {
  HealthStatusEnum,
  HealthLevelEnum,
  HealthUpdatePayload,
  BotHealth,
  HealthSnapshot,
  HealthEnvConfig,
  parseHealthUpdate,
  parseHealthSnapshot,
  readHealthEnv,
};
