// backend/services/strategies/test/turboSniperTest.js
//
// Example test script demonstrating how to exercise the various
// features of the Turbo Sniper implementation. These tests are
// intentionally lightweight and use stubs/mocks where necessary to
// avoid hitting external Solana RPCs or pump.fun feeds. Run with
// `node backend/services/strategies/test/turboSniperTest.js` from
// your project root.

const TradeExecutorTurbo = require('../core/tradeExecutorTurbo');
const LeaderScheduler = require('../core/leaderScheduler');
const ParallelFiller = require('../core/parallelFiller');
const pumpfunListener = require('../pumpfun/listener');
const airdropSniffer = require('../../airdrops/sniffer');
const { Connection, PublicKey } = require('@solana/web3.js');

async function testLeaderTiming() {
  console.log('Testing leader scheduling hold logic...');
  // Mock connection with constant slot and leader schedule
  const connection = {
    getEpochInfo: async () => ({ epoch: 1 }),
    getRecentPerformanceSamples: async () => [{ samplePeriodSecs: 1, numSlots: 2 }],
    getLeaderSchedule: async () => ({
      // Use dummy validator identity
      [new PublicKey('11111111111111111111111111111111').toString()]: ['100', '101', '105'],
    }),
    getSlot: async () => 99,
  };
  const scheduler = new LeaderScheduler(connection, '11111111111111111111111111111111');
  const { holdMs } = await scheduler.shouldHoldAndFire(Date.now(), { enabled: true, preflightMs: 220, windowSlots: 2 });
  console.log('Expected holdMs > 0, got:', holdMs);
}

async function testRetryMatrix() {
  console.log('Testing retry matrix with forced failures...');
  // Mock connection
  const connection = new Connection('https://api.devnet.solana.com');
  const executor = new TradeExecutorTurbo({ connection, validatorIdentity: '11111111111111111111111111111111' });
  // Stub buildAndSubmit to fail twice then succeed
  let calls = 0;
  executor.buildAndSubmit = async () => {
    calls++;
    if (calls < 3) throw new Error('forced failure');
    return 'deadbeef';
  };
  const result = await executor.executeTrade({ userId: 'u', walletId: 'w' }, { inputMint: 'So111...', outputMint: 'Mint', amount: 1, slippage: 0.5 }, { retryPolicy: { max: 3, bumpCuStep: 1, bumpTipStep: 1 } });
  console.log('Result after forced retries:', result);
}

async function testParallelFiller() {
  console.log('Testing parallel filler...');
  // Stub loadWalletKeypair
  ParallelFiller.__proto__.constructor.loadWalletKeypair = async (id) => ({ id });
  const start = Date.now();
  const result = await ParallelFiller.execute({
    walletIds: ['w1', 'w2'],
    splitPct: [0.5, 0.5],
    maxParallel: 2,
    tradeParams: { amount: 2 },
    idKey: 'id',
    executor: async () => {
      await new Promise((r) => setTimeout(r, Math.random() * 100));
      return { success: true };
    },
  });
  console.log('Parallel filler returned:', result, 'in', Date.now() - start, 'ms');
}

async function testPumpfunListener() {
  console.log('Testing pumpfun listener with simulated event...');
  pumpfunListener.on('snipe', (event) => {
    console.log('Received snipe event:', event);
  });
  // Start listener with low thresholds and short cooldown
  pumpfunListener.start({ enabled: true, thresholdPct: 0.0, minSolLiquidity: 0, cooldownSec: 1 });
  // Simulate a message by sending directly to the internal handler
  pumpfunListener.emit('snipe', { mint: 'MINT', curvePct: 0.6, liquiditySol: 20 });
  // Stop immediately
  pumpfunListener.stop();
}

async function testAirdropSniffer() {
  console.log('Testing airdrop sniffer requires a live connection and is not simulated here.');
  console.log('Subscribe to token accounts and transfer a small amount to trigger auto sell.');
}

async function run() {
  await testLeaderTiming();
  await testRetryMatrix();
  await testParallelFiller();
  await testPumpfunListener();
  await testAirdropSniffer();
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});