const path = require('path');

/*
 * metricsRedaction.test.js
 *
 * This Jest test verifies that the turbo trade executor emits the
 * expected observability metrics, classifies submit results correctly and
 * avoids leaking any sensitive identifiers (such as user IDs, wallet
 * IDs or full public keys) into metric labels.  The test suite mocks
 * out all of the heavy dependencies so that execTrade can run in
 * isolation.  Under the happy path we expect exactly one observation
 * for each stage (quote, build, sign, submit and total) and one
 * increment on the submit_result_total counter with errorClass: 'NONE'.
 * When the underlying swap throws various errors, the executor should
 * classify them into NET, USER or UNKNOWN and increment the result
 * matrix accordingly.  See README for details.
 */

// --- Mock external dependencies ---

// Mock the metrics logger to capture observe/increment calls.  We do this
// early so that the require of the executor picks up the stub.
jest.mock('../logging/metrics', () => {
  return {
    observe: jest.fn(),
    increment: jest.fn(),
  };
});

// Mock Prisma ORM calls used by loadWalletKeypairArmAware.  We return
// deterministic rows so the executor can build a dummy wallet without
// touching any database.  Note: the returned object must include the
// expected nested shape for encrypted keys.
jest.mock('../../../prisma/prisma', () => {
  return {
    wallet: {
      findUnique: jest.fn().mockImplementation(() =>
        Promise.resolve({ encrypted: { v: 1 }, isProtected: false })
      ),
    },
    user: {
      findUnique: jest.fn().mockImplementation(() =>
        Promise.resolve({ requireArmToTrade: false })
      ),
    },
  };
});

// Mock envelope decryption helpers.  The executor uses these to unwrap
// the secret key into a Keypair.  We return a 64‑byte buffer so that
// Keypair.fromSecretKey succeeds.
jest.mock('../../../armEncryption/sessionKeyCache', () => {
  return {
    getDEK: jest.fn().mockImplementation(() => Buffer.from('dummyDek')),
  };
});
jest.mock('../../../armEncryption/envelopeCrypto', () => {
  return {
    decryptPrivateKeyWithDEK: jest.fn().mockImplementation(() =>
      // 64 bytes of 1s
      Buffer.alloc(64, 1)
    ),
  };
});
jest.mock('../../../middleware/auth/encryption', () => {
  return {
    decrypt: jest.fn().mockImplementation(() => 'dummyBase58Secret'),
  };
});

// Mock Solana Web3 classes.  We stub Connection to have the minimal
// methods used by the executor.  Keypair.fromSecretKey returns a dummy
// object exposing a redacted publicKey.  PublicKey is a simple wrapper.
jest.mock('@solana/web3.js', () => {
  class Connection {
    constructor(rpc, commitment) {
      this._rpcEndpoint = rpc;
    }
    getLatestBlockhash() {
      return Promise.resolve({ blockhash: 'abcd', lastValidBlockHeight: 1 });
    }
    getSlot() {
      return Promise.resolve(123);
    }
  }
  const Keypair = {
    fromSecretKey: jest.fn().mockImplementation(() => {
      return {
        publicKey: {
          toBase58: () => 'DummyPubKeyXXXX',
          toString: () => 'DummyPubKeyXXXX',
        },
      };
    }),
  };
  function PublicKey(value) {
    return {
      toBase58: () => value,
      toString: () => value,
    };
  }
  return { Connection, Keypair, PublicKey };
});

// Mock swap utilities.  executeSwapTurbo returns a fake transaction hash
// under the happy path.  We also stub executeSwapJitoBundle and
// getSwapQuote.  The quote values are deliberately large enough to
// bypass minimum amount checks in the sizing logic.
jest.mock('../../../utils/swap', () => {
  return {
    executeSwapTurbo: jest.fn().mockImplementation(() =>
      Promise.resolve('fakeTxHash1234')
    ),
    executeSwapJitoBundle: jest.fn().mockImplementation(() =>
      Promise.resolve('fakeTxHashJito')
    ),
    getSwapQuote: jest.fn().mockImplementation(({ inputMint, outputMint, amount }) =>
      Promise.resolve({
        inputMint,
        outputMint,
        inAmount: amount,
        outAmount: String(Number(amount) * 0.5),
        priceImpactPct: 0.01,
      })
    ),
  };
});

