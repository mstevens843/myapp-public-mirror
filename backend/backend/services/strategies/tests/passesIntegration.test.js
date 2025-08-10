/*
 * passesIntegration.test.js
 *
 * Integration tests for the pre‑quote risk gating in the turbo trade
 * executor.  These tests verify that tokens breaching developer/creator
 * heuristics (holder concentration, LP burn percentage and blacklist
 * membership) are blocked before any quote retrieval.  They also ensure
 * that whitelisted tokens bypass the gate and that API errors in the
 * heuristics do not cause the executor to throw.  The tests stub out
 * external dependencies via require.cache to simulate different
 * scenarios without hitting real networks or databases.
 */

'use strict';

const assert = require('assert');
const path = require('path');

// -----------------------------------------------------------------------------
// Module intercepts
//
// Some third‑party modules (e.g. 'uuid', '@solana/web3.js') may not be
// available in the testing environment.  To prevent require() from throwing
// an exception we patch the global Module.prototype.require.  For any
// unresolved identifiers we return lightweight stubs that expose only the
// properties consumed by tradeExecutorTurbo.  These stubs are inert and
// should not be used beyond the confines of these tests.  If additional
// dependencies cause resolution errors they can be added to the dispatch
// below.
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function patchedRequire(id) {
  // Stub uuid module
  if (id === 'uuid') {
    return { v4: () => '00000000-0000-0000-0000-000000000000' };
  }
  // Stub bs58 for base58 encoding/decoding
  if (id === 'bs58') {
    return {
      // Return 64-byte buffer for secret keys so that loadWalletKeypairArmAware
      // can construct a dummy Keypair.  Without this the executor will
      // throw an invalid length error.
      decode: (s) => Buffer.alloc(64),
      encode: (buf) => '',
    };
  }
  // Stub dotenv to provide a no‑op config loader
  if (id === 'dotenv') {
    return { config: () => ({ parsed: {} }) };
  }
  // Stub node-fetch to return a dummy fetch that resolves to empty JSON
  if (id === 'node-fetch') {
    const dummy = async () => ({ json: async () => ({}) });
    return dummy;
  }
  // Stub axios with noop get/post methods returning empty objects
  if (id === 'axios') {
    return {
      get: async () => ({ data: {} }),
      post: async () => ({ data: {} }),
    };
  }
  // Stub @solana/web3.js with minimal classes/functions
  if (id === '@solana/web3.js') {
    class DummyKeypair {
      constructor() {
        this.publicKey = {
          toBase58: () => '',
          toString: () => '',
        };
      }
      static fromSecretKey() {
        return new DummyKeypair();
      }
    }
    class DummyConnection {
      constructor() {}
      getSlot() { return 0; }
      getLatestBlockhash() { return { blockhash: '', lastValidBlockHeight: 0 }; }
      sendRawTransaction() { return 'tx'; }
      confirmTransaction() { return {}; }
      onProgramAccountChange() { return 0; }
      removeProgramAccountChangeListener() { }
    }
    class DummyPublicKey {
      constructor() {}
      static toString() { return ''; }
      toBase58() { return ''; }
    }
    class DummyTransaction {
      constructor() {}
      add() { return this; }
      serialize() { return Buffer.from([]); }
      sign() {}
    }
    class DummyVersionedTransaction {
      static deserialize() { return new DummyVersionedTransaction(); }
    }
    return {
      Keypair: DummyKeypair,
      Connection: DummyConnection,
      PublicKey: DummyPublicKey,
      Transaction: DummyTransaction,
      VersionedTransaction: DummyVersionedTransaction,
    };
  }
  // Stub @solana/spl-token if required
  if (id === '@solana/spl-token') {
    return {
      TOKEN_PROGRAM_ID: {},
      getAssociatedTokenAddress: async () => '',
      getOrCreateAssociatedTokenAccount: async () => ({}),
      getMint: async () => ({ freezeAuthority: null }),
      createTransferInstruction: () => ({}),
    };
  }
  // Stub raydiumDirect used by tradeExecutorTurbo.  The real module is
  // located under backend/services/core or utils depending on build, but
  // isn't present in this environment.  Provide a noop directSwap to avoid
  // resolution errors during tests.
  if (id.includes('raydiumDirect')) {
    return {
      directSwap: async () => {
        // Do nothing in tests; raydium direct swap is out of scope.
        return { txid: '', metadata: {} };
      },
    };
  }
  // Stub relayClient (under ./relays/relayClient) which may be absent.  The
  // turbo executor imports a class from this file; provide a dummy class
  // implementing minimal methods used (none in these tests).
  if (id.includes('/relays/relayClient')) {
    return class DummyRelayClient {
      constructor() {}
      async send() {
        return { txid: '', result: {} };
      }
    };
  }
  // Stub argon2 dependency used in envelopeCrypto.  Provide hash/verify
  // methods that satisfy the interface but do nothing.
  if (id === 'argon2') {
    return {
      hash: async () => '',
      verify: async () => true,
    };
  }
  // Stub the encryption middleware which requires ENCRYPTION_SECRET env var.
  // Provide dummy encrypt/decrypt functions to avoid environment errors.
  if (id.includes('/middleware/auth/encryption')) {
    return {
      encrypt: (input) => input,
      decrypt: (payload) => payload,
    };
  }
  // Stub telegram alerts module.  The turbo executor triggers sendAlert
  // for various events; to avoid downstream DB calls or side effects,
  // provide a no‑op implementation.
  if (id.includes('/telegram/alerts')) {
    return {
      sendAlert: async () => {},
    };
  }
  // Fallback to original require
  return originalRequire.apply(this, arguments);
};

