import React, { useState, useEffect } from "react";
import StrategyTooltip from "./StrategyTooltip";
import { ChevronDown } from "lucide-react";
import { useRef } from "react";
const TargetWeightsBuilder = ({
  targetWeights = {},
  onUpdate,
  disabled,
  walletTokens = [],
  autoEqual = false,
}) => {
    console.log("🧪 TargetWeightsBuilder received walletTokens:", walletTokens);

  const [selectValue, setSelectValue] = useState("");
  const [mint,  setMint]  = useState("");
  const [pct,   setPct]   = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
const menuRef = useRef(null);
  /* helper – next equal share */
  const nextEqualPct = (cnt) => +(100 / cnt).toFixed(2);

  /* label lookup -------------------------------------------------- */
  const labelMap = Object.fromEntries(
    walletTokens.map(t => {
      console.log("🧬 Mapping token:", t.symbol, t.mint);

      const nice =
        t.symbol?.trim() ? t.symbol :
        t.name?.trim()   ? t.name   :
        `${t.mint.slice(0,4)}…${t.mint.slice(-4)}`;
      return [t.mint, nice];
    }),
  );

  useEffect(() => {
  const handler = (e) => {
    if (menuRef.current && !menuRef.current.contains(e.target)) {
      setMenuOpen(false);
    }
  };
  document.addEventListener("mousedown", handler);
  return () => document.removeEventListener("mousedown", handler);
}, []);
  

const inputBase =
  "w-full min-h-[34px] text-sm pl-3 pr-8 py-2 rounded-md border border-zinc-700 "+
  "bg-zinc-900 text-white placeholder:text-zinc-400 focus:outline-none "+
  "focus:ring-2 focus:ring-emerald-400 hover:border-emerald-500 transition";

const options = [...walletTokens]
  .sort((a, b) => b.valueUsd - a.valueUsd)
  .map(t => {
    const nice = t.symbol?.trim() ? t.symbol :
                 t.name?.trim()   ? t.name :
                 `${t.mint.slice(0,4)}…${t.mint.slice(-4)}`;
    const amt  = t.amount >= 1_000 ? t.amount.toLocaleString() : t.amount.toFixed(2);
    const usd  = t.valueUsd >= 1_000 ? (t.valueUsd/1_000).toFixed(1)+'k' : t.valueUsd.toFixed(2);
    return { value: t.mint, label: `${nice} • ${amt} • $${usd}`, meta: t };
  });

  /* -------------------------- add ------------------------------- */
  /* ------------------------------------------------------------------
   * 📌 keep the “%” box always pre-filled with the **next** equal share:
   *   • when Auto-Balance is toggled on
   *   • after every add
   *   • after every remove
   * ------------------------------------------------------------------ */
  useEffect(() => {
    if (autoEqual) {
      const cnt = Math.max(Object.keys(targetWeights).length, 1);   // 1 if none yet
      setPct(String(nextEqualPct(cnt)));
    } else {
      /* manual mode – leave it blank for user input */
      setPct("");
    }
  }, [autoEqual, targetWeights]);



   const handleAdd = () => {
    if (!mint) return;

    /* auto-mode: build equal map in one shot */
    if (autoEqual) {
      const mints = [...new Set([...Object.keys(targetWeights), mint])];
      const equal = nextEqualPct(mints.length);
      const updated = Object.fromEntries(mints.map(m => [m, equal]));
      onUpdate(updated);
     /*  pre-fill the “%” box for the NEXT token */
      setPct(String(nextEqualPct(mints.length + 1)));
    } else {
      const pctNum = parseFloat(pct);
      if (isNaN(pctNum) || pctNum <= 0) return;
      const total = Object.values(targetWeights).reduce((a,b)=>a+b,0);
      if (total + pctNum > 100) {
        alert("🎯 Target weights cannot exceed 100 %");
        return;
      }
      onUpdate({ ...targetWeights, [mint]: pctNum });
    }

    setSelectValue("");
    setMint("");
    // setPct("");
  };

  /* ------------------------ remove ------------------------------ */
  const handleRemove = (m) => {
    const updated = { ...targetWeights };
    delete updated[m];

    if (autoEqual) {
      const keys = Object.keys(updated);
      if (keys.length) {
        const equal = nextEqualPct(keys.length);
        keys.forEach(k => { updated[k] = equal; });
      }
    }
    onUpdate(updated);
  };
  

  /* --------------------------- UI ------------------------------- */
  return (
    <div className="mt-2 bg-zinc-900 border border-zinc-700 p-4 rounded-lg text-sm text-white space-y-4">
      {/* header */}
      <div>
        <div className="flex items-center gap-1 mb-1">
          <h4 className="text-base font-semibold">🎯 Target Weights Builder</h4>
          <StrategyTooltip name="targetWeights" />
        </div>
        <p className="text-xs text-zinc-400">
          Assign weight percentages {autoEqual ? "(auto-split)" : "(manual)" }.
        </p>
      </div>

      {/* selector row */}
      <div className="flex gap-2 items-center">
        {walletTokens.length ? (
<div className="relative flex-1">
  <button
    type="button"
    disabled={disabled}
    onClick={() => setMenuOpen(o => !o)}
    className={`${inputBase} flex justify-between items-center cursor-pointer`}
  >
    <span>
      {mint
        ? labelMap[mint] ?? `${mint.slice(0,4)}…${mint.slice(-4)}`
        : "Select token…"}
    </span>
    <ChevronDown className="w-4 h-4" />
  </button>

  {menuOpen && (
<div
  ref={menuRef}
  className="absolute z-10 mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-md shadow-lg flex flex-col"
>
  {/* Close button always at top */}
  <div
    onMouseDown={e => {
      e.stopPropagation();
      setMenuOpen(false);
    }}
    className="px-3 py-2 text-xs text-center
               text-rose-300 hover:bg-zinc-700/40 cursor-pointer
               border-b border-zinc-700 bg-zinc-800"
  >
    ✕ Close
  </div>

  {/* Scrollable list */}
  <div className="overflow-y-auto max-h-60">
    {options.map(o => (
      <div
        key={o.value}
        onMouseDown={e => {
          e.stopPropagation();
          setMint(o.value);
          setMenuOpen(false);
          if (autoEqual) {
            const current = Object.keys(targetWeights).filter(k => k !== o.value);
            const futureCnt = current.length + 1;
            const equal = nextEqualPct(futureCnt);
            setPct(String(equal));
          }
        }}
        className={`px-2 py-1 text-xs hover:bg-emerald-700/40 cursor-pointer flex justify-between items-center ${
          mint === o.value ? "bg-emerald-700/30" : ""
        }`}
      >
        <div className="flex flex-col">
          <span className="font-medium text-white">{o.meta.symbol || o.meta.name}</span>
          <span className="text-[10px] text-zinc-400">
            {`${o.value.slice(0,4)}…${o.value.slice(-4)}`}
          </span>
        </div>
        <div className="text-right text-[11px]">
          <div>{(+o.meta.amount || 0).toFixed(2)}</div>
          <div className="text-zinc-400">
            (${(+o.meta.valueUsd || 0).toFixed(2)})
          </div>
        </div>
      </div>
    ))}
  </div>
</div>
  )}
</div>
        ) : (
          <input
            type="text"
            placeholder="Token Mint"
            value={mint}
            onChange={(e) => setMint(e.target.value)}
            className="flex-1 px-3 py-2 rounded-md bg-zinc-800 border border-zinc-600"
            disabled={disabled}
          />
        )}
        

        {selectValue === "__custom" && (
          <input
            type="text"
            placeholder="Paste Mint"
            value={mint}
            onChange={(e) => setMint(e.target.value.trim())}
            className="flex-1 px-3 py-2 rounded-md bg-zinc-800 border border-zinc-600 mt-2"
            disabled={disabled}
          />
        )}

        <input
          type="number"
          placeholder="%"
          value={pct}
          onChange={(e) => setPct(e.target.value)}
          className="w-[90px] px-3 py-2 rounded-md bg-zinc-800 border border-zinc-600"
          disabled={disabled || autoEqual}
        />

        <button
          onClick={handleAdd}
          disabled={
            disabled ||
            !mint ||
            (!autoEqual && (isNaN(parseFloat(pct)) || parseFloat(pct) <= 0)) ||
            (!autoEqual && (Object.values(targetWeights).reduce((a,b)=>a+b,0) + parseFloat(pct||0) > 100))
          }
          className="px-3 py-2 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          ➕
        </button>
      </div>

      {/* list */}
      {Object.keys(targetWeights).length > 0 && (
        <ul className="divide-y divide-zinc-700 border-t border-zinc-700 pt-2 space-y-2 text-sm">
          {Object.entries(targetWeights).map(([m, w]) => (
            <li key={m} className="flex justify-between items-center pt-2">
              <div className="break-all text-zinc-300 w-[65%]">
                {labelMap[m] ?? `${m.slice(0,4)}…${m.slice(-4)}`}
              </div>
              <div className="text-emerald-400 font-semibold">{w}%</div>
              <button
                onClick={() => handleRemove(m)}
                disabled={disabled}
                className="ml-4 text-red-400 hover:text-red-500 hover:underline text-xs"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default TargetWeightsBuilder;
