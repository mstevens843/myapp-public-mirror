/**
 * Emit structured safety-check logs through the shared `log()` helper.
 * Returns `true` if any check failed.
 */
function fmt0(n){ const x = Number(n); return Number.isFinite(x) ? x.toFixed(0) : "n/a"; }
function fmtPct(n){ const x = Number(n); return Number.isFinite(x) ? `${x.toFixed(2)}%` : "n/a"; }

function logSafetyResults(mint, result, logFn = () => {}, strategy = "strategy") {
  const emit = (lvl, msg) => logFn(lvl, msg);
  const keys = ["simulation","liquidity","authority","topHolders","verified"];

  emit("info", `[SAFETY] ▶ Running safety checks for ${mint}`);

  for (const key of keys) {
    const res = result[key];
    if (!res) continue;
    const skipped = res.reason === "Skipped" || res.skipped === true;
    if (skipped) { emit("info", `[SAFETY] ${res.label} — skipped`); continue; }

    switch (key) {
      case "liquidity": {
        const liq = Number(res?.data?.liquidity);
        const min = Number(res?.data?.min ?? 5000);
        const ok  = res.passed === true;
        emit(ok ? "info" : "warn",
          `[SAFETY] Liquidity: $${fmt0(liq)} ${ok ? "≥" : "<"} $${fmt0(min)} ${ok ? "✅ PASS" : "❌ FAIL"}`
        );
        if (!ok && res.detail) emit("warn", `[SAFETY] Liquidity detail: ${res.detail}`);
        break;
      }

      case "topHolders": {
        const p   = Number(res?.data?.topHolderPct);
        const thr = Number(res?.data?.thresholds?.top1 ?? 50);
        const ok  = res.passed === true;
        emit(ok ? "info" : "warn",
          `[SAFETY] Top holder: ${fmtPct(p)} ${ok ? "≤" : ">"} ${fmtPct(thr)} ${ok ? "✅ PASS" : "❌ FAIL"}`
        );
        const t5  = res?.data?.top5Pct, t10 = res?.data?.top10Pct, t20 = res?.data?.top20Pct, t50 = res?.data?.top50Pct;
        emit("debug",
          `[SAFETY] Concentration: top1=${fmtPct(p)}, top5=${fmtPct(t5)}, top10=${fmtPct(t10)}, top20=${fmtPct(t20)}, top50=${fmtPct(t50)} (tier: ${res?.data?.tier || "n/a"})`
        );
        if (!ok && res.detail) emit("warn", `[SAFETY] Holders detail: ${res.detail}`);
        break;
      }

      case "simulation": {
        // align with jupiterSimulationCheck.js data keys
        const imp    = Number(res?.data?.priceImpactPct);
        const maxImp = Number(res?.data?.maxImpactPct ?? 5);
        const out    = Number(res?.data?.outAmountTokens);
        const minOut = Number(res?.data?.minExpectedOutput ?? 5);
        const ok     = res.passed === true;

        emit(ok ? "info" : "warn",
          `[SAFETY] Simulation: impact ${fmtPct(imp)} ${(imp <= maxImp) ? "≤" : ">"} ${fmtPct(maxImp)}, out ${fmt0(out)} ${(out >= minOut) ? "≥" : "<"} ${fmt0(minOut)} ${ok ? "✅ PASS" : "❌ FAIL"}`
        );

        // small route proof for debugging
        const hops  = res?.data?.routeHops;
        const dexes = Array.isArray(res?.data?.dexes) ? res.data.dexes.join("→") : null;
        if (hops != null || dexes) {
          emit("debug", `[SAFETY] Route: hops=${hops ?? "n/a"}${dexes ? ` [${dexes}]` : ""}`);
        }

        if (!ok && res.detail) emit("warn", `[SAFETY] Simulation detail: ${res.detail}`);
        break;
      }

      case "authority": {
        const src      = res?.source || res?.data?.source || "unknown";
        // prefer structured data if present
        const mintAuth = res?.data?.mintAuthority ?? (res?.detail && typeof res.detail === "object" ? res.detail.mint : null);
        const freeze   = res?.data?.freezeAuthority ?? (res?.detail && typeof res.detail === "object" ? res.detail.freeze : null);
        const ok       = res.passed === true;

        emit(ok ? "info" : "warn",
          `[SAFETY] Mint/Freeze: mint=${mintAuth ?? "null"}, freeze=${freeze ?? "null"} (source: ${src}) ${ok ? "✅ PASS" : "❌ FAIL"}`
        );
        if (!ok && res.detail && typeof res.detail !== "object") emit("warn", `[SAFETY] Authority detail: ${res.detail}`);
        break;
      }

      default: {
        emit(res.passed ? "info" : "warn",
          `[SAFETY] ${res.label || key}: ${res.passed ? "✅ PASS" : "❌ FAIL"}${res.detail ? ` — ${res.detail}` : ""}`
        );
      }
    }

    if (!res.passed) {
      emit("warn", `[SAFETY] Skipping token ${mint} due to failed ${res.label || key}`);
      return true; // ⛔ preserve existing early-exit behavior
    }
  }

  emit("info", `[SAFETY] ✔ All enabled safety checks passed`);
  return false;
}

module.exports = { logSafetyResults };
