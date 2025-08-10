/**
 * Emit structured safety-check logs through the shared `log()` helper.
 * Returns `true` if any check failed.
 */
function logSafetyResults(mint, result, logFn = () => {}, strategy = "strategy") {
  const emit = (lvl, msg) => logFn(lvl, msg);

  const safetyKeys = ["simulation", "liquidity", "authority", "topHolders", "verified"];
  emit("info", `Running safety checks for ${mint}`);

  for (const key of safetyKeys) {
    const res = result[key];
    if (!res) continue;

    emit("info", `${res.label} check running...`);
    if (res.passed) {
      emit("info", `${res.label} check passed`);
    } else {
      emit("error", `${res.label} check failed – ${res.reason}`);
      emit("warn",  `Skipping token ${mint} due to failed safety check`);
      return true;
    }
  }

  if (result.topHolderContract) {
    const res = result.topHolderContract;
    emit("info", `Top-holder contract result: ${res.detail || res.reason}`);
  }

  return false;
}

module.exports = { logSafetyResults };