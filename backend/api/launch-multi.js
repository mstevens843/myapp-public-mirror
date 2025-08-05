// routes/orchestrator.js
const express = require("express");
const path = require("path");
const fs = require("fs");
const router = express.Router();

// POST /api/launch-multi
// Saves config to runtime file and launches orchestrator
router.post("/launch-multi", async (req, res) => {
  try {
    const config = req.body;

    if (!config || typeof config !== "object") {
      return res.status(400).json({ error: "Invalid config payload." });
    }

    const runtimePath = path.resolve(__dirname, "../runtime/multi-strategy-config.json");
    fs.writeFileSync(runtimePath, JSON.stringify(config, null, 2));

    const orchestratorPath = path.resolve(__dirname, "../services/orchestrator.js");

    console.log("🚀 Launching Multi-Strategy Bot...");
    const subprocess = require("child_process").fork(orchestratorPath);

    return res.json({ success: true, message: "Orchestrator launched." });
  } catch (err) {
    console.error("❌ Launch failed:", err.message);
    return res.status(500).json({ error: "Failed to launch orchestrator." });
  }
});

module.exports = router;
