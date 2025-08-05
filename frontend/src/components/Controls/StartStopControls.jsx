/** StartStopControls - UI COntrols to start and stop bot execution. 
 * 
 * Features: 
 * - "Start" button that triggers strategy execution if a mode is selected. 
 * - "Stop" button to halt an actively running bot. 
 * - Buttons fidanle based on app state (running, loading, no strategy selected)
 * - Displays dynamic text/icons for loading feedback (Starting / Stopping) 
 * 
 * - Used in dashboard to control lifecycle of trading pot per user action. 
 */


import React from "react";
import "@/styles/components/StartStopControls.css";
import { toast } from "react-toastify";

const StartStopControls = ({ onStart, onStop, running, selected, loading }) => {
  const handleStart = () => {
    if (!selected) {
      toast.info("⚠️ Please select a strategy first.");
      return;
    }
    if (!running && !loading) onStart();
  };

  const handleStop = () => {
    if (running && !loading) onStop();
  };

  return (
    <div className="start-stop-controls">
      <button
  onClick={handleStart}
  className={`start-btn ${!selected ? "tooltip-wrapper" : ""}`}
>
  {loading && !running
    ? "⏳ Starting..."
    : running
    ? "▶️  Started"
    : "▶️ Start"}
  {!selected && (
    <span className="hover-tooltip">Select a strategy first</span>
  )}
</button>

<button
  onClick={handleStop}
  className="stop-btn"
>
  {loading && running
    ? "🛑 Stopping..."
    : !running && !loading
    ? "🛑 Stopped"
    : "⏹ Stop"}
</button>
    </div>
  );
};

export default StartStopControls;