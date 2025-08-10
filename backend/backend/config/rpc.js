/** Core Trading Logic + API/webhook if needed
 * Solana RPC setup
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "./.env") });

const { Connection, clusterApiUrl } = require('@solana/web3.js');


const connection = new Connection(
    process.env.SOLANA_RPC_URL || clusterApiUrl('mainnet-beta'), 
    'confirmed'
); 


module.exports = connection;