/**
 * Helper to resolve a module relative to this test file.  Using
 * require.resolve with the "paths" option allows resolution to follow the
 * same algorithm that tradeExecutorTurbo uses when importing its
 * dependencies.  Without this the stubs would not be correctly picked up
 * by require() inside the tested module.
 * @param {string} rel Relative path from the test directory
 */
function resolve(rel) {
  return require.resolve(rel, { paths: [__dirname] });
}

/**
 * Replace a module in the require cache with a stub.  The stub must
 * provide the exports expected by the consumer.  Any original cache entry
 * is returned so it can be restored later.  If no entry exists, null is
 * returned.  The id and filename fields are set on the stub to appease
 * Node's module system.
 *
 * @param {string} modulePath Resolved module path
 * @param {object} stubExports Export object to inject
 * @returns {object|null} The original module cache entry or null
 */
function stubModule(modulePath, stubExports) {
  const orig = require.cache[modulePath] || null;
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: stubExports,
  };
  return orig;
}

/**
 * Restore a module cache entry.  If the original entry was null, the
 * module will be deleted from the cache.  Otherwise the original entry is
 * restored.
 * @param {string} modulePath Resolved module path
 * @param {object|null} original Original cache entry
 */
function restoreModule(modulePath, original) {
  if (!original) {
    delete require.cache[modulePath];
  } else {
    require.cache[modulePath] = original;
  }
}

/**
 * Reset the executor and its dependencies by clearing them from the
 * require cache.  This ensures that each test uses a fresh copy of
 * tradeExecutorTurbo with its dependencies re‑evaluated against our
 * stubs.  Without this the first import would permanently capture the
 * original modules.
 * @param {string[]} extraModules Additional modules to delete
 */
function clearModules(extraModules = []) {
  const modulesToClear = [
    resolve('../core/tradeExecutorTurbo.js'),
    resolve('../core/quoteHelper.js'),
    resolve('../core/passes.js'),
    ...extraModules.map((m) => resolve(m)),
  ];
  modulesToClear.forEach((m) => {
    delete require.cache[m];
  });
}

/**
 * Create a basic user context and trade parameters for tests.  The
 * userCtx must include userId and walletId to satisfy the executor.
 * The tradeParams specify a trivial swap from SOL into an arbitrary
 * token with a nominal amount and slippage.
 */
