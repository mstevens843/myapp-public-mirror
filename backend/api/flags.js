// backend/api/flags.js
const express = require("express");
const router = express.Router();
const bool = (v, d=false) => { if (v==null) return d; const s=String(v).toLowerCase(); return ["1","true","yes","on"].includes(s); };
router.get("/", (req,res)=> {
  res.json({
    enableTurbo: bool(process.env.FLAG_ENABLE_TURBO, true),
    enableSimulator: bool(process.env.FLAG_ENABLE_SIMULATOR, true),
    enableChadMode: bool(process.env.FLAG_ENABLE_CHAD, false),
    showExperimentalUI: bool(process.env.FLAG_SHOW_EXPERIMENTAL_UI, false),
  });
});
module.exports = router;