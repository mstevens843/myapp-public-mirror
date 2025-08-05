const { WebSocketServer } = require("ws");
const { startMockLogs } = require("./mockLogs"); // now backend path

const wss = new WebSocketServer({ port: 9001 });

wss.on("connection", (ws) =>
  startMockLogs((line) => ws.send(line)));
omg 