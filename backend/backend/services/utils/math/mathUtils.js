function toLamports(sol) {
    return Math.floor(sol * 1e9);
  }
  
  function fromLamports(lamports) {
    return lamports / 1e9;
  }
  
  module.exports = { toLamports, fromLamports };
  