/**
 * Mode Routes: Mode Control Routes for Solana Bot Strategies
 * ---------------------------------------------------------
 * – Supports unlimited parallel instances of any strategy.
 * – Each running bot is keyed by a unique `botId` (`${mode}-${timestamp}`).
 * – Exposes start / stop / status (quick + detailed) endpoints.
 *
 * This version introduces a feature flag check to disable specific
 * strategies at runtime.  Strategies listed in the DISABLED_STRATEGIES
 * environment variable will return a 503 Service Unavailable when
 * requested via the API.  See backend/config/featureFlags.js for details.
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const {
  registerStrategyStatus,
  clearStrategyStatus,
  getStrategyStatus,
  getAllStrategyStatuses,
} = require('../services/utils/strategy_utils/strategyStatus');
const savedSvc = require('../services/utils/strategy_utils/savedConfigDb');
const strategyConfigStorage = require('../services/utils/strategy_utils/strategyConfigStorage');
const { getWatchdogLog } = require('../services/utils/strategy_utils/strategyWatchdog');
const { startStrategy, stopStrategy } = require('../services/utils/strategy_utils/strategyLauncher');
const requireAuth = require('../middleware/requireAuth');
const prisma = require('../prisma/prisma');
const {
  runningProcesses, // botId → { mode, proc, configPath, … }
  lastConfigPaths, // botId → configPath
  lastTickTimestamps, // botId → ms
} = require('../services/utils/strategy_utils/activeStrategyTracker');
const { pauseStrategy } = require('../services/utils/strategy_utils/strategyLauncher');

// Import feature flag helper to gate strategy launches
const { isStrategyEnabled } = require('../config/featureFlags');

// ── Pagination helper (idempotent) ───────────────────────────────────────────
function __getPage(req, defaults = { take: 100, skip: 0, cap: 500 }) {
  const cap  = Number(defaults.cap || 500);
  let take   = parseInt(req.query?.take ?? defaults.take, 10);
  let skip   = parseInt(req.query?.skip ?? defaults.skip, 10);
  if (!Number.isFinite(take) || take <= 0) take = defaults.take;
  if (!Number.isFinite(skip) || skip <  0) skip = defaults.skip;
  take = Math.min(Math.max(1, take), cap);
  skip = Math.max(0, skip);
  return { take, skip };
}
// ─────────────────────────────────────────────────────────────────────────────
// Apply auth to all routes in this router
router.use(requireAuth);

async function getWallet(userId, walletLabel) {
  if (!walletLabel) {
    const { activeWalletId } = await prisma.user.findUnique({
      where: { id: userId },
      select: { activeWalletId: true },
    });
    if (!activeWalletId) throw new Error('No active wallet set for user.');
    return prisma.wallet.findUnique({
      where: { id: activeWalletId },
      select: { id: true, label: true },
    });
  }
  const w = await prisma.wallet.findFirst({
    where: { label: walletLabel, userId },
    select: { id: true, label: true },
  });
  if (!w) throw new Error(`Wallet '${walletLabel}' not found for user.`);
  return w;
}

/* ────────────────────────────────  ROUTES  ──────────────────────────────── */

/**
 * POST /api/mode/start
 * Launch a new strategy instance.
 * Body: { mode, config, autoRestart? }
 * Returns: { botId, mode, path }
 */
router.post('/start', async (req, res) => {
  const { mode, config, autoRestart = false } = req.body;
  if (!mode || !config) {
    return res.status(400).json({ error: 'Mode and config are required.' });
  }
  // Feature flag: prevent disabled strategies from launching
  if (!isStrategyEnabled(mode)) {
    return res
      .status(503)
      .json({ error: `Strategy ${mode} is disabled by feature flag` });
  }
  try {
    // 🔍 Resolve walletId from walletLabel
    const wallet = await getWallet(req.user.id, config.walletLabel);
    const configWithUser = {
      ...config,
      userId: req.user.id,
      walletId: wallet.id, // ✅ Inject like manual.js
    };
    const result = await startStrategy(mode, configWithUser, autoRestart);
    return res.json({
      message: `${mode} started.`,
      botId: result.botId,
      mode,
      path: result.configPath,
    });
  } catch (err) {
    return res.status(400).json({
      error: err.message || 'Failed to start strategy.',
      details: err.details || [],
    });
  }
});

/**
 * POST /api/mode/pause
 * Gracefully pause a specific bot instance without deleting config or status.
 * Body: { botId }
 */
