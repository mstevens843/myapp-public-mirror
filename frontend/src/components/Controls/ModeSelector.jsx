/** ModeSelector - Dropdown strategy selector for trading bot.
 * 
 * Features:
 * - Displays a dropdownwith all available bot strategy modes
 * - Allows the user to switch between strategies dynamically 
 * - Communicates selected mode to parent component via `onSelect` callback
 * - Clean UI structure and easily extensible with more strategies. 
 * 
 * - Used on the dashboard to configure which trading algorithm the bot runs. 
 */
import React, { useState, useRef, useEffect } from "react";
import "@/styles/components/ModeSelector.css";

const modes = [
  { value: "sniper", label: "🎯 Sniper" },
  // { value: "manual", label: "🛠 Manual Controls" },
  { value: "scalper", label: "⚡ Scalper" },
  { value: "breakout", label: "🚀 Breakout" },
  { value: "chadMode", label: "🔥 Chad Mode" },
  { value: "dipBuyer", label: "💧 Dip Buyer" },
  { value: "delayedSniper", label: "⏱️ Delayed Sniper" },
  { value: "trendFollower", label: "📈 Trend Follower" },
  { value: "paperTrader", label: "📝 Paper Trader" },
  { value: "rebalancer", label: "⚖️ Rebalancer" },
  { value: "rotationBot", label: "🔁 Rotation Bot" },
  { value: "stealthBot",    label: "🥷 Stealth Bot" },
];

const ModeSelector = ({ selected = [], onSelect, disabled = false, singleMode = false }) => {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef();

  const toggleCheckbox = (modeValue) => {
    if (selected.includes(modeValue)) {
      onSelect(selected.filter((m) => m !== modeValue));
    } else {
      onSelect([...selected, modeValue]);
    }
  };

  const selectedLabel = modes.find((m) => m.value === selected[0])?.label || "Select a mode";

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setOpen(false); // ✅ close dropdown
      }
    };
  
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="multi-mode-selector">
      {singleMode ? (
        <div className="custom-dropdown-wrapper" ref={dropdownRef}>
        <div
            className={`dropdown-toggle ${disabled ? "disabled" : ""}`}
            onClick={() => !disabled && setOpen((prev) => !prev)}
          >
            {selectedLabel}
            <span className="chevron">{open ? "▲" : "▼"}</span>
          </div>

          {open && (
            <ul className="dropdown-list">
              {modes.map((mode) => (
                <li
                key={mode.value}
                className={`dropdown-item ${
                  selected[0] === mode.value ? "dropdown-item-active" : ""
                }`}
                onClick={() => {
                  onSelect([mode.value]); // Pass as an array
                  setOpen(false);
                }}
              >
                {mode.label}
              </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
          <label className="dropdown-label mb-1 text-white">Select Strategies:</label>
          <div className="checkbox-list flex flex-wrap gap-3 mt-2">
            {modes.map((mode) => (
              <label
                key={mode.value}
                className={`mode-checkbox-item px-3 py-1 rounded text-sm cursor-pointer border ${
                  selected.includes(mode.value)
                    ? "bg-green-600 text-white border-green-500"
                    : "bg-zinc-800 text-zinc-300 border-zinc-700"
                } ${disabled ? "opacity-50 pointer-events-none" : ""}`}
              >
                <input
                  type="checkbox"
                  value={mode.value}
                  checked={selected.includes(mode.value)}
                  onChange={() => toggleCheckbox(mode.value)}
                  disabled={disabled}
                  className="mr-2"
                />
                {mode.label}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default ModeSelector;