const defaultUserCtx = { userId: 'user', walletId: 'wallet' };
const defaultTradeParams = {
  inputMint: 'So11111111111111111111111111111111111111112',
  outputMint: 'Mint',
  amount: '1000',
  slippage: 0.01,
};

async function testHolderConcentrationFail() {
  // Configure stubs: holder concentration above threshold triggers a block
  const stubs = [];
  // Stub metrics with incCounter and increment functions
  const metricsPath = resolve('../logging/metrics.js');
  stubs.push({ path: metricsPath, orig: stubModule(metricsPath, {
    incCounter: () => {},
    increment: () => {},
    observe: () => {},
  }) });
  // Stub holderConcentration: return 90% (above threshold)
  const hcPath = resolve('../paid_api/holderConcentration.js');
  stubs.push({ path: hcPath, orig: stubModule(hcPath, {
    estimateHolderConcentration: async () => 90,
  }) });
  // Stub lpBurnPct: return high value so LP burn passes
  const lpPath = resolve('../paid_api/lpBurnPct.js');
  stubs.push({ path: lpPath, orig: stubModule(lpPath, {
    estimateLpBurnPct: async () => 100,
  }) });
  // Stub insiderDetector: returns ok
  const insPath = resolve('../core/heuristics/insiderDetector.js');
  stubs.push({ path: insPath, orig: stubModule(insPath, {
    insiderDetector: async () => ({ ok: true }),
  }) });
  // Stub overview: returns dummy values
  const overviewPath = resolve('../paid_api/getTokenShortTermChanges.js');
  stubs.push({ path: overviewPath, orig: stubModule(overviewPath, async () => ({ price: 1, priceChange: 1, volumeUSD: 1, marketCap: 1 })) });
  // Stub swap getSwapQuote: record calls; should not be called when blocked
  let swapCalled = false;
  const swapPath = resolve('../../../utils/swap.js');
  stubs.push({ path: swapPath, orig: stubModule(swapPath, {
    getSwapQuote: async () => {
      swapCalled = true;
      return null;
    },
    executeSwap: async () => {
      throw new Error('executeSwap should not be called');
    },
    executeSwapTurbo: async () => {
      throw new Error('executeSwapTurbo should not be called');
    },
  }) });
  // Stub getTokenPrice module as a callable function with a getSolPrice method
  const getTokenPricePath = resolve('../paid_api/getTokenPrice.js');
  const stubGetTokenPrice = (...args) => null;
  stubGetTokenPrice.getSolPrice = async () => 1;
  stubs.push({ path: getTokenPricePath, orig: stubModule(getTokenPricePath, stubGetTokenPrice) });
  // Stub prisma to avoid DB hits
  const prismaPath = resolve('../../../prisma/prisma.js');
  stubs.push({ path: prismaPath, orig: stubModule(prismaPath, {
    wallet: { findUnique: async () => ({ encrypted: null, isProtected: false, privateKey: 'dummy' }) },
    user: { findUnique: async () => ({ requireArmToTrade: false }) },
    userPreference: { findUnique: async () => null },
    trade: { findFirst: async () => null, create: async () => null },
    tpSlRule: { create: async () => null },
  }) });
  // Clear cached modules to ensure stubs are picked up
  clearModules();
  const TradeExecutorTurbo = require('../core/tradeExecutorTurbo.js');
  const executor = new TradeExecutorTurbo({});
  const cfg = { devWatch: { maxHolderPercent: 50 } };
  const res = await executor.executeTrade(defaultUserCtx, defaultTradeParams, cfg);
  // Cleanup stubs
  stubs.forEach(({ path: p, orig }) => restoreModule(p, orig));
  clearModules();
  assert.ok(res && res.blocked, 'Expected trade to be blocked');
  assert.strictEqual(res.reason, 'dev-fail', 'Expected reason to be dev-fail');
  assert.strictEqual(res.detail, 'holder-concentration', 'Expected detail to be holder-concentration');
  assert.strictEqual(swapCalled, false, 'getSwapQuote should not be called when blocked');
}

