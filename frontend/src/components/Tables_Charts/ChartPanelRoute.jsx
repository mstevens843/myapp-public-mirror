// src/components/Tables_Charts/ChartPanelRoute.jsx

import React, { useState } from "react";
import HistoryPanel from "@/components/Tables_Charts/HistoryPanel";

export default function ChartPanelRoute() {
  const [chartMode, setChartMode] = useState("trades");
  const [timeframe, setTimeframe] = useState(30);

  const handleExportCSV = () => {};
  const handleClearLogs = () => {};

  return (
    <div className="p-4">
      <HistoryPanel
        chartMode={chartMode}
        setChartMode={setChartMode}
        timeframe={timeframe}
        setTimeframe={setTimeframe}
        onExportCSV={handleExportCSV}
        onClearLogs={handleClearLogs}
      />
    </div>
  );
}
