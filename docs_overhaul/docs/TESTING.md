# Testing Guide

This guide describes how to verify the correctness of the trading bot.  The public mirror does not include a formal test suite, so testing largely involves running modules in isolation, writing your own tests and using dry‑run modes.

## Unit Testing

1. Identify the module you wish to test (e.g. `utils/swap.js` or `strategies/core/passes.js`).
2. Create a test file under a `tests/` directory (e.g. `tests/swap.test.js`).
3. Use a Node.js testing framework such as [Jest](https://jestjs.io/) or [Mocha](https://mochajs.org/) to write assertions.  Mock network calls to Jupiter and assert that `getSwapQuote` returns expected quotes【913491782795913†L10-L19】.
4. Run your tests with the appropriate test runner.  For example:

```sh
npm install --save-dev jest
npx jest tests/swap.test.js
```

Because this repository does not include a `package.json` with test scripts, you must install and configure your own test framework【913491782795913†L27-L28】.

### Sample Test

```js
// tests/passes.test.js
const { runPasses } = require('../backend/services/strategies/core/passes');

test('fails on large holder concentration', async () => {
  const result = await runPasses({
    tokenAddress: 'TOKEN',
    holderConcentration: 0.9,
    // ... other fields
  });
  expect(result.ok).toBe(false);
  expect(result.reason).toMatch(/holder concentration/i);
});
```

## Integration Testing

Integration tests exercise multiple modules together.  For example, you can simulate a snipe by starting a local Solana test validator, deploying a simple token and AMM pool, running the turbo sniper in dry‑run mode and verifying that a quote is obtained and a transaction is built【913491782795913†L49-L56】.  Configure `dryRun=true` to avoid broadcasting real transactions and assert on log messages such as `quote fetched` or `idempotency key created`【913491782795913†L57-L60】.

## Load Testing

To evaluate performance under stress, write a script that triggers many simulated snipes in parallel.  Measure queue depth (`queue_depth` gauge) and strategy loop durations (`strategy_loop_duration_seconds` histogram) via the metrics endpoint【913491782795913†L64-L67】.  Adjust parallelism and resource limits accordingly.

## Dry‑Run Checklist

Before deploying to mainnet, run through the following:

1. Ensure your `.env` file is correctly set and points to a test RPC or devnet【913491782795913†L75-L76】.
2. Run each strategy with `dryRun=true` or `simulated=true` and confirm that quotes are fetched and transactions are built without errors【913491782795913†L77-L79】.
3. Verify idempotency caching by triggering the same snipe twice within the TTL; the second attempt should be aborted【913491782795913†L79-L81】.
4. Test Telegram commands in a sandbox chat to ensure they work as expected【913491782795913†L81-L82】.
5. Inspect the metrics endpoint (`/metrics`) to ensure there are no unexpected error spikes【913491782795913†L82-L85】.

## Continuous Integration (CI)

While this repository does not include a CI configuration, consider adding GitHub Actions or another CI service to automatically run your test suite and lint your code on every pull request.  A simple Node.js workflow might install dependencies, run Jest and lint with ESLint【913491782795913†L86-L92】.

## Next Steps

* See `docs/ONBOARDING.md` for a quick developer fast‑lane.
* Use `docs/PERFORMANCE.md` to measure the impact of tuning changes.
* Refer to `docs/TROUBLESHOOTING.md` for debugging common failures.