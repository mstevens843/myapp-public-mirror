const SNIPER_LINES = [
  "[LOOP][sniper]  Sniper Tick @ 02:17:03",
  "[INFO][sniper]  Scanning 527 tokens...",
  "[INFO][sniper]  Token detected: 9r8h…Nc6a",
  "[INFO][sniper]  Fetching price change + volume…",
  "[WARN][sniper]  Skipped – Price change 1.14% below threshold 2%",
  "[INFO][sniper]  Token detected: 4hFx…GdPa",
  "[INFO][sniper]  Passed price/volume check",
  "[INFO][sniper]  Running safety checks…",
  "[ERROR][sniper] Swap failed – no route for token",
];

function startMockLogs(push, strategy = "sniper") {
  let i = 0;
  return setInterval(() => {
    push(SNIPER_LINES[i % SNIPER_LINES.length]);
    i += 1;
  }, 600);
}

module.exports = { startMockLogs };
