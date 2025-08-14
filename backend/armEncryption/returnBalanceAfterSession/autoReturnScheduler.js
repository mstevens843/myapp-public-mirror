// backend/services/autoReturnScheduler.js
//
// Schedules AutoReturn shortly BEFORE arm expiry so the DEK is still present.
// Uses user defaults + per-arm overrides. Records a one-shot "recent trigger"
// for UI to optionally consume.

const prisma = require("../../prisma/prisma");
const { executeSweep } = require("./executeSweep");
const { status: sessionStatus } = require("../sessionKeyCache");

const timers = new Map();         // `${userId}:${walletId}` -> { timer, runAtMs, opts }
const recentTriggers = new Map(); // `${userId}:${walletId}` -> { ts, dest?, txids? }

const keyOf = (u, w) => `${u}:${w}`;

// ---------------- Tunables (env overridable) ----------------
const PREEMPT_MS     = Number(process.env.AUTO_RETURN_PREEMPT_MS ?? 8000); // fire ~8s before expiry
const SAFETY_MS      = Number(process.env.AUTO_RETURN_SAFETY_MS  ?? 500);  // leave time to sign/send
const RETRY_ON_FAIL  = String(process.env.AUTO_RETURN_RETRY_ON_FAIL ?? "1") !== "0";
const RETRY_MAX      = Number(process.env.AUTO_RETURN_RETRY_MAX ?? 1);      // one retry
const RETRY_DELAY_MS = Number(process.env.AUTO_RETURN_RETRY_DELAY_MS ?? 1500);
// ------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

function cancel(userId, walletId) {
  const k = keyOf(userId, walletId);
  const entry = timers.get(k);
  if (entry?.timer) try { clearTimeout(entry.timer); } catch {}
  timers.delete(k);
}

function cancelAll() {
  for (const [k, entry] of timers) try { if (entry.timer) clearTimeout(entry.timer); } catch {}
  timers.clear();
  recentTriggers.clear();
}

function schedule(userId, walletId, expiresAtMs, { enabledOverride, destOverride } = {}) {
  cancel(userId, walletId); // de-dupe

  const target = Math.max(0, Number(expiresAtMs || 0));
  const runAtMs = Math.max(0, target - PREEMPT_MS);
  const delay = Math.max(0, runAtMs - Date.now());

  const timer = setTimeout(
    () => trigger(userId, walletId, { enabledOverride, destOverride }),
    delay
  );

  timers.set(keyOf(userId, walletId), {
    timer,
    runAtMs,
    opts: { enabledOverride: !!enabledOverride, destOverride: destOverride || undefined },
  });

  console.log(
    `[AutoReturn] scheduled user:${userId} wallet:${walletId} runAt:${new Date(runAtMs).toISOString()} (preempt:${PREEMPT_MS}ms) opts:`,
    { enabledOverride: !!enabledOverride, destOverride: !!destOverride }
  );
}

function reschedule(userId, walletId, expiresAtMs) {
  const entry = timers.get(keyOf(userId, walletId));
  const opts = entry?.opts || {};
  schedule(userId, walletId, expiresAtMs, opts);
}

/** FE can call to show a one-shot “auto-send triggered” modal */
function consumeRecentTrigger(userId, walletId) {
  const k = keyOf(userId, walletId);
  const v = recentTriggers.get(k) || null;
  if (v) recentTriggers.delete(k);
  return v;
}