router.post('/pause', async (req, res) => {
  const { botId } = req.body;
  if (!botId) return res.status(400).json({ error: 'botId required' });
  if (!pauseStrategy(botId))
    return res.status(400).json({ error: `Bot ${botId} not running.` });
  await prisma.strategyRunStatus.update({
    where: { botId },
    data: { isPaused: true, pausedAt: new Date() },
  });
  res.json({ message: `${botId} paused.` });
});

/* ─────────────────── POST /resume  ─────────────────────────── */
router.post('/resume', async (req, res) => {
  const { botId } = req.body;
  const stat = await prisma.strategyRunStatus.findUnique({ where: { botId } });
  if (!stat) return res.status(404).json({ error: 'botId not found' });
  if (!stat.isPaused) return res.status(400).json({ error: 'bot not paused' });
  const cfgPath = lastConfigPaths[botId];
  if (!cfgPath || !fs.existsSync(cfgPath)) {
    return res.status(400).json({ error: 'runtime config missing' });
  }
  let config;
  try {
    const raw = fs.readFileSync(cfgPath, 'utf8');
    config = JSON.parse(raw);
    if (!config || typeof config !== 'object' || !config.botId || !config.mode) {
      throw new Error('Invalid or incomplete config file');
    }
  } catch (err) {
    console.error('❌ Config load failed:', err.message);
    return res.status(400).json({ error: 'Invalid config file', details: err.message });
  }
  const oldId = botId;
  const newId = `${stat.mode}-${Date.now()}`;
  const mode = stat.mode;
  config.botId = newId;
  // 🧹 Delete old runtime config file
  const oldPath = lastConfigPaths[botId];
  if (oldPath && fs.existsSync(oldPath)) {
    try {
      fs.unlinkSync(oldPath);
      delete lastConfigPaths[botId];
      console.log(`🧹 Deleted old config for paused bot: ${oldPath}`);
    } catch (e) {
      console.warn(`⚠️ Could not delete old config: ${e.message}`);
    }
  }
  try {
    const { configPath } = await startStrategy(mode, config);
    const rawConfig = fs.readFileSync(configPath, 'utf8');
    const sanitizedConfig = JSON.parse(rawConfig);
    // ✅ Use upsert for the newId
    await prisma.strategyRunStatus.upsert({
      where: { botId: newId },
      update: {
        userId: config.userId || 'system',
        mode,
        configId: config.configId || null,
        pid: null,
        config: sanitizedConfig,
        isPaused: false,
        stoppedAt: null,
      },
      create: {
        botId: newId,
        userId: config.userId || 'system',
        mode,
        configId: config.configId || null,
        pid: null,
        config: sanitizedConfig,
      },
    });
    // ✅ Delete old row
    await prisma.strategyRunStatus.deleteMany({ where: { botId: oldId } });
    clearStrategyStatus(oldId);
    res.json({ message: 'resumed', botId: newId, oldId });
  } catch (err) {
    console.error('❌ Failed to resume bot:', err.message || err);
    res.status(500).json({ error: 'Failed to restart strategy', details: err.message || err });
  }
});

/* ─────────────────── POST /delete  ─────────────────────────── */
router.post('/delete', async (req, res) => {
  const { botId } = req.body;
  try {
    // 🧹 Stop process, remove config, clear memory
    stopStrategy(botId);
    // 🧹 Also remove DB row entirely
    await prisma.strategyRunStatus.deleteMany({
      where: { botId, userId: req.user.id },
    });
    res.json({ ok: true, message: `Bot ${botId} fully deleted.` });
  } catch (err) {
    console.error('❌ Failed to delete bot:', err);
    res.status(500).json({ error: 'Failed to delete bot', details: err.message });
  }
});

/**
 * POST /api/mode/start-multi
 * Launch several strategies in one call (still returns per-bot results).
 * Body: { strategies: [ { mode, config, autoRestart? }, … ] }
 */
router.post('/start-multi', async (req, res) => {
  const { strategies: strats = [] } = req.body;
  if (!Array.isArray(strats) || strats.length === 0) {
    return res.status(400).json({ error: 'No strategies provided.' });
  }
  const results = [];
  for (const strat of strats) {
    const { mode, config, autoRestart = false } = strat;
    // Feature flag: skip disabled strategies
    if (!isStrategyEnabled(mode)) {
      results.push({
        mode,
        status: 'disabled',
        error: `Strategy ${mode} is disabled by feature flag`,
      });
      continue;
    }
    try {
      const { botId, configPath } = await startStrategy(mode, config, autoRestart);
      results.push({ botId, mode, status: 'started', path: configPath });
    } catch (err) {
      results.push({
        mode,
        status: 'error',
        error: err.message,
        details: err.details || [],
      });
    }
  }
  res.json({ message: 'Multi-strategy launch attempted.', results });
});

