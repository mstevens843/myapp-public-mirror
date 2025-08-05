require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const { monitorTpSlWeb } = require("../services/strategies/MonitorTpSl.web");
const { monitorDcaWeb }  = require("../services/strategies/MonitorDca.web");
const { monitorLimitWeb } = require("../services/strategies/MonitorLimit.web");

(async () => {
  console.log("🎯 Monitor Cluster starting...");
  monitorTpSlWeb();
  monitorDcaWeb();
  monitorLimitWeb();
})();
