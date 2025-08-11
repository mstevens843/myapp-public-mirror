/**
 * Notification router
 *
 * Central notification dispatching for events. User preferences are stored
 * in the NotificationPreference table which defines which channels are
 * enabled for each event. Supported channels include Telegram, Email,
 * Slack and generic Webhooks. Each provider exposes a `send` method and
 * accepts a payload with minimal structure.
 */

const prisma = require('../../prisma/prisma');
const telegram = require('./providers/telegram');
const email = require('./providers/email');
const slack = require('./providers/slack');
const webhook = require('./providers/webhook');
const logger = require('../../utils/logger');

const providers = { telegram, email, slack, webhook };

/**
 * Dispatch a notification to all subscribed channels for the given user and
 * event. Retries and backoff are handled by providers internally. Errors
 * are logged but do not propagate.
 *
 * @param {string} userId
 * @param {string} event
 * @param {object} payload
 */
async function sendNotification(userId, event, payload = {}) {
  try {
    const prefs = await prisma.notificationPreference.findMany({ where: { userId, event, enabled: true } });
    if (!prefs || prefs.length === 0) return;
    await Promise.all(
      prefs.map(async (pref) => {
        const provider = providers[pref.channel];
        if (!provider) return;
        try {
          await provider.send(userId, event, payload, pref.metaJson || {});
        } catch (err) {
          logger.error('Notification dispatch failed', { userId, channel: pref.channel, err: err.message });
          // TODO: push to DLQ / retries
        }
      })
    );
  } catch (err) {
    logger.error('Notification routing error', { userId, event, err: err.message });
  }
}

module.exports = { sendNotification };