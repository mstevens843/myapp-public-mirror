/**
 * Stuck order watchdog
 *
 * Scans for pending orders that appear stuck or unconfirmed beyond a
 * configurable threshold. The watchdog can automatically cancel and
 * re-broadcast transactions with higher priority fees or hedge the
 * position based on the configured policy. It emits alerts via the
 * notifications service when actions are taken or retries are exhausted.
 */

const prisma = require('../../prisma/prisma');
const { sendNotification } = require('../notifications');
const logger = require('../../utils/logger');

const MAX_PENDING_SLOTS = parseInt(process.env.WATCHDOG_MAX_PENDING_SLOTS || '30', 10);
const MAX_PENDING_SECONDS = parseInt(process.env.WATCHDOG_MAX_PENDING_SECONDS || '120', 10);
const MAX_REPLACE_ATTEMPTS = parseInt(process.env.WATCHDOG_MAX_REPLACE_ATTEMPTS || '3', 10);

async function checkStuckOrders() {
  // Query for open trades/orders that are pending longer than thresholds.
  // The exact schema depends on your Trade/Order models. Here we assume a
  // Trade model with `status`, `createdAt`, `slot` and a `retries` field.
  const now = new Date();
  const thresholdTime = new Date(now - MAX_PENDING_SECONDS * 1000);
  const stuckOrders = await prisma.trade.findMany({
    where: {
      status: 'pending',
      OR: [
        { createdAt: { lt: thresholdTime } },
        { slot: { lt: (await getCurrentSlot()) - MAX_PENDING_SLOTS } },
      ],
    },
  });
  for (const order of stuckOrders) {
    try {
      if ((order.retries || 0) >= MAX_REPLACE_ATTEMPTS) {
        await prisma.trade.update({ where: { id: order.id }, data: { status: 'failed' } });
        await sendNotification(order.userId, 'STUCK_ORDER_FAILED', { message: `Order ${order.id} failed after retries.` });
        logger.warn(`Stuck order ${order.id} failed after max retries`);
        continue;
      }
      // Cancel and replace the transaction with bumped priority fee. Real
      // implementation would interact with Solana RPC.
      await cancelAndReplace(order);
      await prisma.trade.update({ where: { id: order.id }, data: { retries: (order.retries || 0) + 1 } });
      await sendNotification(order.userId, 'STUCK_ORDER_REPLACED', { message: `Order ${order.id} replaced with higher priority.` });
      logger.info(`Replaced stuck order ${order.id}`);
    } catch (err) {
      logger.error('Error handling stuck order', { id: order.id, err: err.message });
    }
  }
}

async function getCurrentSlot() {
  // Placeholder. Would normally query Solana RPC for current slot.
  return 0;
}

async function cancelAndReplace(order) {
  // Placeholder for cancel and replace logic. Interact with RPC pool to
  // cancel existing tx and send a replacement with bumped priority fee.
  return;
}

/**
 * Start the watchdog loop on an interval (default 30s). Returns a
 * function to stop the loop.
 */
function startWatchdog(intervalMs = 30000) {
  const handle = setInterval(() => {
    checkStuckOrders().catch((err) => logger.error('Watchdog error', { err: err.message }));
  }, intervalMs);
  logger.info('Stuck order watchdog started');
  return () => clearInterval(handle);
}

module.exports = { startWatchdog, checkStuckOrders };