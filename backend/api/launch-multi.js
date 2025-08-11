// routes/orchestrator.js
const express = require("express");
const path = require("path");
const fs = require("fs");
const router = express.Router();
// ── Pagination helper (idempotent) ───────────────────────────────────────────
function __getPage(req, defaults = { take: 100, skip: 0, cap: 500 }) {
  const cap  = Number(defaults.cap || 500);
  let take   = parseInt(req.query?.take ?? defaults.take, 10);
  let skip   = parseInt(req.query?.skip ?? defaults.skip, 10);
  if (!Number.isFinite(take) || take <= 0) take = defaults.take;
  if (!Number.isFinite(skip) || skip <  0) skip = defaults.skip;
  take = Math.min(Math.max(1, take), cap);
  skip = Math.max(0, skip);
  return { take, skip };
}
// ─────────────────────────────────────────────────────────────────────────────

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