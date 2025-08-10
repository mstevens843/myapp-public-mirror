const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient(); 
module.exports = prisma;

// const { PrismaClient } = require("@prisma/client");

// const FORCED_DB_URL = "postgresql://solpulse_tradebot_db_user:kHy2L6JODrtr3XpzbnkYQUzIRl4YsHLk@dpg-d1u6sp7diees73aeg00g-a.oregon-postgres.render.com/solpulse_tradebot_db";

// console.log("👀 FORCING DB URL:", FORCED_DB_URL);

// const prisma = new PrismaClient({
//   datasources: {
//     db: {
//       url: FORCED_DB_URL,
//     },
//   },
// });

// module.exports = prisma;
