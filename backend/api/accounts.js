const express = require("express");
const bcrypt = require("bcryptjs");
const prisma = require("../prisma/prisma");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

// GET /account/profile
router.get("/profile", requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        username: true,
        is2FAEnabled: true,
        createdAt: true,
      },
    });

    if (!user) return res.status(404).json({ error: "User not found" });

    res.json(user);
  } catch (err) {
    console.error("Get profile error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// PATCH /account/profile
router.patch("/profile", requireAuth, async (req, res) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ error: "Username is required" });
    }

    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: { username },
    });

    res.json({ message: "Profile updated", username: updated.username });
  } catch (err) {
    console.error("Update profile error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /account/change-password
router.post("/change-password", requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // --- basic validation ---------------------------------------------------
    if (!currentPassword || !newPassword)
      return res.status(400).json({ error: "Both current & new passwords are required" });

    if (newPassword.length < 6)
      return res.status(400).json({ error: "New password must be ≥ 6 chars" });

    // --- verify current password -------------------------------------------
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { hashedPassword: true },
    });

    const valid = await bcrypt.compare(currentPassword, user.hashedPassword);
    if (!valid) return res.status(401).json({ error: "Current password is incorrect" });

    // --- hash + save new password ------------------------------------------
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: req.user.id },
        data: { hashedPassword, lastPasswordChangeAt: new Date() },
      }),
      // revoke every refresh token – forces re-auth everywhere
      prisma.refreshToken.deleteMany({ where: { userId: req.user.id } }),
    ]);

    res.json({ message: "Password changed successfully" });
  } catch (err) {
    console.error("Change password error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// DELETE /account/delete
router.delete("/delete", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    console.log(`⚠️ Deleting account and all related data for user: ${userId}`);

    // Delete child records first to avoid FK errors
    await prisma.refreshToken.deleteMany({ where: { userId } });
    await prisma.wallet.deleteMany({ where: { userId } });
    await prisma.trade.deleteMany({ where: { wallet: { userId } } });
    await prisma.closedTrade.deleteMany({ where: { wallet: { userId } } });
    await prisma.strategyConfig.deleteMany({ where: { wallet: { userId } } });
    await prisma.dcaOrder.deleteMany({ where: { userId } });
    await prisma.limitOrder.deleteMany({ where: { userId } });
    await prisma.tpSlRule.deleteMany({ where: { userId } });
    await prisma.scheduledStrategy.deleteMany({ where: { userId } });
    await prisma.telegramPreference.deleteMany({ where: { userId } });
    await prisma.userPreference.deleteMany({ where: { userId } });

    // Finally, delete user record
    await prisma.user.delete({ where: { id: userId } });

    console.log(`✅ Account and related data deleted for user: ${userId}`);
    res.json({ message: "Account and all related data deleted successfully" });
  } catch (err) {
    console.error("🔥 Delete account error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
