/**
 * getVolumeSpikeList.js
 * ---------------------------------
 * Filters tokens experiencing a sharp increase in trading volume.
 * Volume spikes can precede or accompany price movements, signalling
 * heightened trader interest【809305122257820†L37-L40】.
 */

try {
require("dotenv").config({ path: __dirname + "/../../../../.env" });
} catch (_) {
  /* dotenv is optional */
}
const CU_TABLE = require("../cuTable");
const { birdeyeCUCounter } = require("../birdeyeCUCounter");

const URL = "https://public-api.birdeye.so/defi/v3/token/list";

/**
 * Fetch tokens with significant recent volume acceleration. By filtering
 * on volume change percentage and absolute volume, this list surfaces
 * tokens where participation is ramping up quickly.
 *
 * @param {string|null} userId
 * @param {number} limit
 * @param {number} minVolumeChange2h - Minimum percentage change in volume over last 2 hours
 * @param {number} minVolume2h - Minimum absolute 2h volume in USD
 */
async function getVolumeSpikeList(
  userId = null,
  limit = 20,
  minVolumeChange2h = 50,
  minVolume2h = 50_000
) {
  limit = Math.max(1, Math.min(limit, 100));
  try {
    const data = await birdeyeCUCounter({
      url: URL,
      params: {
        sort_by: "volume_2h_change_percent",
        sort_type: "desc",
        limit,
        min_volume_2h_change_percent: minVolumeChange2h,
        min_volume_2h_usd: minVolume2h,
      },
      cuCost: CU_TABLE["/defi/v3/token/list"],
      userId,
    });
    const items = data?.data?.items || data?.data?.tokens || [];
    return items;
  } catch (err) {
    console.warn("❌ getVolumeSpikeList error:", err.message);
    return [];
  }
}

module.exports = getVolumeSpikeList;