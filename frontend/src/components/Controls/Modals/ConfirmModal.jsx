/* ------------------------------------------------------------------
   ConfirmModal.jsx – single “are you sure?” dialog for trades/bots
   v4 • Strategy allowlists + smarter filtering + mint shortener
-------------------------------------------------------------------*/

import * as Dialog from "@radix-ui/react-dialog";
import { Check, X } from "lucide-react";
import { useEffect, useRef } from "react";

/* ---------- format helpers ---------- */
function formatSol(v){ const f=v.toFixed(3); return f.replace(/(\.\d*?[1-9])0+$/,"$1").replace(/\.0+$/,""); }
function pct(v){ return `${v}%`; }
function lamports(v){ return `${v} lamports`; }
function n(v){ return v.toLocaleString(); }
function usd(v){ return `$${Number(v).toLocaleString()}`; }
function sol(v){ return Number(v).toFixed(2); }
function ms(v){ return `${Math.round(+v / 1000)} s`; }
function s(v){ return `${v}`; }
function bool(v){ return v ? "Yes" : "No"; }
function formatMint(mint){ return mint?.slice(0,4)+"…"+mint?.slice(-4); }

/* interpret interval that might be in sec or ms */
function fmtInterval(value){
  const num = +value;
  if (isNaN(num)) return "—";
  // Heuristic: if >= 1000 assume ms, else assume sec
  const secs = num >= 1000 ? Math.round(num/1000) : num;
  return `${secs} sec`;
}

/* ---------- spend string ---------- */
function fmtSpend({ config, inputAmount, strategy }) {
  if (strategy === "stealthBot") {
    const per = parseFloat(config.positionSize ?? 0);
    const walletCount = Array.isArray(config.wallets)
      ? config.wallets.length
      : parseInt(config.walletCount ?? 1, 10);
    const total = per * walletCount;
    return `${total.toFixed(2)} SOL (${formatSol(per)} per wallet)`;
  }

  const per = parseFloat(
    config.amountToSpend ??
    config.maxSpendPerToken ??
    config.snipeAmount ??
    inputAmount ?? 0
  );

  /* 👉 Manual trades: just the raw amount, no suffix */
  if (normalize(strategy) === "manual") {
    return `${per.toFixed(2)} SOL`;
  }

  const trades = parseInt(config.maxTrades ?? 1, 10);
  const total  = per * trades;

  /* Only append “per trade” when trades > 1 */
  return trades > 1
    ? `${total.toFixed(2)} SOL (${formatSol(per)} per trade)`
    : `${per.toFixed(2)} SOL`;
}


/* ---------- display maps ---------- */
export const coreFieldMap = {
  amountToSpend       : { label: "Spend",               color: "text-emerald-300" },
  snipeAmount         : { label: "Spend",               color: "text-emerald-300" },
  slippage            : { label: "Slippage",            color: "text-purple-300", format: pct },
  interval            : { label: "Trade Interval",      color: "text-cyan-300",   format: fmtInterval },
  maxTrades           : { label: "Max Trades",          color: "text-blue-300" },
  priorityFeeLamports : { label: "Priority Fee",        color: "text-fuchsia-300",format: lamports },
  takeProfit          : { label: "Take-Profit",         color: "text-yellow-300", format: pct },
  stopLoss            : { label: "Stop-Loss",           color: "text-red-400",    format: pct },
  tpPercent           : { label: "TP Sell %",           color: "text-yellow-300", format: pct },
  slPercent           : { label: "SL Sell %",           color: "text-red-400",    format: pct },
};

