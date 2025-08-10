require("dotenv").config({ path: require("path").resolve(__dirname, "../../../../.env") });

const getTokenMarketStats = require("./getTokenMarketStatsfree"); // adjust path if needed

const mint = process.argv[2];
if (!mint) {
  console.error("❌ Please provide a token mint address as the argument.");
  process.exit(1);
}

(async () => {
  try {
    const data = await getTokenMarketStats(mint);

    console.log(
      JSON.stringify(
        {
          data,
          success: data && Object.keys(data).length > 0,
        },
        null,
        2
      )
    );
  } catch (err) {
    console.error("❌ Error during test:", err.message);
  }
})();
