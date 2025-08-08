// backend/services/strategies/core/postTradeQueue.js
//
// Persistent Post‑Trade Queue
// ---------------------------
//
// The Turbo Sniper strategy may need to enqueue follow‑on actions
// immediately after executing a trade.  These actions include
// inserting take‑profit ladders, registering trailing stops and
// sending user alerts.  Because the trade executor must return as
// quickly as possible the queue decouples these side‑effects from
// the hot path and persists them to disk.  If the process
// restarts before the queue is drained the tasks are reloaded and
// executed on the next tick.
//
// Tasks are simple objects with the following shape:
//   {
//     chain: ['tp','trail','alerts'], // array of strings
//     mint:  '...',                  // token mint
//     userId: '...',                 // user identifier
//     walletId: '...',               // wallet identifier
//     meta: { tpLadder, trailingStopPct, entryPrice }, // trade meta
//     createdAt: timestamp
//   }
//
// The queue exposes two primary functions:
//   enqueue(task) – persist a task and increment queued metrics.
//   process()     – drain all pending tasks and execute their
//                   respective actions.  Execution is sequential
//                   and errors are logged but do not halt the
//                   processing loop.
//
// Metrics:
//   post_chain_queued_total – incremented when a new task is enqueued.
//   post_chain_exec_total   – incremented after each task is
//                             processed (regardless of success).

'use strict';

const fs = require('fs');
const path = require('path');
const prisma = require('../../../prisma/prisma');
const { v4: uuid } = require('uuid');
const { incCounter } = require('../logging/metrics');
const { buildLadderRules } = require('./TpSlManager');
const { sendAlert } = require('../../../telegram/alerts');

// Determine a storage location within the repo.  We store the
// queue under a .data directory to avoid polluting the root.  If
// the directory does not exist it is created on first use.
const DATA_DIR = path.join(__dirname, '..', '..', '..', '..', '.data');
const FILE_PATH = path.join(DATA_DIR, 'postTradeQueue.json');

// In‑memory queue.  This is loaded from disk on module import.
let _queue = [];

/**
 * Ensure the .data directory exists.  Invoked lazily before
 * persisting tasks.
 */
function ensureDir() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (_) {
    // ignore
  }
}

/**
 * Load any previously persisted tasks from disk into the in‑memory
 * queue.  This function is idempotent and is called once at
 * module load time.
 */
function loadQueue() {
  try {
    const json = fs.readFileSync(FILE_PATH, 'utf8');
    const arr = JSON.parse(json);
    if (Array.isArray(arr)) {
      _queue = arr;
    }
  } catch (_) {
    // ignore missing or malformed files
    _queue = [];
  }
}

/**
 * Persist the current in‑memory queue to disk.  Errors are
   deliberately swallowed – persistence failures should not crash
   the strategy.  In a production system you may wish to emit
   warnings here.
 */
function saveQueue() {
  ensureDir();
  try {
    fs.writeFileSync(FILE_PATH, JSON.stringify(_queue, null, 2));
  } catch (_) {
    // ignore
  }
}

// Load queue on initial import.
loadQueue();

/**
 * Enqueue a new post‑trade task.  The task is appended to the
 * in‑memory queue and persisted immediately.  A metric is
 * incremented for each enqueued chain.
 *
 * @param {Object} task Task object as described at top of file.
 */
function enqueue(task) {
  if (!task || !Array.isArray(task.chain) || !task.chain.length) return;
  task.createdAt = Date.now();
  _queue.push(task);
  incCounter('post_chain_queued_total');
  saveQueue();
}

/**
 * Process all pending tasks.  Each task is executed in sequence.
 * On completion the in‑memory queue is cleared and the file is
 * overwritten.  Any errors thrown by individual actions are
 * caught and logged to console.  A metric is incremented per
 * processed chain regardless of success.
 */
async function process() {
  const tasks = _queue.splice(0, _queue.length);
  for (const task of tasks) {
    try {
      await processTask(task);
    } catch (e) {
      console.warn('postTradeQueue: task processing error', e.message);
    } finally {
      incCounter('post_chain_exec_total');
    }
  }
  saveQueue();
}

/**
 * Execute the actions specified in a task.  Supported actions are
 * 'tp' (take‑profit ladder), 'trail' (trailing stop) and
 * 'alerts' (telegram alert).  Unknown actions are ignored.  The
 * order of actions in the chain is preserved.
 *
 * @param {Object} task
 */
async function processTask(task) {
  const { chain, mint, userId, walletId, meta = {} } = task;
  for (const action of chain) {
    switch (action) {
      case 'tp': {
        // Build ladder rules and insert into the database.  The
        // ladder array may be provided either in meta.tpLadder or
        // meta.ladder.  The target profit percentage may be in
        // meta.tpPercent; if absent we default to 0 (no target).
        const ladderStr = Array.isArray(meta.tpLadder)
          ? meta.tpLadder
          : typeof meta.tpLadder === 'string'
          ? meta.tpLadder.split(',').map((s) => Number(s.trim())).filter((n) => n > 0)
          : [];
        const ladder = ladderStr.filter((n) => Number.isFinite(n) && n > 0);
        const tpPercent = Number(meta.tpPercent) || 0;
        const slPercent = Number(meta.slPercent) || 0;
        if (ladder.length && (tpPercent !== 0 || slPercent !== 0)) {
          const rules = buildLadderRules({
            mint,
            walletId,
            userId,
            strategy: meta.strategy || 'Sniper',
            ladder,
            tpPercent,
            slPercent,
          });
          // Insert each rule individually.  Batch insertion could be
          // used but would complicate error handling.  Failures are
          // logged and processing continues.
          for (const rule of rules) {
            try {
              await prisma.tpSlRule.create({ data: rule });
            } catch (e) {
              console.warn('postTradeQueue: failed to insert TP/SL rule', e.message);
            }
          }
        }
        break;
      }
      case 'trail': {
        // Register a trailing stop rule.  We insert a single rule
        // with tpPercent = 0 and slPercent equal to the trailing
        // stop percentage.  The ladder is ignored for trailing stops.
        const trailingPct = Number(meta.trailingStopPct) || 0;
        if (trailingPct !== 0) {
          try {
            await prisma.tpSlRule.create({
              data: {
                id: uuid(),
                mint,
                walletId,
                userId,
                strategy: meta.strategy || 'Sniper',
                tp: null,
                sl: null,
                tpPercent: 0,
                slPercent: trailingPct,
                entryPrice: null,
                force: false,
                enabled: true,
                status: 'active',
                failCount: 0,
              },
            });
          } catch (e) {
            console.warn('postTradeQueue: failed to insert trailing stop', e.message);
          }
        }
        break;
      }
      case 'alerts': {
        // Send a simple alert informing the user that the staged
        // post‑trade chain has been executed.  In a real system
        // additional details could be included.  Errors are ignored.
        try {
          const msg = `📦 Post‑trade actions queued for token ${mint}`;
          await sendAlert('ui', msg, meta.category || 'Sniper');
        } catch (e) {
          console.warn('postTradeQueue: failed to send alert', e.message);
        }
        break;
      }
      default:
        // Unknown action – skip.
        break;
    }
  }
}

module.exports = {
  enqueue,
  process,
};