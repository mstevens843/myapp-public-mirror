const express = require("express");
const router = express.Router();

// ✅ Use new controller based on telegramPrefs + botAlerts
const alerts = require("../telegram/apiController");

// POST /api/telegram/set-chat-id
router.post("/set-chat-id", alerts.setChatId);

// GET /api/telegram/chat-id
router.get("/chat-id", alerts.getChatId);

// GET /api/telegram/preferences
router.get("/preferences", alerts.getPreferences);

// POST /api/telegram/preferences
router.post("/preferences", alerts.setPreferences);

// POST /api/telegram/test
router.post("/test", alerts.sendTest);

// POST /api/telegram/clear
router.post("/clear", alerts.clearChatId);

module.exports = router;