/* ─────────────────── GET /status (lite)  ───────────────────── */
router.get('/status', requireAuth, async (req, res) => {
  const { take, skip } = __getPage(req, { take: 100, cap: 500 });
  try {
    const rows = await prisma.strategyRunStatus.findMany({
      where: { userId: req.user.id },
      select: { botId: true, mode: true },
    });
    const bots = rows.map(({ botId, mode }) => ({ botId, mode }));
    res.json({ bots });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/mode/status/detailed
 * Enriched diagnostics for admin / debug panels.
 */
router.get('/status/detailed', requireAuth, async (req, res) => {
  const raw = getAllStrategyStatuses();
  const out = {};
  const now = Date.now();
  // Fetch only valid botIds from DB
  // ✅ Pull paused flags from DB
  const dbStatuses = await prisma.strategyRunStatus.findMany({
    where: { userId: req.user.id },
    select: { botId: true, isPaused: true },
  });
  const validBotIds = new Set(dbStatuses.map((row) => row.botId));
  const pauseMap = Object.fromEntries(dbStatuses.map((row) => [row.botId, row.isPaused]));
  for (const [botId, data] of Object.entries(raw)) {
    if (!validBotIds.has(botId)) continue;
    const startedMs = data.startedAt ? new Date(data.startedAt).getTime() : null;
    const uptimeSec = startedMs ? Math.floor((now - startedMs) / 1000) : null;
    const lastTickMs = lastTickTimestamps[botId] ?? null;
    const lastAgoSec = lastTickMs ? Math.floor((now - lastTickMs) / 1000) : null;
    out[botId] = {
      ...data,
      uptimeRaw: uptimeSec,
      uptime: uptimeSec ? `${Math.floor(uptimeSec / 60)}m ${uptimeSec % 60}s` : 'N/A',
      lastTickAgoRaw: lastAgoSec,
      lastTickAgo: lastAgoSec ? `${Math.floor(lastAgoSec / 60)}m ${lastAgoSec % 60}s` : 'N/A',
      watchdogLog: getWatchdogLog(botId) || null,
      configPath: lastConfigPaths[botId] || null,
      isPaused: pauseMap[botId] ?? false, // ✅ from DB not memory
    };
  }
  res.json(out);
});

/* ───────────  Saved-config convenience endpoints (unchanged)  ─────────── */

/* ───── POST /save-config ───────────── */
router.post('/save-config', async (req, res) => {
  const { mode, config, name = '' } = req.body;
  if (!mode || !config) return res.status(400).json({ error: 'mode & config required' });
  try {
    /* ------------------------------------------------------------------
     * 1) Strip all runtime-only keys – we only want reusable bot settings
     * ---------------------------------------------------------------- */
    const RUNTIME_KEYS = [
      'botId',
      'pid',
      'walletId',
      'wallet',
      'walletIds',
      'wallets',
      'userId',
      'mode',
      'status',
      'startTime',
      'startedAt',
      'pausedAt',
      'stoppedAt',
      'lastTickAt',
    ];
    const cleanCfg = Object.fromEntries(
      Object.entries(config).filter(([k]) => !RUNTIME_KEYS.includes(k))
    );
    /* 2) Persist preset – strategyName is the rail selection you passed in
     *    (`sniper`, `scalper`, …) so there’s zero chance of “scheduleLauncher”
     *    leaking in again.
     */
    const row = await savedSvc.savePreset({
      userId: req.user.id,
      mode, // <- becomes SavedConfigs.strategyName
      name,
      cfg: cleanCfg, // <- cleaned config blob
    });
    res.json({ message: 'saved', id: row.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed', details: err.message });
  }
});

/* ───── GET /load-configs ───────────── */
router.get('/list-configs', async (req, res) => {
  const { mode } = req.query;
  try {
    const configs = await savedSvc.listPresets(req.user.id, mode);
    res.json(configs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed', details: err.message });
  }
});

/* ───── DELETE /delete-config ───────── */
router.delete('/delete-config/:id', async (req, res) => {
  try {
    await savedSvc.deletePreset(req.params.id, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'failed', details: err.message });
  }
});

module.exports = router;