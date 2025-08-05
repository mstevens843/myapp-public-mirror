require("dotenv").config({ path: __dirname + "/../../.env" });

const { getBirdeyeDefiPrice } = require("../utils/birdeye");

getBirdeyeDefiPrice("So11111111111111111111111111111111111111112").then(console.log);
