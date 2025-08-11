/**
 * Security audit logger
 *
 * Append-only audit log that records all security-sensitive events. Each row
 * includes a timestamp, userId, type and metadata. An HMAC chain ensures
 * tamper-evidence: the hash of each row is computed from the previous row's
 * hash (or empty string for the first row) concatenated with the canonical
 * JSON representation of the event. A secret key provided in environment
 * variable AUDIT_HMAC_SECRET is used as the HMAC key. If the secret changes
 * the chain will no longer be verifiable so it should be rotated carefully.
 */

const crypto = require('crypto');
const prisma = require('../../prisma/prisma');
const logger = require('../../utils/logger');

const HMAC_SECRET = process.env.AUDIT_HMAC_SECRET || 'default-secret-change-me';

/**
 * Compute HMAC-SHA256 digest for a given input.
 *
 * @param {string} input
 */
function hmac(input) {
  return crypto.createHmac('sha256', HMAC_SECRET).update(input).digest('hex');
}

/**
 * Canonicalize a JSON object into a stable string. Keys are sorted to
 * guarantee deterministic hashes.
 *
 * @param {object} obj
 */
function canonicalJson(obj) {
  if (obj == null) return '';
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(obj[k])}`);
  return `{${parts.join(',')}}`;
}

/**
 * Append an event to the audit log. Computes the chain hash by looking up
 * the most recent entry for the same user. If none exists the previous hash
 * is the empty string. Metadata should be a plain object; it will be
 * canonicalised.
 *
 * @param {string} userId
 * @param {string} type
 * @param {object} meta
 */
async function logSecurityEvent(userId, type, meta = {}) {
  const last = await prisma.securityAuditLog.findFirst({
    where: { userId },
    orderBy: { ts: 'desc' },
  });
  const prevHash = last ? last.hash : '';
  const canonical = canonicalJson(meta);
  const input = `${prevHash}|${type}|${canonical}`;
  const hash = hmac(input);
  await prisma.securityAuditLog.create({
    data: {
      userId,
      type,
      metaJson: meta,
      prevHash,
      hash,
      ts: new Date(),
    },
  });
  logger.info('Security event logged', { userId, type });
}

module.exports = { logSecurityEvent };