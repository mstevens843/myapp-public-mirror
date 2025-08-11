/**
 * Generic webhook notification provider
 *
 * Dispatches events to arbitrary HTTP endpoints. Expects the target URL to
 * be provided in meta.webhookUrl. The payload is sent as JSON. Retries are
 * attempted with exponential backoff on failure.
 */

const axios = require('axios');
const logger = require('../../../utils/logger');

async function send(userId, event, payload, meta) {
  const url = meta && meta.webhookUrl;
  if (!url) return;
  const data = { event, payload };
  let attempt = 0;
  const maxAttempts = 3;
  const sendAttempt = async () => {
    try {
      await axios.post(url, data);
    } catch (err) {
      attempt += 1;
      if (attempt < maxAttempts) {
        const delay = Math.pow(2, attempt) * 1000;
        setTimeout(sendAttempt, delay);
      } else {
        logger.error('Webhook notification failed', { url, err: err.message });
        throw err;
      }
    }
  };
  await sendAttempt();
}

module.exports = { send };