/* Strategy Settings */
export const strategyFieldMap = {
  entryThreshold        : { label: "Entry Threshold %",    color: "text-yellow-300", format: pct },
  volumeThreshold       : { label: "Volume Threshold",     color: "text-orange-300", format: usd,   },
  priceWindow           : { label: "Price Window",         color: "text-blue-300" },
  volumeWindow          : { label: "Volume Window",        color: "text-blue-300" },
  delayMs               : { label: "Delay",                color: "text-cyan-300",   format: ms },
  dipThreshold          : { label: "Dip Threshold %",      color: "text-rose-300",   format: pct },
  recoveryWindow        : { label: "Recovery Window",      color: "text-blue-300" },
  breakoutThreshold     : { label: "Breakout Threshold %", color: "text-yellow-300", format: pct },
  trendWindow           : { label: "Trend Window",         color: "text-blue-300" },
  minTokenAgeMinutes    : { label: "Min Token Age m",      color: "text-indigo-300" },
  maxTokenAgeMinutes    : { label: "Max Token Age m",      color: "text-indigo-300" },
  minVolumeRequired     : { label: "Min Volume USD",       color: "text-orange-300", format: usd },
  slippageMaxPct        : { label: "Slippage Max %",       color: "text-purple-300", format: pct },
  feeEscalationLamports : { label: "Fee Escalation",       color: "text-fuchsia-300",format: lamports },
  panicDumpPct          : { label: "Panic-Dump %",         color: "text-red-400",    format: pct },
  outputMint            : { label: "Target Mint",          color: "text-fuchsia-300",format: formatMint },
  outputMints           : { label: "Target Mints",         color: "text-fuchsia-300",format: a=>Array.isArray(a)?`${a.length} mints`:formatMint(a) },
  maxSpendPerToken      : { label: "Max/Token Spend",      color: "text-emerald-300",format: sol },
  rebalanceThreshold    : { label: "Rebalance Δ %",        color: "text-yellow-300", format: pct },
  rebalanceInterval     : { label: "Rebalance Every",      color: "text-cyan-300",   format: ms },
  maxRebalances         : { label: "Max Rebalances",       color: "text-blue-300" },
targetAllocations       : { label: "Target Allocations",   color: "text-fuchsia-300", format: (obj) => obj && typeof obj === "object" ? (<div className="flex flex-col items-end">
            {Object.entries(obj).map(([mint, percent]) => (
              <span key={mint}>
                {formatMint(mint)}: {percent}%
              </span>
            ))}
          </div>
        )
      : "???",
},
outputMints: {
  label: "Target Mints",
  color: "text-fuchsia-300",
  format: (arr) =>
    Array.isArray(arr)
      ? (
          <div className="flex flex-col items-end">
            {arr.map((mint, i) => (
              <span key={i}>{formatMint(mint)}</span>
            ))}
          </div>
        )
      : "???",
},
targetTokens: {
  label: "Target Tokens",
  color: "text-yellow-300",
  format: (val) =>
    typeof val === "string"
      ? (
          <div className="flex flex-col items-end">
            {val
              .split(/[\n,]+/)
              .map((mint) => mint.trim())
              .filter(Boolean)
              .map((mint, i) => (
                <span key={i}>{formatMint(mint)}</span>
              ))}
          </div>
        )
      : "—",
},
  rotationInterval      : { label: "Rotation Every",       color: "text-cyan-300",   format: ms },
  priceChangeWindow     : { label: "Price-Change Window",  color: "text-blue-300" },
  minMomentum           : { label: "Min Momentum %",       color: "text-yellow-300", format: pct },
  positionSize          : { label: "Position Size SOL",    color: "text-emerald-300",format: sol },
  cooldown              : { label: "Cooldown s",           color: "text-orange-300", format: s },
  maxRotations          : { label: "Max Rotations",        color: "text-blue-300" },
  tokenMint             : { label: "Target Mint",          color: "text-fuchsia-300",format: formatMint },
  sizeJitterPct         : { label: "Size Jitter %",        color: "text-yellow-300", format: pct },
  delayMinMs            : { label: "Delay Min",            color: "text-cyan-300",   format: ms },
  delayMaxMs            : { label: "Delay Max",            color: "text-cyan-300",   format: ms },
  skipIfHolding         : { label: "Skip if Holding",      color: "text-indigo-300", format: bool },
  tokens                : { label: "Token List",           color: "text-fuchsia-300",format: a=>`${a.length} mints` },
  monitoredTokens       : { label: "Token List",           color: "text-fuchsia-300",format: a=>`${a.length} mints` },
  sectors               : { label: "Sectors",              color: "text-fuchsia-300",format: a=>a.join(", ") },
  // volumeFloor           : { label: "Volume Floor",          color: "text-orange-300", format: n },
};

/* Advanced Config */
export const advancedFieldMap = {
  maxSlippage        : { label: "Max Slippage %",        color: "text-purple-300", format: pct },
  haltOnFailures     : { label: "Halt on Failures",      color: "text-orange-300" },
  cooldown           : { label: "Per-Token Cooldown s",  color: "text-orange-300", format: s },
  autoSell           : { label: "Auto-Sell",             color: "text-emerald-300",format: bool },
  autoWallet         : { label: "Auto-Wallet",           color: "text-emerald-300",format: bool },
  dryRun             : { label: "Dry-Run Mode",          color: "text-indigo-300", format: bool },
  maxMarketCap       : { label: "Max MCap USD",          color: "text-orange-300", format: usd },
  minMarketCap       : { label: "Min MCap USD",          color: "text-orange-300", format: usd },
  maxTokenAgeMinutes : { label: "Max Token Age m",       color: "text-indigo-300" },
  minTokenAgeMinutes : { label: "Min Token Age m",       color: "text-indigo-300" },
};

