const RpcPool = require('../services/execution/rpcPool');

// Mock SolanaConnection to force fallback objects
jest.mock('@solana/web3.js', () => ({ Connection: null }));

describe('RpcPool health and breaker', () => {
  test('selects healthiest connection', () => {
    const pool = new RpcPool(['rpcA', 'rpcB']);
    // Simulate stats: rpcA fast and successful, rpcB slow and error-prone
    pool._updateStats('rpcA', 50, false);
    pool._updateStats('rpcA', 60, false);
    pool._updateStats('rpcB', 1500, true);
    pool._updateStats('rpcB', 1600, true);
    const selected = pool.getConnection();
    expect(selected._endpoint).toBe('rpcA');
  });
});