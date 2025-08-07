const speakeasy = require("speakeasy");
const prisma = require("../../prisma/prisma");

module.exports = async function check2FA(req, res, next) {
  try {
    const { user } = req;  // assuming requireAuth attached `req.user`
    const { twoFactorToken } = req.body;

    if (!user) return res.status(401).json({ error: "Not authenticated" });

    // Load user from DB to get secret + status
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        is2FAEnabled: true,
        twoFactorSecret: true
      }
    });

    if (!dbUser.is2FAEnabled) {
      // No 2FA required, skip check
      return next();
    }

    if (!twoFactorToken) {
      return res.status(400).json({ error: "2FA code required" });
    }

    const verified = speakeasy.totp.verify({
      secret: dbUser.twoFactorSecret,
      encoding: "base32",
      token: twoFactorToken
    });

    if (!verified) {
      return res.status(403).json({ error: "Invalid 2FA code" });
    }

    // ✅ Passed 2FA
    return next();
  } catch (err) {
    console.error("2FA middleware error:", err);
    return res.status(500).json({ error: "Server error validating 2FA" });
  }
}