// Mock token account helper so that decimals lookup returns 9.
jest.mock('../../../utils/tokenAccounts', () => {
  return {
    getMintDecimals: jest.fn().mockResolvedValue(9),
  };
});

// Mock price API.  We return null/zero for token and SOL prices.
jest.mock('../paid_api/getTokenPrice', () => {
  const fn = jest.fn().mockImplementation(() => Promise.resolve(null));
  fn.getSolPrice = jest.fn().mockImplementation(() => Promise.resolve(0));
  return fn;
});

// Mock Telegram alerts; alerts are ignored in tests.
jest.mock('../../../telegram/alerts', () => {
  return {
    sendAlert: jest.fn(),
  };
});

// Mock tx tracker; we capture but ignore calls.
jest.mock('../core/txTracker', () => {
  return {
    trackPendingTrade: jest.fn(),
  };
});

// Mock SlippageGovernor to a no‑op class.  The postTrade method is
// stubbed so that calls succeed.
jest.mock('../core/slippageGovernor', () => {
  return {
    SlippageGovernor: jest.fn().mockImplementation(() => {
      return {
        postTrade: jest.fn(),
      };
    }),
  };
});

// Mock post trade queue so enqueue is a no‑op.
jest.mock('../core/postTradeQueue', () => {
  return {
    enqueue: jest.fn(),
  };
});

// Mock leader scheduler; unused in test.
jest.mock('../core/leaderScheduler', () => {
  return jest.fn().mockImplementation(() => {
    return {};
  });
});

// Mock quote warm cache; returns null to always fetch fresh quotes.
jest.mock('../core/quoteWarmCache', () => {
  return class QuoteWarmCache {
    constructor(opts) {
      // ignore options
    }
    get(key) {
      return null;
    }
    set(key, val) {
      // no‑op
    }
  };
});

// Mock Jito fee controller; returns zeroed fees.
jest.mock('../core/jitoFeeController', () => {
  return jest.fn().mockImplementation(() => {
    return {
      getFee: jest.fn().mockReturnValue({
        computeUnitPriceMicroLamports: 0,
        tipLamports: 0,
      }),
    };
  });
});

// Mock raydium direct fallback to always return null.
jest.mock('../../../utils/raydiumDirect', () => {
  return {
    directSwap: jest.fn().mockResolvedValue(null),
  };
});

// Mock parallel filler (unused in this test).
jest.mock('../core/parallelFiller', () => {
  return {
    parallelFiller: jest.fn(),
  };
});

// Mock passes check to always pass.  We avoid risk gating logic in tests.
jest.mock('../core/passes', () => {
  return {
    passes: jest.fn().mockResolvedValue({
      passed: true,
      reason: '',
    }),
  };
});

// Mock idempotency store (memory).  We provide get/set no‑ops.
jest.mock('../../../utils/idempotencyStore', () => {
  const store = new Map();
  return {
    get: jest.fn((k) => store.get(k)),
    set: jest.fn((k, v) => {
      store.set(k, v);
    }),
  };
});

// Mock CoreIdemStore to skip disk I/O.  The instance supports init and markSuccess.
jest.mock('../core/idempotencyStore', () => {
  return jest.fn().mockImplementation(() => {
    return {
      init: jest.fn().mockResolvedValue(undefined),
      markSuccess: jest.fn().mockResolvedValue(undefined),
    };
  });
});

// Mock relay client; returns empty acknowledger.
jest.mock('../core/relays/relayClient', () => {
  return jest.fn().mockImplementation(() => {
    return {
      sendTx: jest.fn(),
    };
  });
});

// Mock liquidity sizer to return the base quote unchanged.
jest.mock('../core/liquiditySizer', () => {
  return {
    sizeTrade: jest.fn().mockImplementation(({ baseQuote }) =>
      Promise.resolve({
        inAmount: baseQuote.inAmount,
        outAmount: baseQuote.outAmount,
        priceImpactPct: baseQuote.priceImpactPct,
      })
    ),
  };
});

// Mock probe buyer; unused when probe is disabled.
jest.mock('../core/probeBuyer', () => {
  return {
    performProbe: jest.fn(),
  };
});