/* Which keys to show for each strategy */
const STRATEGY_ALLOW = {
  sniper      : ["entryThreshold","volumeThreshold","priceWindow","volumeWindow","minTokenAgeMinutes","maxTokenAgeMinutes"],
  scalper     : ["entryThreshold","priceWindow","volumeThreshold","volumeWindow"],
  dipBuyer    : ["dipThreshold","recoveryWindow","volumeWindow","volumeThreshold"],
  breakout    : ["breakoutThreshold","volumeThreshold","volumeWindow","priceWindow"],
  trendFollower: ["entryThreshold","volumeThreshold","trendWindow","priceWindow","volumeWindow"],
  delayedSniper: ["delayMs","entryThreshold","volumeThreshold","priceWindow","volumeWindow","minTokenAgeMinutes","maxTokenAgeMinutes"],
  chadMode    : ["outputMint","outputMints","minVolumeRequired","slippageMaxPct","feeEscalationLamports","panicDumpPct"],
  rebalancer  : ["rebalanceThreshold","rebalanceInterval","maxRebalances","targetAllocations"],
  rotationBot : ["rotationInterval","priceChangeWindow","minMomentum","positionSize","cooldown","maxRotations","tokens","sectors"],
  paperTrader : ["outputMint","maxSpendPerToken","entryThreshold","volumeThreshold","priceWindow","volumeWindow","minTokenAgeMinutes","maxTokenAgeMinutes"],
  stealthBot  : ["tokenMint","positionSize","slippage","maxSlippage","priorityFeeLamports","dryRun","wallets"],
  manual      : [],
};

/* Advanced allowed keys per strategy */
const ADV_ALLOW = {
  sniper      : ["maxSlippage","haltOnFailures","minMarketCap","maxMarketCap"],
  scalper     : ["maxSlippage","haltOnFailures","minMarketCap","maxMarketCap","cooldown"],
  dipBuyer    : ["maxSlippage","haltOnFailures","minMarketCap","maxMarketCap","cooldown"],
  breakout    : ["maxSlippage","haltOnFailures","minMarketCap","maxMarketCap"],
  trendFollower: ["maxSlippage","haltOnFailures","minMarketCap","maxMarketCap"],
  delayedSniper: ["maxSlippage","haltOnFailures","minMarketCap","maxMarketCap"],
  chadMode    : ["maxSlippage","haltOnFailures","autoSell","dryRun"],
  rebalancer  : ["maxSlippage","haltOnFailures","autoWallet","dryRun"],
  rotationBot : ["maxSlippage","haltOnFailures","cooldown"],
  paperTrader : ["maxSlippage","haltOnFailures","dryRun","minMarketCap","maxMarketCap"],
  stealthBot  : ["maxSlippage","haltOnFailures","dryRun"],
  manual      : [],
};

/* generic "is empty?" check */
/* ---------- tweak: loosen empty check ---------- */
function isEmptyVal(v){
  return (
    v === null ||
    v === undefined ||
    v === "" ||
    (Array.isArray(v) && v.length === 0) ||
    (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0)
  );
}

/* ---------- helper: build filtered cfg ---------- */
function normalizeStrategyKey(str) {
  if (!str) return "";
  return str.toLowerCase().replace(/\s+/g, "");
}

function buildCfg(cfg, allowMap, fieldMap, rawStrategy) {
  const strategyKey = normalize(rawStrategy); // uses your inline normalize
  const allowKeys = Object.entries(allowMap).find(
    ([k]) => normalize(k) === strategyKey
  )?.[1];

  const keys = Array.isArray(allowKeys) && allowKeys.length
    ? allowKeys
    : Object.keys(fieldMap);

  return Object.fromEntries(
    keys
      .filter(k => k in cfg && !isEmptyVal(cfg[k]))
      .map(k => [k, cfg[k]])
  );
}

/* filter config to allowed keys */
function pickCfg(cfg, keys){
  const out = {};
  keys.forEach(k=>{
    if (k in cfg && !isEmptyVal(cfg[k])) out[k] = cfg[k];
  });
  return out;
}

