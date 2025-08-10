// tools/setPassword.js
const bcrypt = require("bcryptjs"); // ← swapped from bcrypt
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

(async () => {
  const email = "mathewstevens7457@gmail.com";
  const password = "Ivykins408!";
  const hash = await bcrypt.hash(password, 10);

  const user = await prisma.user.update({
    where: { email },
    data: { hashedPassword: hash },
  });

  console.log("✅ Updated password for:", user.email);
  process.exit();
})();
