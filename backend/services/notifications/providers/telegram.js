/**
 * Telegram notification provider
 *
 * Sends events to a user via Telegram bot. Expects the user's chat ID to be
 * stored in the NotificationPreference.metaJson. Handles simple retries with
 * exponential backoff.
 */

const axios = require('axios');
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

async function send(userId, event, payload, meta) {
  const chatId = meta && meta.chatId;
  if (!chatId || !TELEGRAM_BOT_TOKEN) return;
  const message = `[${event}] ${payload.message || ''}`;
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const data = { chat_id: chatId, text: message, parse_mode: 'Markdown' };
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
        throw err;
      }
    }
  };
  await sendAttempt();
}

module.exports = { send };