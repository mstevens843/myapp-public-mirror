const speakeasy = require("speakeasy");
const prisma = require("../../prisma/prisma");

module.exports = async function check2FA(req, res, next) {
  try {
    const { user } = req; // requireAuth attaches { id, type }
    const { twoFactorToken } = req.body;

    if (!user) return res.status(401).json({ error: "Not authenticated" });

    // Load only the fields we care about. We fetch require2faArm here to
    // determine whether this particular action demands a TOTP code. If a
    // consumer wishes to enforce login‑time 2FA they should implement that
    // logic separately (see auth.js). This middleware is primarily used
    // for protected actions such as arm/extend/disarm.
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        is2FAEnabled: true,
        twoFactorSecret: true,
        require2faArm: true,
      },
    });

    // If 2FA is not enabled globally or arm‑specific requirement is off,
    // short‑circuit to next handler. This allows users to enable 2FA but
    // selectively require it only on login (via require2faLogin) or only
    // when arming a wallet. When neither is set the check is skipped.
    if (!dbUser.is2FAEnabled || !dbUser.require2faArm) {
      return next();
    }

    // At this point a TOTP code is required to proceed.
    if (!twoFactorToken) {
      return res.status(400).json({ error: "2FA code required" });
    }

    const verified = speakeasy.totp.verify({
      secret: dbUser.twoFactorSecret,
      encoding: "base32",
      token: twoFactorToken,
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
};
