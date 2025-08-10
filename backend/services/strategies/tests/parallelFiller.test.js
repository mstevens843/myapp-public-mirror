// Jest tests for parallelFiller
const { parallelFiller } = require('../parallelFiller');

describe('parallelFiller', () => {
  test('respects maxParallel concurrency', async () => {
    let running = 0;
    let maxRunning = 0;
    const onExecute = async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      // artificial delay
      await new Promise((r) => setTimeout(r, 10));
      running--;
      return { ok: true, txid: 'dummy' };
    };
    const wallets = ['a', 'b', 'c', 'd', 'e'];
    const splitPct = [0.2, 0.2, 0.2, 0.2, 0.2];
    const totalAmount = 100;
    await parallelFiller({
      totalAmount,
      routes: [],
      wallets,
      splitPct,
      maxParallel: 2,
      idKeyBase: 'id',
      onExecute,
    });
    expect(maxRunning).toBeLessThanOrEqual(2);
  });

  test('partial failures tolerated', async () => {
    const onExecute = async ({ wallet }) => {
      if (wallet === 'b' || wallet === 'd') {
        throw new Error('fail');
      }
      return { ok: true, txid: wallet };
    };
    const wallets = ['a', 'b', 'c', 'd'];
    const splitPct = [0.25, 0.25, 0.25, 0.25];
    const res = await parallelFiller({
      totalAmount: 100,
      routes: [],
      wallets,
      splitPct,
      maxParallel: 3,
      idKeyBase: 'base',
      onExecute,
    });
    expect(res.summary.okCount).toBe(2);
    expect(res.summary.failCount).toBe(2);
  });

  test('rounding sums within ±1', async () => {
    const onExecute = async () => ({ ok: true });
    const wallets = ['a', 'b', 'c'];
    const splitPct = [0.33, 0.33, 0.34];
    const totalAmount = 1000;
    const res = await parallelFiller({
      totalAmount,
      routes: [],
      wallets,
      splitPct,
      maxParallel: 2,
      idKeyBase: 'base',
      onExecute,
    });
    const diff = Math.abs(res.summary.allocatedTotal - Math.floor(totalAmount));
    expect(diff).toBeLessThanOrEqual(1);
  });

  test('idKey suffix logic', async () => {
    const capturedIds = [];
    const onExecute = async ({ idKey }) => {
      capturedIds.push(idKey);
      return { ok: true };
    };
    const wallets = ['x', 'y', 'z'];
    const splitPct = [1/3, 1/3, 1/3];
    await parallelFiller({
      totalAmount: 99,
      routes: [],
      wallets,
      splitPct,
      maxParallel: 2,
      idKeyBase: 'baseKey',
      onExecute,
    });
    expect(capturedIds).toEqual(['baseKey-w0', 'baseKey-w1', 'baseKey-w2']);
  });
});