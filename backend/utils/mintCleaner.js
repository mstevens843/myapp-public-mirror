const INVALID_RX = /[0OIl]/g;

module.exports = function cleanMint(raw = "") {
  return raw.replace(INVALID_RX, "");   // no length check, no bs58.decode
};