async function trigger(userId, walletId, { enabledOverride, destOverride } = {}) {
  cancel(userId, walletId); // remove timer entry

  // We EXPECT the session to still be armed here (pre-expiry run).
  let s = sessionStatus(userId, walletId);
  if (!s?.armed || s.msLeft <= 0) {
    console.log(`[AutoReturn] abort: session already disarmed user:${userId} wallet:${walletId}`);
    return;
  }

  try {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        autoReturnEnabledDefault: true,
        autoReturnDestPubkey: true,
        autoReturnGraceSeconds: true,
        autoReturnSweepTokens: true,         // reserved for future
        autoReturnSolMinKeepLamports: true,
        autoReturnFeeBufferLamports: true,
        autoReturnExcludeMints: true,
        autoReturnUsdcMints: true,
      },
    });

    const enabled = enabledOverride != null ? !!enabledOverride : !!u?.autoReturnEnabledDefault;
    const dest    = destOverride || u?.autoReturnDestPubkey;

    if (!enabled) {
      console.log(`[AutoReturn] disabled; not sweeping user:${userId} wallet:${walletId}`);
      return;
    }
    if (!dest || typeof dest !== "string" || dest.length < 20) {
      console.warn(`[AutoReturn] invalid/missing destination; abort user:${userId} wallet:${walletId} dest:${dest || "(none)"}`);
      return;
    }

    // Leave enough budget before expiry for 1st try + (optional) retry.
    // Budget needed for first send: SAFETY_MS.
    // If retry enabled: need RETRY_DELAY_MS + SAFETY_MS more.
    const retryBudget = RETRY_ON_FAIL && RETRY_MAX > 0 ? (RETRY_DELAY_MS + SAFETY_MS) : 0;
    const minLeftForFirstSend = SAFETY_MS + retryBudget;

    const desiredGraceMs = Math.max(0, (u?.autoReturnGraceSeconds ?? 10) * 1000);
    const msLeftNow = Math.max(0, s.msLeft);
    const graceMs = Math.max(0, Math.min(desiredGraceMs, msLeftNow - minLeftForFirstSend));

    console.log(
      `[AutoReturn] triggering (pre-expiry) user:${userId} wallet:${walletId} dest:${dest} graceMs:${graceMs} msLeft:${msLeftNow}`
    );

    if (graceMs > 0) {
      await sleep(graceMs);
      // After grace, re-check: session might have been extended or disarmed.
      s = sessionStatus(userId, walletId);
      if (!s?.armed || s.msLeft <= 0) {
        console.log(`[AutoReturn] aborted; session ended during grace user:${userId} wallet:${walletId}`);
        return;
      }
      // If the user extended significantly, scheduler /extend already rescheduled us.
      if (s.msLeft > PREEMPT_MS + SAFETY_MS) {
        console.log(`[AutoReturn] skipped; session extended user:${userId} wallet:${walletId} newMsLeft:${s.msLeft}`);
        return;
      }
    }

    const excludeMints       = Array.isArray(u?.autoReturnExcludeMints) ? u.autoReturnExcludeMints : [];
    const usdcMints          = Array.isArray(u?.autoReturnUsdcMints)    ? u.autoReturnUsdcMints    : [];
    const solMinKeepLamports = BigInt(u?.autoReturnSolMinKeepLamports ?? 10_000_000n);
    const feeBufferLamports  = BigInt(u?.autoReturnFeeBufferLamports  ?? 10_000n);

    console.log("[AutoReturn] start sweep", {
      userId, walletId, dest,
      excludeMintsCount: excludeMints.length,
      usdcMintsCount: usdcMints.length,
      solMinKeepLamports: String(solMinKeepLamports),
      feeBufferLamports: String(feeBufferLamports),
    });

    // -------- attempt #1 --------
    let txids = [];
    try {
      ({ txids } = await executeSweep({
        userId, walletId, destPubkey: dest,
        excludeMints, usdcMints, solMinKeepLamports, feeBufferLamports,
      }));
    } catch (e) {
      console.error(`[AutoReturn] sweep attempt#1 error user:${userId} wallet:${walletId}:`, e?.message || e);
      txids = [];
    }

    // -------- optional retry --------
    if (RETRY_ON_FAIL && RETRY_MAX > 0 && (!Array.isArray(txids) || txids.length === 0)) {
      // Ensure we still have a valid session & time to try once more.
      const sAfter = sessionStatus(userId, walletId);
      const msLeftAfter = Math.max(0, sAfter?.msLeft ?? 0);

      if (!sAfter?.armed || msLeftAfter <= SAFETY_MS) {
        console.warn(`[AutoReturn] retry skipped (session nearly/fully expired) user:${userId} wallet:${walletId} msLeft:${msLeftAfter}`);
      } else {
        const wait = Math.min(RETRY_DELAY_MS, Math.max(0, msLeftAfter - SAFETY_MS));
        console.log(`[AutoReturn] retrying in ${wait}ms user:${userId} wallet:${walletId}`);
        await sleep(wait);

        const sBeforeRetry = sessionStatus(userId, walletId);
        if (sBeforeRetry?.armed && sBeforeRetry.msLeft > SAFETY_MS) {
          try {
            const res2 = await executeSweep({
              userId, walletId, destPubkey: dest,
              excludeMints, usdcMints, solMinKeepLamports, feeBufferLamports,
            });
            if (res2?.txids?.length) txids = res2.txids;
          } catch (e) {
            console.error(`[AutoReturn] sweep attempt#2 error user:${userId} wallet:${walletId}:`, e?.message || e);
          }
        } else {
          console.warn(`[AutoReturn] retry aborted (session ended) user:${userId} wallet:${walletId}`);
        }
      }
    }

    recentTriggers.set(keyOf(userId, walletId), {
      ts: Date.now(),
      dest,
      txids: Array.isArray(txids) ? txids : [],
    });

    console.log(
      `[AutoReturn] complete user:${userId} wallet:${walletId}; txids: ${Array.isArray(txids) && txids.length ? txids.join(", ") : "(none)"}`
    );
  } catch (e) {
    console.error(`[AutoReturn] error user:${userId} wallet:${walletId}:`, e?.stack || e?.message || e);
  }
}

process.on("SIGTERM", cancelAll);
process.on("SIGINT", cancelAll);

module.exports = { schedule, reschedule, cancel, cancelAll, consumeRecentTrigger };
