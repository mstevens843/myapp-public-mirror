/**
 * poolWatcher.js
 *
 * A simple utility to watch for new liquidity pools on Solana DEXes.  It
 * leverages `Connection.onLogs` to listen for InitializePool or AddLiquidity
 * instructions emitted by known AMM program IDs such as Raydium.  When a
 * matching instruction is detected, the watcher attempts to parse the
 * transaction and extract the token mint addresses involved.  It then
 * emits a `poolDetected` event with the token mints and transaction
 * signature.  Consumers can subscribe to the EventEmitter to trigger
 * automatic snipes or other logic.
 *
 * This implementation is inspired by QuickNode's guide on tracking new
 * liquidity pools on Raydium using Solana WebSockets【778824402250984†L250-L303】.  It
 * restricts logs to the Raydium legacy AMM v4 program by default,
 * identified by the program ID `675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8`【987307265498407†L164-L174】.  Additional
 * program IDs may be provided via the constructor to monitor other DEXes.
 */

const { Connection, PublicKey } = require("@solana/web3.js");
const EventEmitter = require("events");

// Default program IDs to watch. Raydium's AMM v4 program is the most widely
// used constant product pool on Solana【987307265498407†L164-L174】. Users may
// supply additional program IDs (e.g., for Orca, Meteora, Step, Crema) when
// instantiating the PoolWatcher.
const DEFAULT_PROGRAM_IDS = [
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", // Raydium AMM v4
];

class PoolWatcher extends EventEmitter {
  /**
   * Create a new PoolWatcher.
   *
   * @param {string} rpcUrl RPC endpoint for the WebSocket connection.
   * @param {string[]} programIds List of program IDs to filter logs by.
   */
  constructor(rpcUrl, programIds = DEFAULT_PROGRAM_IDS) {
    super();
    this.rpcUrl = rpcUrl;
    this.programIds = programIds.map((id) => new PublicKey(id));
    this.connection = new Connection(this.rpcUrl, {
      commitment: "confirmed",
      wsEndpoint: this.rpcUrl.replace(/^http/, "ws"),
    });
    this.subscriptions = [];
    this.running = false;
  }

  /**
   * Start listening for logs on the configured program IDs.  When a log
   * contains `InitializePool` or `AddLiquidity`, the transaction is parsed
   * to extract token accounts at expected positions, and a `poolDetected`
   * event is emitted with the token mints.
   */
  async start() {
    if (this.running) return;
    this.running = true;
    for (const programId of this.programIds) {
      const subId = await this.connection.onLogs(
        programId,
        async (logInfo) => {
          try {
            const { signature, logs } = logInfo;
            const text = logs.join(" ");
            // Heuristically detect pool creation or liquidity add instructions
            if (/InitializePool|initialize2|AddLiquidity/i.test(text)) {
              // Fetch and parse the transaction to extract token mints
              const tx = await this.connection.getParsedTransaction(signature, {
                maxSupportedTransactionVersion: 0,
                commitment: "confirmed",
              });
              const instructions = tx?.transaction?.message?.instructions || [];
              for (const ix of instructions) {
                // Only process instructions belonging to the watched program
                if (ix.programId.equals(programId)) {
                  const accounts = ix.accounts || [];
                  // Based on QuickNode's example, token A/B accounts are at positions 8 and 9【778824402250984†L274-L301】
                  const tokenA = accounts[8];
                  const tokenB = accounts[9];
                  if (tokenA && tokenB) {
                    this.emit("poolDetected", {
                      signature,
                      programId: programId.toBase58(),
                      tokenA: tokenA.toBase58(),
                      tokenB: tokenB.toBase58(),
                    });
                  }
                }
              }
            }
          } catch (err) {
            console.error("PoolWatcher parse error:", err.message);
          }
        },
        "confirmed"
      );
      this.subscriptions.push(subId);
    }
  }

  /**
   * Stop listening to logs and clean up subscriptions.
   */
  async stop() {
    this.running = false;
    for (const subId of this.subscriptions) {
      try {
        await this.connection.removeOnLogsListener(subId);
      } catch (_) {
        /* ignore */
      }
    }
    this.subscriptions = [];
  }
}

module.exports = PoolWatcher;