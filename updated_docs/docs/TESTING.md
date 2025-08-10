# Testing Guide

This document provides guidance for testing the trading bot.  Because the
public mirror does not include a formal test suite, testing largely consists
of running modules in isolation and validating behaviour via the command line
or integration environments.

## Unit Testing

### Approach

1. Identify the module you wish to test (e.g. `utils/swap.js`,
   `strategies/core/passes.js`).
2. Create a test file under a `tests/` directory (e.g. `tests/swap.test.js`).
3. Use a testing framework such as [Jest](https://jestjs.io/) or
   [Mocha](https://mochajs.org/) to write assertions.  For example, mock
   network calls to Jupiter and assert that `getSwapQuote` returns a valid
   quote for known token pairs.
4. Run your tests with `node` or the appropriate test runner.  For example:

```sh
npm install --save-dev jest
npx jest tests/swap.test.js
```

Because the mirror does not contain a `package.json` with test scripts, you
must install and configure your own test framework.

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

Integration tests exercise multiple modules together.  For example, you can
simulate a snipe by:

1. Starting a local Solana test validator (`solana-test-validator`).
2. Deploying a simple token and AMM pool.
3. Running the turbo sniper in dry‑run mode and verifying that the executor
   obtains a quote, builds a transaction and returns a simulated signature.

Use environment variables to point the bot at your test RPC and set
`dryRun=true` to avoid broadcasting real transactions.  Capture logs and
assert on specific messages (e.g. `quote fetched`, `idempotency key created`).

## Load Testing

To evaluate performance under stress, write a script that triggers many
simulated snipes in parallel.  Measure queue depth (`queue_depth` gauge) and
strategy loop durations (`strategy_loop_duration_seconds` histogram) via the
metrics endpoint【665845919011301†L66-L72】.  Adjust parallelism and resource limits
accordingly.

## Dry‑Run Checklist

Before deploying to mainnet, run through the following checklist:

1. Ensure `.env` variables are correctly set and point to a test RPC or
   devnet.
2. Run each strategy with `dryRun=true` or `simulated=true`.  Confirm that
   quotes are fetched and transactions are built without errors.
3. Verify that idempotency caching works by triggering the same snipe twice
   within the TTL; the second attempt should be aborted【30051125156274†L190-L200】.
4. Test Telegram commands in a sandbox chat to ensure they work as expected.
5. Review metrics via `/metrics` and ensure there are no unexpected error
   spikes.

## Continuous Integration (CI)

While this repository does not include a CI configuration, consider adding
GitHub Actions or another CI service to automatically run your test suite and
lint your code on every pull request.  A simple Node.js CI workflow might
install dependencies, run Jest and lint with ESLint.