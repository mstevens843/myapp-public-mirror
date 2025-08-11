/**
 * Refresh token store
 *
 * This module encapsulates the persistence logic for refresh tokens and
 * implements rotation and reuse detection semantics. A refresh token carries a
 * unique `jti` (JWT ID) and a `familyId` which groups successive tokens
 * generated from the same login. Each time a refresh token is used it is
 * rotated: the current token is invalidated and a new one is issued. If a
 * client attempts to reuse an already-rotated token the entire family is
 * revoked and the user is forced to re-authenticate. All actions are
 * recorded in the SecurityAuditLog table via the audit logger.
 */

const { v4: uuidv4 } = require('uuid');
const prisma = require('../../prisma/prisma');
const audit = require('./auditLog');
const logger = require('../../utils/logger');

/**
 * Issue a new refresh token for a user. Generates a new familyId when no
 * previous familyId is provided (new login). Returns an object containing
 * { jti, familyId, expiresAt }. The caller is responsible for signing
 * the JWT and returning it to the client. Optional userAgent and ip can
 * be provided for security auditing.
 *
 * @param {string} userId
 * @param {string} [familyId]
 * @param {Date} [expiresAt]
 * @param {object} [opts]
 */
async function issueToken(userId, familyId = uuidv4(), expiresAt, opts = {}) {
  const jti = uuidv4();
  const exp = expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // default 30d
  await prisma.refreshTokenV2.create({
    data: {
      userId,
      jti,
      familyId,
      expiresAt: exp,
      revokedAt: null,
      createdAt: new Date(),
      userAgent: opts.userAgent || null,
      ip: opts.ip || null,
      walletId: opts.walletId || null,
    },
  });
  await audit.logSecurityEvent(userId, 'REFRESH_TOKEN_ISSUED', { jti, familyId });
  return { jti, familyId, expiresAt: exp };
}

/**
 * Rotate an existing refresh token. Marks the current token as revoked and
 * inserts a new token with the same familyId. Returns the new jti.
 *
 * @param {string} userId
 * @param {string} currentJti
 */
async function rotateToken(userId, currentJti) {
  // Find the current token
  const current = await prisma.refreshTokenV2.findUnique({ where: { jti: currentJti } });
  if (!current || current.revokedAt) {
    throw new Error('Invalid refresh token');
  }
  // Revoke current token
  await prisma.refreshTokenV2.update({
    where: { jti: currentJti },
    data: { revokedAt: new Date() },
  });
  // Issue new token within same family
  const { jti: newJti } = await issueToken(userId, current.familyId);
  await audit.logSecurityEvent(userId, 'REFRESH_TOKEN_ROTATED', { oldJti: currentJti, newJti });
  return newJti;
}

/**
 * Validate a refresh token. Detects reuse and rotation semantics. If the
 * provided token has been revoked the entire family is revoked, a security
 * event is logged and null is returned. Otherwise returns the token record.
 *
 * @param {string} jti
 */
async function validateToken(jti) {
  const token = await prisma.refreshTokenV2.findUnique({ where: { jti } });
  if (!token) return null;
  if (token.revokedAt) {
    // Reuse attempt: revoke entire family
    await prisma.refreshTokenV2.updateMany({
      where: { familyId: token.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await audit.logSecurityEvent(token.userId, 'REFRESH_TOKEN_REUSE', { jti, familyId: token.familyId });
    return null;
  }
  // Check expiry
  if (token.expiresAt && new Date(token.expiresAt) < new Date()) {
    await prisma.refreshTokenV2.update({ where: { jti }, data: { revokedAt: new Date() } });
    return null;
  }
  return token;
}

module.exports = { issueToken, rotateToken, validateToken };