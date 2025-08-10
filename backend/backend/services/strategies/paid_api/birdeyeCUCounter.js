/**
 * birdeyeCUCounter.js (updated)
 * ---------------------------------
 * Wraps Birdeye API requests with circuit breaker protection and
 * retry logic via the shared httpClient. Preserves credit usage
 * accounting for paid API calls.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env') });
const prisma = require('../../../prisma/prisma');
const CU_TABLE = require('./cuTable');
const httpClient = require('../../../utils/httpClient');

const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY;

async function birdeyeCUCounter({ url, params = {}, cuCost = null, userId = null }) {
  try {
    const urlPath = new URL(url).pathname;
    let finalCuCost = cuCost;
    if (finalCuCost == null) {
      finalCuCost = CU_TABLE[urlPath] ?? 10;
    }
    const response = await httpClient({
      url,
      method: 'get',
      params,
      headers: {
        'x-chain': 'solana',
        'X-API-KEY': BIRDEYE_API_KEY,
      },
      circuitKey: 'birdeye',
    });
    if (userId && typeof userId === 'string') {
      try {
        await prisma.user.update({
          where: { id: userId },
          data: { usage: { increment: finalCuCost } },
        });
      } catch (err) {
        console.warn(`⚠️ Could not update CU for userId ${userId}:`, err.message);
      }
    }
    return response.data;
  } catch (err) {
    console.warn(`⚠️ Birdeye request failed: ${url}`, err.message);
    throw err;
  }
}

module.exports = { birdeyeCUCounter };