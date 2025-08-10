// Separate tradelogs from generic bot execution logs. 
function logEvent(event, data = {}) {
    console.log(`[${new Date().toISOString()}] ${event}`, data);
  }
  
  module.exports = { logEvent };