async function testLpBurnFail() {
  const stubs = [];
  // Metrics stub
  const metricsPath = resolve('../logging/metrics.js');
  stubs.push({ path: metricsPath, orig: stubModule(metricsPath, {
    incCounter: () => {},
    increment: () => {},
    observe: () => {},
  }) });
  // Holder concentration returns low (pass)
  const hcPath = resolve('../paid_api/holderConcentration.js');
  stubs.push({ path: hcPath, orig: stubModule(hcPath, {
    estimateHolderConcentration: async () => 10,
  }) });
  // LP burn returns below threshold
  const lpPath = resolve('../paid_api/lpBurnPct.js');
  stubs.push({ path: lpPath, orig: stubModule(lpPath, {
    estimateLpBurnPct: async () => 5,
  }) });
  // Insider ok
  const insPath = resolve('../core/heuristics/insiderDetector.js');
  stubs.push({ path: insPath, orig: stubModule(insPath, {
    insiderDetector: async () => ({ ok: true }),
  }) });
  // Overview stub
  const overviewPath = resolve('../paid_api/getTokenShortTermChanges.js');
  stubs.push({ path: overviewPath, orig: stubModule(overviewPath, async () => ({ price: 1, priceChange: 1, volumeUSD: 1, marketCap: 1 })) });
  // Swap stub
  let swapCalled = false;
  const swapPath = resolve('../../../utils/swap.js');
  stubs.push({ path: swapPath, orig: stubModule(swapPath, {
    getSwapQuote: async () => { swapCalled = true; return null; },
    executeSwap: async () => { throw new Error('executeSwap should not be called'); },
    executeSwapTurbo: async () => { throw new Error('executeSwapTurbo should not be called'); },
  }) });
  // Token price stub as callable
  const getTokenPricePath = resolve('../paid_api/getTokenPrice.js');
  const stubGetTokenPrice = (...args) => null;
  stubGetTokenPrice.getSolPrice = async () => 1;
  stubs.push({ path: getTokenPricePath, orig: stubModule(getTokenPricePath, stubGetTokenPrice) });
  // Prisma stub
  const prismaPath = resolve('../../../prisma/prisma.js');
  stubs.push({ path: prismaPath, orig: stubModule(prismaPath, {
    wallet: { findUnique: async () => ({ encrypted: null, isProtected: false, privateKey: 'dummy' }) },
    user: { findUnique: async () => ({ requireArmToTrade: false }) },
    userPreference: { findUnique: async () => null },
    trade: { findFirst: async () => null, create: async () => null },
    tpSlRule: { create: async () => null },
  }) });
  clearModules();
  const TradeExecutorTurbo = require('../core/tradeExecutorTurbo.js');
  const executor = new TradeExecutorTurbo({});
  const cfg = { devWatch: { minLpBurnPercent: 10 } };
  const res = await executor.executeTrade(defaultUserCtx, defaultTradeParams, cfg);
  stubs.forEach(({ path: p, orig }) => restoreModule(p, orig));
  clearModules();
  assert.ok(res && res.blocked, 'Expected trade to be blocked');
  assert.strictEqual(res.reason, 'dev-fail');
  assert.strictEqual(res.detail, 'lp-burn-low');
  assert.strictEqual(swapCalled, false, 'getSwapQuote should not be called when blocked');
}

