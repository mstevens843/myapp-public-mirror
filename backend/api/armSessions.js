// backend/api/armSession.js
const express = require('express');
const { body, validationResult } = require('express-validator');
const sessionMgr = require('../services/armSessionManager');
const { unwrapDEK } = require('../utils/encryption/armEncryption');

// Replace this with your real 2FA verification
const verify2FA = async (userId, code) => true;

const router = express.Router();
const TTL_PRESETS = { '2h': 2 * 60 * 60 * 1000, '4h': 4 * 60 * 60 * 1000, '8h': 8 * 60 * 60 * 1000 };

router.post('/start', [
  body('walletId').notEmpty(),
  body('passphrase').isString().isLength({ min: 1 }),
  body('ttl').isString(),
  body('code').isString().optional(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: 'Invalid params', details: errors.array() });
  const { user } = req;
  const { walletId, passphrase, ttl, ttlMs, code } = req.body;
  if (!(await verify2FA(user.id, code)))
    return res.status(401).json({ error: 'Invalid 2FA code' });
  const wallet = await req.prisma.wallet.findUnique({ where: { id: walletId, userId: user.id } });
  if (!wallet || !wallet.isProtected)
    return res.status(400).json({ error: 'Wallet not protected or not found' });
  const dek = await unwrapDEK(wallet, passphrase);
  const ttlFinal = ttl === 'custom'
    ? Math.min(Math.max(Number(ttlMs), 5 * 60 * 1000), 24 * 60 * 60 * 1000)
    : (TTL_PRESETS[ttl] || TTL_PRESETS['4h']);
  sessionMgr.arm(user.id, walletId, dek, ttlFinal);
  res.json({
    walletId,
    label: wallet.label,
    expiresAt: Date.now() + ttlFinal,
  });
});

router.post('/extend', [
  body('walletId').notEmpty(),
  body('ttl').isString(),
  body('code').isString().optional(),
], async (req, res) => {
  const { user } = req;
  const { walletId, ttl, code } = req.body;
  if (!(await verify2FA(user.id, code)))
    return res.status(401).json({ error: 'Invalid 2FA code' });
  const extraMs = TTL_PRESETS[ttl] || TTL_PRESETS['2h'];
  const ok = sessionMgr.extend(user.id, walletId, extraMs);
  if (!ok) return res.status(400).json({ error: 'No active session to extend' });
  res.json({ expiresAt: Date.now() + extraMs });
});

router.post('/disarm', [
  body('walletId').notEmpty(),
  body('code').isString().optional(),
], async (req, res) => {
  const { user } = req;
  const { walletId, code } = req.body;
  if (!(await verify2FA(user.id, code)))
    return res.status(401).json({ error: 'Invalid 2FA code' });
  sessionMgr.disarm(user.id, walletId);
  res.json({ ok: true });
});

// GET /arm-session/status/:walletId
// Returns whether the session is armed and milliseconds left.
router.get('/status/:walletId', requireAuth, async (req, res) => {
  const { walletId } = req.params;
  if (!walletId) return res.status(400).json({ error: 'walletId required' });
  const { armed, msLeft } = sessionMgr.status(req.user.id, walletId);
  return res.json({ walletId, armed, msLeft });
});


module.exports = router;
