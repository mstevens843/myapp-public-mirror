// const { Connection, PublicKey } = require("@solana/web3.js");
// require("dotenv").config({ path: require("path").resolve(__dirname, "../../../../.env") });

// const connection          = new Connection(process.env.SOLANA_RPC_URL, "confirmed");
// const getTopHolderStats   = require("./getTopHolderStats");

// module.exports = async function checkTopHolderContract (mint) {
//   // grab holder list (addresses are now returned by getTopHolderStats → data.topHolders)
//   const { data } = await getTopHolderStats(mint);

//   if (!data || !data.topHolders?.length) {
//     // ✅ neutral — don’t penalise score
//     return {
//       key   : "topHolderContract",
//       label : "Top Holder is a Program",
//       passed: true,
//       reason: "No top holder data found",
//       detail: null,
//     };
//   }

//   const topHolderAddress = data.topHolders[0].address;
//   const accInfo          = await connection.getAccountInfo(new PublicKey(topHolderAddress));
//   const isProgram        = !!accInfo?.executable;

//   return {
//     key   : "topHolderContract",
//     label : "Top Holder is a Program",
//     passed: isProgram,                              // fail only if top holder is NOT a program
//     reason: isProgram ? undefined : "Top holder is a regular wallet",
//     detail: { address: topHolderAddress, isProgram },
//   };
// };