export function logEvent(action, payload = {}) {
    const timestamp = new Date().toISOString();
    const event = { action, payload, timestamp };
  
    // Save to localStorage or print to console
    console.log("📊 [User Action]", event);
  
    const logs = JSON.parse(localStorage.getItem("usageLogs") || "[]");
    logs.push(event);
    localStorage.setItem("usageLogs", JSON.stringify(logs));
  }
  