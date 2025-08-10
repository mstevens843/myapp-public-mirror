// /**
//  * Load + Manage Keypair
//  */

// const { Keypair } = require('@solana/web3.js'); 
// const bs58 = require('bs58'); 
// require('dotenv').config(); 

// function loadKeyPair() {
//     if (!process.env.PRIVATE_KEY) throw new Error('No PRIVATE_KEY in .env');
//     const secret = bs58.decode(process.env.PRIVATE_KEY.trim());
//     return Keypair.fromSecretKey(secret); 
// }


// module.exports = loadKeyPair


