require("dotenv").config({ path: __dirname + "/../../.env" });

console.log("RPC:", process.env.SOLANA_RPC_URL);