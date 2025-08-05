const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "../../data/watchlist.json");

function read() {
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, "{}");
  return JSON.parse(fs.readFileSync(FILE, "utf-8"));
}

function save(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

function add(chatId, mint) {
  const data = read();
  if (!data[chatId]) data[chatId] = [];
  if (!data[chatId].includes(mint)) data[chatId].push(mint);
  save(data);
}

function get(chatId) {
  const data = read();
  return data[chatId] || [];
}

module.exports = { add, get };
