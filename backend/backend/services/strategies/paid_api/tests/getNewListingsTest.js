const getNewListings = require("../getNewListings");

(async () => {
  // Safe test call — no CU tracking
  const listings = await getNewListings(null, 10, true); 
  console.log(`✅ Fetched ${listings.length} new tokens`);
  console.log(listings.slice(0, 10)); // print sample
})();
