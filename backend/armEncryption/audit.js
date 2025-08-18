// backend/utils/audit.js
const prisma = require("../prisma/prisma");

async function audit(userId, event, meta) {
  try {
    await prisma.auditLog.create({
      data: { userId, event, meta: JSON.stringify(meta || {}) }
    });
  } catch (e) {
    // don't crash trades for audit issues
    console.warn("[audit] failed:", e.message);
  }
}
module.exports = { audit };
