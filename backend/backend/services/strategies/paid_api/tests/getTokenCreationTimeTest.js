/**
 * getTokenCreationUnixTest.js
 * --------------------------------------------------
 * Usage: `node tests/getTokenCreationUnixTest.js <mint>`
 * Example: `node tests/getTokenCreationUnixTest.js So11111111111111111111111111111111111111112`
 */

const getTokenCreationUnix = require("../getTokenCreationTime");

async function run() {
  const mint = process.argv[2];

  if (!mint) {
    console.error("❌ Please provide a mint address.");
    console.error("Usage: node tests/getTokenCreationUnixTest.js <mint>");
    process.exit(1);
  }

  const creationUnix = await getTokenCreationUnix(mint);

  if (!creationUnix) {
    console.log(`❌ No creation info found for ${mint}`);
    return;
  }

  const ageMs = Date.now() - creationUnix * 1000;
  const ageMinutes = Math.floor(ageMs / 60000);
  const ageHours = (ageMinutes / 60).toFixed(1);

  console.log("✅ Token Age Info:");
  console.log(`• Mint:         ${mint}`);
  console.log(`• Created At:   ${new Date(creationUnix * 1000).toLocaleString()}`);
  console.log(`• Age:          ${ageMinutes} minutes (${ageHours} hours)`);
}

run();
