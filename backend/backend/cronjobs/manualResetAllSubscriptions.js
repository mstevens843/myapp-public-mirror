require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const prisma = require("../prisma/prisma");

async function resetUserUsage() {
  console.log("🧹 Resetting user usage counters…");

  const now = new Date();

  const result = await prisma.user.updateMany({
    data: {
      usage: 0,
      usageResetAt: now,
    },
  });

  console.log(`✅ Reset ${result.count} users at ${now.toISOString()}`);
  process.exit(0);
}

resetUserUsage().catch((err) => {
  console.error("❌ Failed to reset user usage:", err);
  process.exit(1);
});
