/** LogsConsole - Real-time WebSocket for Solana trading bot dashboard
 * 
 * Features:
 * - Connects to WebSocket server for live logging. (`ws://localhost:5001`)
 * - Displays the latest 100 log entries in a scrollble UI 
 * - Automatically masks sensitive data like wallet addresses and tx hashes. 
 * - Clean up WebSocket connection on unmount. 
 * 
 * - Used in dashboard to monitor backend activity (trades, alerts, errors)
 */

import React, { useState, useEffect } from "react";
import { toast } from "react-toastify";
import "@/styles/components/LogsConsole.css";

/**
 * LogsConsole displays live logs streamed via WebSocket. 
 * It includes a sanitizer to prevent leaking sensitive keys or hashes. 
 */
const LogsConsole = () => {
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    const ws = new WebSocket("ws://localhost:5001");

    // On new message, add to logs and keep only the last 100. 
    ws.onmessage = (msg) => {
      setLogs((prev) => [...prev.slice(-100), msg.data]);
    };

    ws.onerror = (err) => console.error("WebSocket error:", err);
    ws.onclose = () => console.warn("WebSocket closed");

    return () => ws.close();
  }, []);

  /** 
   * Mask wallet-like addresses and full tx hashes
   */
  const sanitizeLog = (log) => {
    const addressPattern = /([1-9A-HJ-NP-Za-km-z]{32,44})/g;
    const txPattern = /\b([a-f0-9]{64})\b/gi;

    let sanitized = log;
    sanitized = sanitized.replace(addressPattern, (match) =>
      match.length > 20 ? `${match.slice(0, 4)}…${match.slice(-4)}` : match
    );
    sanitized = sanitized.replace(txPattern, (match) =>
      `${match.slice(0, 6)}…${match.slice(-6)}`
    );

    return sanitized;
  };

  /** 🔁 Resets backend logs and clears console */
  const handleClearLogs = async () => {
    const confirm = window.confirm("🧹 Are you sure you want to clear all backend logs?");
    if (!confirm) return;

    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/trades/reset`, {
        method: "POST",
      });

      const data = await res.json();
      if (res.ok) {
        toast.success("🧹 Logs cleared successfully.");
        setLogs([]);
      } else {
        toast.error(`❌ ${data.error || "Failed to clear logs."}`);
      }
    } catch (err) {
      console.error("❌ Log reset failed:", err);
      toast.error("❌ Could not clear logs.");
    }
  };

  return (
    <div className="logs-console">
      <h3>📜 Live Logs</h3>

      <div className="logs-output">
        {logs.map((line, i) => (
          <div key={i} className="log-line">
            {sanitizeLog(line)}
          </div>
        ))}
      </div>

      <div className="clear-logs-button">
        <button onClick={handleClearLogs}>🧼 Clear Logs</button>
      </div>
    </div>
  );
};

export default LogsConsole;

