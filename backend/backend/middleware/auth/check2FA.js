const speakeasy = require("speakeasy");
const prisma = require("../../prisma/prisma");

module.exports = async function check2FA(req, res, next) {
  try {
    const { user } = req; // requireAuth attaches { id, type }
    const { twoFactorToken } = req.body;

    if (!user) return res.status(401).json({ error: "Not authenticated" });

    /*
     * Load only the fields we care about. We fetch both require2faArm and
     * require2faLogin so that this middleware can be re‑used for endpoints
     * that need 2FA on arm/disarm actions as well as login flows. If a
     * consumer wishes to enforce login‑time 2FA they should still call
     * this middleware but ensure require2faLogin is enabled. When neither
     * flag is enabled the check is skipped entirely.
     */
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        is2FAEnabled: true,
        twoFactorSecret: true,
        require2faArm: true,
        require2faLogin: true,
      },
    });

    // If 2FA is not enabled globally or neither arm nor login requires 2FA,
    // skip the check. This allows users to enable 2FA but selectively
    // require it only on login or only when arming a wallet. When neither
    // flag is set the check is skipped.
    if (!dbUser.is2FAEnabled || (!dbUser.require2faArm && !dbUser.require2faLogin)) {
      return next();
    }

    // At this point a TOTP code is required to proceed. We return a 403
    // with a needs2FA flag when missing or invalid, as expected by the
    // frontend. A 403 status signals that the client should prompt the user
    // to enable or supply 2FA.
    if (!twoFactorToken) {
      return res.status(403).json({ needs2FA: true });
    }

    const verified = speakeasy.totp.verify({
      secret: dbUser.twoFactorSecret,
      encoding: "base32",
      token: twoFactorToken,
    });

    if (!verified) {
      return res.status(403).json({ needs2FA: true });
    }

    // ✅ Passed 2FA
    return next();
  } catch (err) {
    console.error("2FA middleware error:", err);
    return res.status(500).json({ error: "Server error validating 2FA" });
  }
};