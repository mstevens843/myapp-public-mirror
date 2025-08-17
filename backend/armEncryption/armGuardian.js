"use strict";

/**
 * Arm Guardian
 * - Wraps sessionKeyCache.arm/extend/disarm with warn/expire timers
 * - On warn/expire: scans DB for Arm-dependent rules (TP/SL, DCA, Limit, ScheduledStrategy)
 * - Notifies UI (popup) + Telegram; optional auto-pause on expire
 *
 * Env:
 *   ARM_WARN_LEAD_MS=60000                 // warn this many ms before expiry
 *   ARM_AUTO_DISABLE_ON_DISARM=0           // "1" to auto-pause rules on expire
 */

const prisma = require("../prisma/prisma");
const { sendAlert } = require("../telegram/alerts");
const cache = require("./sessionKeyCache"); // arm/extend/disarm/getDEK/status/getSession
const { audit } = require("./audit");

// Optional UI bridge (websocket/pusher/etc.)
let uiEvents = { publish: () => {} };
try { uiEvents = require("../realtime/uiEvents"); } catch (_) {}

const WARN_LEAD_MS = Math.max(0, Number(process.env.ARM_WARN_LEAD_MS || 60_000));
const AUTO_DISABLE = String(process.env.ARM_AUTO_DISABLE_ON_DISARM || "0").trim() === "1";

// k = `${userId}:${walletId}` -> { warn:Timeout, expire:Timeout }
const _timers = new Map();

function _k(userId, walletId) { return `${userId}:${walletId}`; }
function _clear(k) {
  const t = _timers.get(k);
  if (!t) return;
  try { clearTimeout(t.warn); } catch {}
  try { clearTimeout(t.expire); } catch {}
  _timers.delete(k);
}

