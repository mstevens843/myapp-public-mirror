// backend/utils/secureSigner.js
const nacl = require('tweetnacl');
const sessionMgr = require('./armSessionManager');
const { decryptPrivateKey } = require('./armEncryption');

module.exports = function secureSign(userId, walletId, walletBlob, message) {
  const dek = sessionMgr.getDEK(userId, walletId);
  if (!dek) {
    const err = new Error('Automation disarmed – no active session');
    err.status = 401;
    err.code = 'AUTOMATION_NOT_ARMED';
    throw err;
  }
  const aad = `user:${userId}:wallet:${walletId}`;
  const pkBuf = decryptPrivateKey(walletBlob, dek, aad);
  const sig   = nacl.sign.detached(message, pkBuf);
  pkBuf.fill(0);
  return Buffer.from(sig);
};