async function testBlacklist() {
  const stubs = [];
  // Metrics stub
  const metricsPath = resolve('../logging/metrics.js');
  stubs.push({ path: metricsPath, orig: stubModule(metricsPath, {
    incCounter: () => {},
    increment: () => {},
    observe: () => {},
  }) });
  // Heuristics stubs not needed for blacklist
  // Overview stub
  const overviewPath = resolve('../paid_api/getTokenShortTermChanges.js');
  stubs.push({ path: overviewPath, orig: stubModule(overviewPath, async () => ({ price: 1, priceChange: 1, volumeUSD: 1, marketCap: 1 })) });
  // Swap stub
  let swapCalled = false;
  const swapPath = resolve('../../../utils/swap.js');
  stubs.push({ path: swapPath, orig: stubModule(swapPath, {
    getSwapQuote: async () => { swapCalled = true; return null; },
    executeSwap: async () => { throw new Error('executeSwap should not be called'); },
    executeSwapTurbo: async () => { throw new Error('executeSwapTurbo should not be called'); },
  }) });
  // Token price stub as callable
  const getTokenPricePath = resolve('../paid_api/getTokenPrice.js');
  const stubGetTokenPrice = (...args) => null;
  stubGetTokenPrice.getSolPrice = async () => 1;
  stubs.push({ path: getTokenPricePath, orig: stubModule(getTokenPricePath, stubGetTokenPrice) });
  // Prisma stub
  const prismaPath = resolve('../../../prisma/prisma.js');
  stubs.push({ path: prismaPath, orig: stubModule(prismaPath, {
    wallet: { findUnique: async () => ({ encrypted: null, isProtected: false, privateKey: 'dummy' }) },
    user: { findUnique: async () => ({ requireArmToTrade: false }) },
    userPreference: { findUnique: async () => null },
    trade: { findFirst: async () => null, create: async () => null },
    tpSlRule: { create: async () => null },
  }) });
  clearModules();
  const TradeExecutorTurbo = require('../core/tradeExecutorTurbo.js');
  const executor = new TradeExecutorTurbo({});
  const cfg = { devWatch: { blacklist: ['Mint'] } };
  const res = await executor.executeTrade(defaultUserCtx, defaultTradeParams, cfg);
  stubs.forEach(({ path: p, orig }) => restoreModule(p, orig));
  clearModules();
  assert.ok(res && res.blocked, 'Expected trade to be blocked');
  assert.strictEqual(res.reason, 'dev-fail');
  assert.strictEqual(res.detail, 'blacklist');
  assert.strictEqual(swapCalled, false, 'getSwapQuote should not be called when blocked');
}

