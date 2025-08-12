/**
 * Slack notification provider
 *
 * Sends events to a Slack channel via Incoming Webhook URL. Expects the
 * webhook URL to be stored in NotificationPreference.metaJson under
 * `webhookUrl`.
 */

const axios = require('axios');
const logger = require('../../../utils/logger');

async function send(userId, event, payload, meta) {
  const webhookUrl = meta && meta.webhookUrl;
  if (!webhookUrl) return;
  const message = {
    text: `*${event}* ${payload.message || ''}`,
  };
  try {
    await axios.post(webhookUrl, message);
  } catch (err) {
    logger.error('Slack notification failed', { err: err.message });
    throw err;
  }
}

module.exports = { send };