// services/limitManager.js

const fs = require("fs");
const path = require("path");

const LIMITS_PATH = path.join(__dirname, "../../data/limit-orders.json");


function readLimitOrdersFile() {
  if (!fs.existsSync(LIMITS_PATH)) return {};
  const data = fs.readFileSync(LIMITS_PATH, "utf-8");
  try {
    const parsed = JSON.parse(data);

    // Sanitize all prices
    for (const [userId, orders] of Object.entries(parsed)) {
      parsed[userId] = orders.map(order => ({
        ...order,
        price: parseFloat(order.price),
      }));
    }

    return parsed;
  } catch (err) {
    console.error("❌ Failed to parse limit orders file:", err.message);
    return {};
  }
}

function writeLimitOrdersFile(data) {
  fs.writeFileSync(LIMITS_PATH, JSON.stringify(data, null, 2));
}

async function getUserLimitOrders(userId) {
  const orders = readLimitOrdersFile();
  return orders[userId] || [];
}

async function addUserLimitOrder(userId, order) {
  const orders = readLimitOrdersFile();
  if (!orders[userId]) orders[userId] = [];
  orders[userId].push({
    ...order,
    price: parseFloat(order.price), // ensure it's a number, not string
  });  
  writeLimitOrdersFile(orders);
}

async function removeUserLimitOrder(userId, index) {
  const orders = readLimitOrdersFile();
  if (!orders[userId]) return;
  if (index < 0 || index >= orders[userId].length) return;

  orders[userId].splice(index, 1);
  writeLimitOrdersFile(orders);
}

module.exports = {
  getUserLimitOrders,
  addUserLimitOrder,
  removeUserLimitOrder,
  readLimitOrdersFile,
  writeLimitOrdersFile
};