async function testWhitelistBypass() {
  const stubs = [];
  // Metrics stub
  const metricsPath = resolve('../logging/metrics.js');
  stubs.push({ path: metricsPath, orig: stubModule(metricsPath, {
    incCounter: () => {},
    increment: () => {},
    observe: () => {},
  }) });
  // Heuristics: return values that would normally block to verify whitelist bypass
  const hcPath = resolve('../paid_api/holderConcentration.js');
  stubs.push({ path: hcPath, orig: stubModule(hcPath, {
    estimateHolderConcentration: async () => 99,
  }) });
  const lpPath = resolve('../paid_api/lpBurnPct.js');
  stubs.push({ path: lpPath, orig: stubModule(lpPath, {
    estimateLpBurnPct: async () => 0,
  }) });
  const insPath = resolve('../core/heuristics/insiderDetector.js');
  stubs.push({ path: insPath, orig: stubModule(insPath, {
    insiderDetector: async () => ({ ok: false, reason: 'insider' }),
  }) });
  // Overview stub
  const overviewPath = resolve('../paid_api/getTokenShortTermChanges.js');
  stubs.push({ path: overviewPath, orig: stubModule(overviewPath, async () => ({ price: 1, priceChange: 1, volumeUSD: 1, marketCap: 1 })) });
  // Swap stub: record quote calls; return dummy
  let swapCalled = false;
  const swapPath = resolve('../../../utils/swap.js');
  stubs.push({ path: swapPath, orig: stubModule(swapPath, {
    getSwapQuote: async () => {
      swapCalled = true;
      return { outAmount: '500', priceImpactPct: 0.01, inAmount: defaultTradeParams.amount, inputMint: defaultTradeParams.inputMint, outputMint: defaultTradeParams.outputMint };
    },
    // Do not throw on executeSwap/executeSwapTurbo; return dummy result to
    // satisfy execTrade path without actually performing a swap.
    executeSwap: async () => ({ txid: 'dummy', result: {} }),
    executeSwapTurbo: async () => ({ txid: 'dummy', result: {} }),
  }) });
  // getSafeQuote stub: call getSwapQuote and return ok
  const quoteHelperPath = resolve('../core/quoteHelper.js');
  stubs.push({ path: quoteHelperPath, orig: stubModule(quoteHelperPath, {
    getSafeQuote: async ({ inputMint, outputMint, amount, slippage }) => {
      // call getSwapQuote via stub
      const swap = require('../../../utils/swap.js');
      const quote = await swap.getSwapQuote({ inputMint, outputMint, amount, slippage });
      if (!quote) return { ok: false, reason: 'no-route' };
      return { ok: true, quote: Object.assign({ slippage }, quote) };
    },
  }) });
  // Stub execTrade to avoid full path; return simple response
  const executorModulePath = resolve('../core/tradeExecutorTurbo.js');
  // We will patch after requiring; but to patch we need to restore original after stub; we'll patch in place after require
  // Token price stub as callable
  const getTokenPricePath = resolve('../paid_api/getTokenPrice.js');
  const stubGetTokenPrice = (...args) => null;
  stubGetTokenPrice.getSolPrice = async () => 1;
  stubs.push({ path: getTokenPricePath, orig: stubModule(getTokenPricePath, stubGetTokenPrice) });
  // Prisma stub
  const prismaPath = resolve('../../../prisma/prisma.js');
  stubs.push({ path: prismaPath, orig: stubModule(prismaPath, {
    wallet: { findUnique: async () => ({ encrypted: null, isProtected: false, privateKey: 'dummy' }) },
    user: { findUnique: async () => ({ requireArmToTrade: false }) },
    userPreference: { findUnique: async () => null },
    trade: { findFirst: async () => null, create: async () => null },
    tpSlRule: { create: async () => null },
  }) });
  clearModules([ '../core/quoteHelper.js' ]);
  const TradeExecutorTurbo = require('../core/tradeExecutorTurbo.js');
  // Patch execTrade on the module export so that executeTrade uses our stub
  // We cannot override the lexical execTrade used within executeTrade; instead
  // rely on our stubs for executeSwap* to avoid side effects.
  const executor = new TradeExecutorTurbo({});
  // Provide a strategy name to avoid undefined strategy in execTrade post‑side‑effects
  const cfg = { devWatch: { whitelist: ['Mint'] }, strategy: 'test' };
  const res = await executor.executeTrade(defaultUserCtx, defaultTradeParams, cfg);
  stubs.forEach(({ path: p, orig }) => restoreModule(p, orig));
  clearModules();
  // In whitelist scenario the trade should not be blocked and quote should be attempted
  assert.ok(!res.blocked, 'Whitelisted token should not be blocked');
  assert.ok(swapCalled, 'getSwapQuote should be called for whitelisted token');
}

