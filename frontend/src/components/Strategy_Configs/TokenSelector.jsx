import React from "react";

const TokenSelector = ({ walletTokens = [], onSelect, disabled }) => {
  const options = walletTokens.map(t => {
    const nice =
      t.symbol?.trim() ? t.symbol :
      t.name?.trim()   ? t.name   :
      `${t.mint.slice(0,4)}…${t.mint.slice(-4)}`;
    return { value: t.mint, label: `${nice} • ${t.amount.toFixed(2)}` };
  });

  return (
    <select
      defaultValue=""
       onChange={e => {
        const v = e.target.value;
        if (v === "__custom") {                // <- special flag
          onSelect("__custom");
          e.target.value = "";                 // reset dropdown
        } else if (v) {
          onSelect(v);
        }
      }}
      disabled={disabled}
      className="w-full px-3 py-2 rounded-md border border-zinc-700
                 bg-zinc-900 text-white text-sm pr-6"
    >
      <option value="">— Select Token —</option>
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
      <option value="__custom">🔧 Custom Mint…</option>
    </select>
  );
};

export default TokenSelector;
