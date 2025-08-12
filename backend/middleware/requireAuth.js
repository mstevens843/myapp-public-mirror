// backend/middleware/requireAuth.js

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const jwt = require('jsonwebtoken');
const prisma = require('../prisma/prisma');

const JWT_SECRET = process.env.JWT_SECRET;

/**
 * requireAuth
 *
 * 🧠 Accepts BOTH:
 *   - Authorization: Bearer <jwt>
 *   - Cookie: __Host-access_token (new) OR access_token (legacy)
 *
 * ✅ Legacy support:
 *   - If token has `userId` (old) instead of `id`, look up the user and
 *     upgrade the claim in-memory; optionally emit a fresh Authorization header.
 *
 * 🔧 Optional (disabled by default):
 *   - Header fallback `x-user-id` when `ALLOW_HEADER_USER_ID=true` (useful for
 *     internal jobs/tests). Not used in production unless explicitly enabled.
 *
 * 🔐 Notes:
 *   - No breaking change to your public surface.
 *   - Preserves original behavior; only adds optional header fallback.
 */
async function requireAuth(req, res, next) {
  // Accept Bearer or cookie tokens
  const bearer =
    req.headers.authorization && req.headers.authorization.startsWith('Bearer ')
      ? req.headers.authorization.split(' ')[1]
      : null;

  const cookieToken =
    (req.cookies && (req.cookies['__Host-access_token'] || req.cookies['access_token'])) || null;

  const token = bearer || cookieToken;

  // Optional dev/internal fallback: allow x-user-id if explicitly enabled
  if (!token) {
    const allowHeaderUid =
      String(process.env.ALLOW_HEADER_USER_ID || '').trim().toLowerCase() === 'true';
    const headerUid = (req.get('x-user-id') || '').trim();
    if (allowHeaderUid && headerUid) {
      req.authToken = null;
      req.user = { id: headerUid, type: 'header' };
      return next();
    }
    return res.status(401).json({ error: 'Missing auth token' });
  }

  try {
    // Verify without enforcing aud/iss for legacy compatibility
    let decoded = jwt.verify(token, JWT_SECRET);

    // Legacy support: token contains userId instead of id
    if (!decoded.id && decoded.userId) {
      const u = await prisma.user.findUnique({
        where: { userId: decoded.userId },
        select: { id: true },
      });

      if (!u) return res.status(401).json({ error: 'Invalid token' });

      decoded.id = u.id;

      // Optionally refresh upgraded token (non-breaking)
      try {
        const fresh = jwt.sign(
          { id: u.id, type: decoded.type || 'web3' },
          JWT_SECRET,
          { expiresIn: '30d' }
        );
        res.setHeader('Authorization', `Bearer ${fresh}`);
      } catch (_) {}
    }

    // Expose token for downstream actions/log correlation
    req.authToken = token;
    req.user = { id: decoded.id, type: decoded.type };

    return next();
  } catch (err) {
    console.error('🔒 Auth middleware error:', err.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = requireAuth;