/* render rows */
function renderRows(cfg,map){
  return Object.entries(cfg).map(([k,v])=>{
    const def = map[k];
    if(!def) return null;
    const {label,color,format}=def;
    return (
      <div key={k} className="flex justify-between">
        <span className="text-zinc-400">{label}</span>
        <span className={`${color ?? "text-white"} font-semibold`} title={typeof v==="string"?v:""}>
          {format ? format(v) : v.toString()}
        </span>
      </div>
    );
  });
}

const shortenedToken=(mint)=>`${mint.slice(0,4)}…${mint.slice(-4)}`;
 const normalize = (s = "") => s.toLowerCase().replace(/\s+/g, "");
  const fmtUsd=(num)=>`$${(+num).toLocaleString()}`;

/* ------------------------------------------------------------------ */
export default function ConfirmModal({
  strategy = "manual",
  title = "Confirm Trade",
  tradeType = "BUY",
  tokenSymbol = "???",
  inputAmount = 0,
  percent = 0,  
  expectedOutput = null,
  priceImpact = null,
  slippage = 1,
  priorityFee = 0,
  takeProfit = null,
  stopLoss = null,
  scheduleISO = null,
  config = {},
  onResolve,
  message = null,
}){
  const cancelBtn=useRef(null);
  const resolved=useRef(false);
  const close=(ok)=>{ if(!resolved.current){ resolved.current=true; onResolve(ok);} };
  useEffect(()=>cancelBtn.current?.focus(),[]);

  /* Strategy-scoped filtered objects */
  const stratKeys = STRATEGY_ALLOW[strategy] ?? [];
  const advKeys   = ADV_ALLOW[strategy] ?? [];
/* Manual trades don’t need the collapsible “Strategy Settings” section */
const isManual = normalize(strategy) === "manual";

const stratCfg = isManual
  ? {}                                 // ⬅️ Skip building it for manual
  : buildCfg(config, STRATEGY_ALLOW, strategyFieldMap, strategy);

const advCfg   = buildCfg(config, ADV_ALLOW, advancedFieldMap, strategy);
console.log("strategy:", strategy);
console.log("stratKeys:", stratKeys);
console.log("advKeys:", advKeys);
console.log("incoming config keys:", Object.keys(config));
console.log("filtered stratCfg:", stratCfg);
console.log("filtered advCfg:", advCfg);
  /* Determine if strategy uses a tokenMint (stealth OR explicit useTargetToken) */
  const showTokenRow =
    (strategy === "stealthBot" && config?.tokenMint) ||
    (config?.useTargetToken && config?.tokenMint) ||
    (strategy === "chadMode" && !config?.useMultiTargets && config?.outputMint);

  return (
    <Dialog.Root defaultOpen onOpenChange={(open)=>!open&&close(false)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm data-[state=open]:animate-fadeIn" />
        <Dialog.Content className="fixed top-1/2 left-1/2 w-[360px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl data-[state=open]:animate-scaleIn">
          {/* header */}
          <Dialog.Title className="mb-3 text-lg font-semibold text-white">
            {typeof title==="string"?title:"Confirm Action"}
          </Dialog.Title>

          {/* optional message */}
          <div className="text-sm text-zinc-300 space-y-2 mb-6">
            {typeof message==="string"?<p>{message}</p>:message}
          </div>

          {/* core params */}
          <div className="text-sm font-mono text-zinc-300 space-y-1.5 mb-6">
            {/* Spend for BUY  |  Sell % for manual‑SELL */}
            <div className="flex justify-between">
              <span className="text-zinc-400">
                {isManual && tradeType === "SELL" ? "Sell %" : "Spend"}
              </span>
              <span className="text-emerald-300 font-semibold">
                {isManual && tradeType === "SELL"
                  ? `${percent}%`
                  : fmtSpend({ config, inputAmount, strategy })}
              </span>
            </div>

            {/* Token */}
        {showTokenRow && (
          <div className="flex justify-between">
            <span className="text-zinc-400">Token</span>
            <span className="inline-flex flex-col items-end gap-0.5 text-blue-300 font-semibold text-right">
              {strategy === "chadMode" && config.useMultiTargets ? (
                config?.targetTokens?.trim()
                  ?.split(/[\n,]+/)
                  .filter(Boolean)
                  .map((mint, i) => (
                    <span key={i} className="flex items-center gap-1">
                      <img
                        src={`https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/assets/${mint.trim()}/logo.png`}
                        onError={(e) => {
                          e.target.style.display = "none";
                        }}
                        alt=""
                        className="w-3 h-3 rounded-full"
                      />
                      {shortenedToken(mint)}
                    </span>
                  ))
              ) : (
                <>
                  {config?.tokenMint || config?.outputMint ? (
                    <span className="inline-flex items-center gap-1">
                      <img
                        src={`https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/assets/${config.tokenMint || config.outputMint}/logo.png`}
                        onError={(e) => {
                          e.target.style.display = "none";
                        }}
                        alt=""
                        className="w-3 h-3 rounded-full"
                      />
                      {tokenSymbol !== "???" ? `$${tokenSymbol}` : shortenedToken(config.tokenMint || config.outputMint)}
                    </span>
                  ) : (
                    "???"
                  )}
                </>
              )}
            </span>
          </div>
        )}

            {/* Slippage */}
            <div className="flex justify-between">
              <span className="text-zinc-400">Slippage</span>
              <span className="text-purple-300 font-semibold">{slippage}%</span>
            </div>

           {/* Manual mode: show token row directly */}
           {isManual && config?.outputMint && (
              <div className="flex justify-between">
                <span className="text-zinc-400">Token</span>
                <span className="inline-flex items-center gap-1 text-blue-300 font-semibold">
                  <img
                    src={`https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/assets/${config.outputMint}/logo.png`}
                    onError={(e) => { e.target.style.display = "none"; }}
                    alt=""
                   className="w-3 h-3 rounded-full"
                  />
                  {tokenSymbol !== "???" ? `$${tokenSymbol}` : shortenedToken(config.outputMint)}
                </span>
              </div>
            )}

            {/* Max Slippage */}
              {config.maxSlippage !== undefined && config.maxSlippage !== null && config.maxSlippage !== "" && config.maxSlippage > 0 && (
                <div className="flex justify-between">
                  <span className="text-zinc-400">Max Slippage</span>
                  <span className="text-purple-300 font-semibold">{config.maxSlippage}%</span>
                </div>
              )}

            {/* Priority Fee */}
            {(priorityFee||config.priorityFeeLamports)>0 && (
              <div className="flex justify-between">
                <span className="text-zinc-400">Priority Fee</span>
                <span className="text-fuchsia-300 font-semibold">
                  {priorityFee||config.priorityFeeLamports} lamports
                </span>
              </div>
            )}

            {/* TP/SL summary */}
            {(takeProfit||stopLoss) && (
              <div className="flex justify-between">
                <span className="text-zinc-400">TP&nbsp;/&nbsp;SL</span>
                <span>
                  <span className="text-yellow-300 font-semibold mr-2">{takeProfit??"—"}%</span>
                  <span className="text-red-400 font-semibold">{stopLoss??"—"}%</span>
                </span>
              </div>
            )}

            {/* Interval */}
            {config.interval>0 && (
              <div className="flex justify-between">
                <span className="text-zinc-400">Trade Interval</span>
                <span className="text-cyan-300 font-semibold">{fmtInterval(config.interval)}</span>
              </div>
            )}

            {/* Max Trades */}
            {config.maxTrades>0 && (
              <div className="flex justify-between">
                <span className="text-zinc-400">Max Trades</span>
                <span className="text-blue-300 font-semibold">{config.maxTrades}</span>
              </div>
            )}

            {/* Launch time */}
            {scheduleISO && (
              <div className="flex justify-between">
                <span className="text-zinc-400">Launch At</span>
                <span className="text-indigo-300 font-semibold">
                  {new Date(scheduleISO).toLocaleString()}
                </span>
              </div>
            )}
          </div>

          {/* Strategy Settings — hidden for manual trades */}
          {!isManual && Object.keys(stratCfg).length>0 && (
            <details className="mb-4 text-sm font-mono text-zinc-300 space-y-1.5">
              <summary className="cursor-pointer text-zinc-400 hover:text-white">
                ⚙️ Strategy Settings
              </summary>
              {renderRows(stratCfg,strategyFieldMap)}
            </details>
          )}

          {/* Advanced Config */}
          {Object.keys(advCfg).length>0 && (
            <details className="mb-6 text-sm font-mono text-zinc-300 space-y-1.5">
              <summary className="cursor-pointer text-zinc-400 hover:text-white">
                🛠️ Advanced Config
              </summary>
              {renderRows(advCfg,advancedFieldMap)}
            </details>
          )}

          {/* footer */}
          <div className="flex justify-end gap-3">
            <button
              ref={cancelBtn}
              onClick={()=>close(false)}
              className="inline-flex items-center gap-1 rounded-md bg-zinc-800 px-4 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-600"
            ><X size={14}/> Cancel</button>

            <button
              onClick={()=>close(true)}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-black hover:bg-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-400"
            ><Check size={14}/> Confirm</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
