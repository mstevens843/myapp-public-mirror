// utils/price.js
const axios = require("axios");

const API_BASE = "https://lite-api.jup.ag";

async function getPrice(mint) {
  try {
    const res = await axios.get(`${API_BASE}/price?ids=${mint}`);
    const data = res.data.data[mint];
    if (!data) throw new Error("Price not found.");
    return data.price;
  } catch (err) {
    console.error("❌ getPrice error:", err.message);
    return null;
  }
}

module.exports = { getPrice };
