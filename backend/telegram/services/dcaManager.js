const fs = require("fs");
const path = require("path");
const { executeImmediateDcaBuy } = require("../../services/dcaExecutor");

const DCA_FILE = path.join(__dirname, "../../data/dca-orders.json");

function loadAllOrders() {
  if (!fs.existsSync(DCA_FILE)) return {};
  return JSON.parse(fs.readFileSync(DCA_FILE, "utf8"));
}

function saveAllOrders(data) {
  fs.writeFileSync(DCA_FILE, JSON.stringify(data, null, 2));
}

function getUserDcaOrders(chatId) {
  const all = loadAllOrders();
  return all[chatId] || [];
}

function addUserDcaOrder(chatId, order) {
  const all = loadAllOrders();
  if (!all[chatId]) all[chatId] = [];
  all[chatId].push(order);
  saveAllOrders(all);

  // 🧠 Immediately trigger first buy
  executeImmediateDcaBuy(chatId, order);
}

function removeUserDcaOrder(chatId, index) {
  const all = loadAllOrders();
  if (!all[chatId]) return;
  all[chatId].splice(index, 1);
  saveAllOrders(all);
}

module.exports = {
  getUserDcaOrders,
  addUserDcaOrder,
  loadAllOrders,
  saveAllOrders,
  removeUserDcaOrder,
};