// Mock ghost helpers; we return empty implementations.  For
// checkFreezeAuthority we return a fixed string to test redaction.
jest.mock('../core/ghost', () => {
  return {
    forwardTokens: jest.fn(),
    checkFreezeAuthority: jest.fn().mockResolvedValue('FreezeAuthPublicKeyABCDEF'),
  };
});

// Mock RPC quorum client; not used in these tests.
jest.mock('../core/rpcQuorumClient', () => {
  return jest.fn().mockImplementation(() => {
    return {
      getConnections: jest.fn(() => []),
      refreshIfExpired: jest.fn(),
    };
  });
});

// Mock quote helper; unused in our tests but required by module export.
jest.mock('../core/quoteHelper', () => {
  return {
    getSafeQuote: jest.fn(),
  };
});

// Now require the module under test.  It picks up our mocks automatically.
const TradeExecutorTurbo = require('../core/tradeExecutorTurbo.js');
const execTrade = TradeExecutorTurbo.execTrade;
const metrics = require('../logging/metrics');
const swap = require('../../../utils/swap');

describe('TradeExecutorTurbo observability and redaction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('records per‑stage and total timings and result matrix on success', async () => {
    const quote = {
      inputMint: 'So11111111111111111111111111111111111111112',
      outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      inAmount: '1000000',
      outAmount: '500000',
      priceImpactPct: 0.01,
    };
    const mint = quote.outputMint;
    const meta = {
      userId: 'user123',
      walletId: 'wallet123',
      strategy: 'turbo',
      slippage: 1.0,
      quoteTtlMs: 300,
      retryPolicy: { max: 1 },
      idempotency: { ttlSec: 0 },
    };

    const txHash = await execTrade(quote, mint, meta);
    expect(txHash).toBeDefined();

    // Filter observe calls for hotpath_ms
    const hotCalls = metrics.observe.mock.calls.filter(
      ([name]) => name === 'hotpath_ms'
    );
    // Expect one observation per stage: quote, build, sign, submit, total
    expect(hotCalls.length).toBe(5);
    const stages = hotCalls.map((call) => call[2]?.stage);
    expect(new Set(stages)).toEqual(
      new Set(['quote', 'build', 'sign', 'submit', 'total'])
    );
    // submit_result_total incremented once with errorClass NONE
    const incCalls = metrics.increment.mock.calls.filter(
      ([name]) => name === 'submit_result_total'
    );
    expect(incCalls.length).toBe(1);
    expect(incCalls[0][2]).toHaveProperty('errorClass', 'NONE');
    expect(incCalls[0][2]).toHaveProperty('strategy', 'turbo');
    // Ensure no walletId/userId/raw pubkey leaked into labels
    hotCalls.forEach((call) => {
      const labels = call[2] || {};
      Object.values(labels).forEach((val) => {
        if (typeof val === 'string') {
          expect(val.includes('user123')).toBe(false);
          expect(val.includes('wallet123')).toBe(false);
          expect(val.includes('DummyPubKey')).toBe(false);
        }
      });
    });
  });

  // Parameterised failure cases: message and expected classification
  const failureCases = [
    ['node is behind', 'NET'],
    ['slippage exceeded', 'USER'],
    ['some unknown error', 'UNKNOWN'],
  ];
  test.each(failureCases)(
    'increments result matrix with errorClass %s on %s',
    async (msg, expectedClass) => {
      // Override swap to throw error once; subsequent calls fall back to default
      swap.executeSwapTurbo.mockImplementationOnce(() => {
        throw new Error(msg);
      });
      const quote = {
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inAmount: '1000000',
        outAmount: '500000',
        priceImpactPct: 0.01,
      };
      const meta = {
        userId: 'user123',
        walletId: 'wallet123',
        strategy: 'turbo',
        slippage: 1.0,
        quoteTtlMs: 300,
        retryPolicy: { max: 1 },
        idempotency: { ttlSec: 0 },
      };
      await expect(
        execTrade(quote, quote.outputMint, meta)
      ).rejects.toBeDefined();
      // Find the most recent submit_result_total increment
      const calls = metrics.increment.mock.calls.filter(
        ([name]) => name === 'submit_result_total'
      );
      const lastLabels = calls[calls.length - 1][2];
      expect(lastLabels).toHaveProperty('errorClass', expectedClass);
    }
  );
});