async function testApiErrorSoftFail() {
  const stubs = [];
  // Metrics stub
  const metricsPath = resolve('../logging/metrics.js');
  stubs.push({ path: metricsPath, orig: stubModule(metricsPath, {
    incCounter: () => {},
    increment: () => {},
    observe: () => {},
  }) });
  // Heuristics throw errors
  const hcPath = resolve('../paid_api/holderConcentration.js');
  stubs.push({ path: hcPath, orig: stubModule(hcPath, {
    estimateHolderConcentration: async () => { throw new Error('api error'); },
  }) });
  const lpPath = resolve('../paid_api/lpBurnPct.js');
  stubs.push({ path: lpPath, orig: stubModule(lpPath, {
    estimateLpBurnPct: async () => { throw new Error('api error'); },
  }) });
  const insPath = resolve('../core/heuristics/insiderDetector.js');
  stubs.push({ path: insPath, orig: stubModule(insPath, {
    insiderDetector: async () => { throw new Error('api error'); },
  }) });
  // Overview stub
  const overviewPath = resolve('../paid_api/getTokenShortTermChanges.js');
  stubs.push({ path: overviewPath, orig: stubModule(overviewPath, async () => ({ price: 1, priceChange: 1, volumeUSD: 1, marketCap: 1 })) });
  // Swap stub: record call
  let swapCalled = false;
  const swapPath = resolve('../../../utils/swap.js');
  stubs.push({ path: swapPath, orig: stubModule(swapPath, {
    getSwapQuote: async () => {
      swapCalled = true;
      return { outAmount: '500', priceImpactPct: 0.01, inAmount: defaultTradeParams.amount, inputMint: defaultTradeParams.inputMint, outputMint: defaultTradeParams.outputMint };
    },
    // When heuristics soft‑fail the executor will proceed to execTrade and
    // attempt to perform a swap.  Provide dummy implementations that do not
    // throw so the test can complete.  These return minimal objects to
    // satisfy call sites.
    executeSwap: async () => ({ txid: 'dummy', result: {} }),
    executeSwapTurbo: async () => ({ txid: 'dummy', result: {} }),
  }) });
  // getSafeQuote stub
  const quoteHelperPath = resolve('../core/quoteHelper.js');
  stubs.push({ path: quoteHelperPath, orig: stubModule(quoteHelperPath, {
    getSafeQuote: async ({ inputMint, outputMint, amount, slippage }) => {
      const swap = require('../../../utils/swap.js');
      const quote = await swap.getSwapQuote({ inputMint, outputMint, amount, slippage });
      if (!quote) return { ok: false, reason: 'no-route' };
      return { ok: true, quote: Object.assign({ slippage }, quote) };
    },
  }) });
  // Token price stub as callable
  const getTokenPricePath = resolve('../paid_api/getTokenPrice.js');
  const stubGetTokenPrice = (...args) => null;
  stubGetTokenPrice.getSolPrice = async () => 1;
  stubs.push({ path: getTokenPricePath, orig: stubModule(getTokenPricePath, stubGetTokenPrice) });
  // Prisma stub
  const prismaPath = resolve('../../../prisma/prisma.js');
  stubs.push({ path: prismaPath, orig: stubModule(prismaPath, {
    wallet: { findUnique: async () => ({ encrypted: null, isProtected: false, privateKey: 'dummy' }) },
    user: { findUnique: async () => ({ requireArmToTrade: false }) },
    userPreference: { findUnique: async () => null },
    trade: { findFirst: async () => null, create: async () => null },
    tpSlRule: { create: async () => null },
  }) });
  clearModules([ '../core/quoteHelper.js' ]);
  const TradeExecutorTurbo = require('../core/tradeExecutorTurbo.js');
  // Patch execTrade to avoid heavy logic
  const originalExecTrade = TradeExecutorTurbo.execTrade;
  TradeExecutorTurbo.execTrade = async ({ quote, mint, meta, simulated }) => {
    return { status: 'SOFT_OK', quote, meta };
  };
  const executor = new TradeExecutorTurbo({});
  // Provide a strategy to avoid undefined strategy in execTrade
  const cfg = { devWatch: { maxHolderPercent: 50, minLpBurnPercent: 20, enableInsiderHeuristics: true }, strategy: 'test' };
  const res = await executor.executeTrade(defaultUserCtx, defaultTradeParams, cfg);
  // Restore execTrade
  TradeExecutorTurbo.execTrade = originalExecTrade;
  stubs.forEach(({ path: p, orig }) => restoreModule(p, orig));
  clearModules();
  // API errors should not block; passes should soft‑fail and allow quoting
  assert.ok(!res.blocked, 'API error in heuristics should not block');
  assert.ok(swapCalled, 'getSwapQuote should still be called on soft‑fail');
}

async function run() {
  await testHolderConcentrationFail();
  await testLpBurnFail();
  await testBlacklist();
  await testWhitelistBypass();
  await testApiErrorSoftFail();
  console.log('passesIntegration.test.js passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});