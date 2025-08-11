const riskEngine = require('../services/riskEngine');

describe('RiskEngine', () => {
  test('allows trade within limits', () => {
    const result = riskEngine.checkTrade('user1', 'mint1', 10);
    expect(result.allowed).toBe(true);
    expect(result.maxUsd).toBeGreaterThan(0);
  });
  test('triggers kill switch after large loss', () => {
    // Simulate large loss to exceed max daily loss
    riskEngine.recordLoss('user2', 'mint1', 1e6);
    const result = riskEngine.checkTrade('user2', 'mint1', 1);
    expect(result.allowed).toBe(false);
  });
});