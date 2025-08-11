/**
 * Email notification provider
 *
 * Sends events via email. This implementation is a placeholder and should be
 * replaced with integration to a real email service (e.g. SendGrid, SES).
 */

const nodemailer = require('nodemailer');
const logger = require('../../../utils/logger');

// Configure a transporter from environment variables. In production you
// should use a proper SMTP or API based mailer.
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'localhost',
  port: parseInt(process.env.SMTP_PORT, 10) || 25,
  secure: false,
  auth: process.env.SMTP_USER
    ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    : undefined,
});

async function send(userId, event, payload, meta) {
  const to = meta && meta.email;
  if (!to) return;
  const subject = `[${event}] Notification`;
  const text = payload.message || JSON.stringify(payload);
  try {
    await transporter.sendMail({ from: process.env.EMAIL_FROM || 'noreply@example.com', to, subject, text });
  } catch (err) {
    logger.error('Email notification failed', { to, err: err.message });
    throw err;
  }
}

module.exports = { send };