async function _scanDependents({ userId, walletId }) {
  // Only warn for protected wallets or users that require Arm to trade
  const [wallet, user] = await Promise.all([
    prisma.wallet.findUnique({ where: { id: walletId }, select: { isProtected: true, label: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { requireArmToTrade: true } }),
  ]);
  if (!wallet) return { needsArm: false, counts: {}, walletLabel: "Wallet" };

  const needsArm = Boolean(wallet.isProtected || user?.requireArmToTrade);

  const [tpSl, dca, lim, sched] = await Promise.all([
    prisma.tpSlRule.count({ where: { userId, walletId, enabled: true, status: "active" } }),
    prisma.dcaOrder.count({ where: { userId, walletId, status: "active" } }),
    prisma.limitOrder.count({ where: { userId, walletId, status: "open" } }),
    prisma.scheduledStrategy.count({ where: { userId, walletId, status: { in: ["pending", "running"] } } }),
  ]);
  return {
    needsArm,
    walletLabel: wallet.label || "Wallet",
    counts: { tpSl, dca, limit: lim, scheduled: sched },
  };
}

function _schedule(userId, walletId) {
  const k = _k(userId, walletId);
  _clear(k);

  const s = cache.status(userId, walletId); // { armed, msLeft, armedAt }  :contentReference[oaicite:2]{index=2}
  if (!s.armed) return;

  const now = Date.now();
  const warnAt = Math.max(now, now + s.msLeft - WARN_LEAD_MS);
  const warnDelay = Math.max(0, warnAt - now);
  const expDelay = Math.max(0, s.msLeft);

  const warn = setTimeout(() => _handleAboutToExpire(userId, walletId), warnDelay).unref?.();
  const expire = setTimeout(() => _handleExpired(userId, walletId, "expired"), expDelay).unref?.();

  _timers.set(k, { warn, expire });
}

async function _notifyUI(userId, event, payload) {
  try { uiEvents.publish(userId, event, payload); } catch (_) {}
}

function _fmtCounts(c) {
  const parts = [];
  if (c.tpSl) parts.push(`${c.tpSl} TP/SL`);
  if (c.dca) parts.push(`${c.dca} DCA`);
  if (c.limit) parts.push(`${c.limit} Limit`);
  if (c.scheduled) parts.push(`${c.scheduled} Scheduled`);
  return parts.length ? parts.join(", ") : "no dependent rules";
}

async function _handleAboutToExpire(userId, walletId) {
  const s = cache.status(userId, walletId); // re-check
  if (!s.armed) return;

  const { needsArm, counts, walletLabel } = await _scanDependents({ userId, walletId });
  if (!needsArm) return;

  const minutes = Math.max(0, Math.ceil(s.msLeft / 60_000));
  const summary = _fmtCounts(counts);

  await audit(userId, "ARM_ABOUT_TO_EXPIRE", { walletId, msLeft: s.msLeft, counts }); // :contentReference[oaicite:3]{index=3}

  // UI popup + Telegram
  await _notifyUI(userId, "arm:about_to_expire", {
    walletId, walletLabel, msLeft: s.msLeft, counts,
    message: `Arm session for "${walletLabel}" expires in ~${minutes} min; ${summary} will not trigger without Arm.`,
  });
  try {
    await sendAlert(
      userId,
      `⏳ *Arm expiring soon*\n*Wallet:* ${walletLabel}\n*Time Left:* ~${minutes} min\n*Depends:* ${summary}\n\nTap *Extend Arm* to keep automations firing.`,
      "ARM"
    );
  } catch {}
}

async function _handleExpired(userId, walletId, reason) {
  // Disarm in cache (zeroize) and clear timers immediately
  const k = _k(userId, walletId);
  _clear(k);
  try { cache.disarm(userId, walletId); } catch {}

  const { needsArm, counts, walletLabel } = await _scanDependents({ userId, walletId });
  await audit(userId, "ARM_EXPIRED", { walletId, reason, counts }); // :contentReference[oaicite:4]{index=4}

  if (needsArm && (counts.tpSl || counts.dca || counts.limit || counts.scheduled)) {
    // Optional: auto-pause rules for hard safety
    if (AUTO_DISABLE) {
      await Promise.allSettled([
        prisma.tpSlRule.updateMany({ where: { userId, walletId, enabled: true, status: "active" }, data: { enabled: false, status: "paused_arm" } }),
        prisma.dcaOrder.updateMany({ where: { userId, walletId, status: "active" }, data: { status: "paused" } }),
        prisma.limitOrder.updateMany({ where: { userId, walletId, status: "open" }, data: { status: "paused" } }),
        prisma.scheduledStrategy.updateMany({ where: { userId, walletId, status: { in: ["pending", "running"] } }, data: { status: "paused" } }),
      ]);
    }

    const summary = _fmtCounts(counts);

    // UI popup + Telegram
    await _notifyUI(userId, "arm:expired", {
      walletId, walletLabel,
      counts, autoPaused: AUTO_DISABLE,
      message: `Arm session for "${walletLabel}" has ended; ${summary} ${(AUTO_DISABLE ? "were paused" : "won't trigger")} until you re-Arm.`,
    });
    try {
      await sendAlert(
        userId,
        `🔒 *Arm ended*\n*Wallet:* ${walletLabel}\n*Status:* ${(AUTO_DISABLE ? "Rules paused" : "Automations inactive")}\n*Depends:* ${summary}\n\nTap *Arm Wallet* to resume.`,
        "ARM"
      );
    } catch {}
  }
}

/* ───────────────────────── Public API ───────────────────────── */

/** Arm with timers (preferred entry) */
function arm(userId, walletId, dekBuffer, ttlMs) {
  cache.arm(userId, walletId, dekBuffer, ttlMs); // in-memory store + TTL  :contentReference[oaicite:5]{index=5}
  _schedule(userId, walletId);
  audit(userId, "ARM", { walletId, ttlMs }).catch(() => {}); // :contentReference[oaicite:6]{index=6}
}

/** Extend with timers */
function extend(userId, walletId, ttlMs) {
  const ok = cache.extend(userId, walletId, ttlMs); // bump expiry  :contentReference[oaicite:7]{index=7}
  if (ok) {
    _schedule(userId, walletId);
    audit(userId, "EXTEND", { walletId, ttlMs }).catch(() => {}); // :contentReference[oaicite:8]{index=8}
  }
  return ok;
}

/** Disarm (manual) */
async function disarm(userId, walletId, reason = "manual") {
  _clear(_k(userId, walletId));
  try { cache.disarm(userId, walletId); } catch {} // zeroize  :contentReference[oaicite:9]{index=9}
  await _handleExpired(userId, walletId, reason);
  await audit(userId, "DISARM", { walletId, reason }).catch(() => {}); // :contentReference[oaicite:10]{index=10}
}

/** Pass-through helpers */
function getDEK(userId, walletId) { return cache.getDEK(userId, walletId); }  // :contentReference[oaicite:11]{index=11}
function status(userId, walletId) { return cache.status(userId, walletId); }  // :contentReference[oaicite:12]{index=12}

module.exports = { arm, extend, disarm, getDEK, status };
