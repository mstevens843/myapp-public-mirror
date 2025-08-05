const axios = require("axios");

const query = `
  query ($tokenAddress: String, $devAddress: String, $pairAddress: String) {
    Solana {
      volume: DEXTradeByTokens(
        where: {Trade: {Currency: {MintAddress: {is: $tokenAddress}}}}
      ) {
        sum(of: Trade_Side_AmountInUSD)
      }
      chart: DEXTradeByTokens(
        limit: {count: 50}
        orderBy: {descendingByField: "Block_Timefield"}
        where: {
          Trade: {
            Currency: {MintAddress: {is: $tokenAddress}},
            Market: {MarketAddress: {is: $pairAddress}}
          }
        }
      ) {
        Block {
          Timefield: Time(interval: {in: minutes, count: 1})
        }
        volume: sum(of: Trade_Amount)
        Trade {
          high: Price(maximum: Trade_Price)
          low: Price(minimum: Trade_Price)
          open: Price(minimum: Block_Slot)
          close: Price(maximum: Block_Slot)
        }
        count
      }
      devHolding: BalanceUpdates(
        where: {
          BalanceUpdate: {
            Account: {Owner: {is: $devAddress}},
            Currency: {MintAddress: {is: $tokenAddress}}
          }
        }
      ) {
        BalanceUpdate {
          balance: PostBalance(maximum: Block_Slot, selectWhere: {gt: "0"})
        }
      }
     topHoldings: BalanceUpdates(
        limit: {count: 10}
        orderBy: {descendingByField: "BalanceUpdate_Holding_maximum"}
        where: {
          BalanceUpdate: {Currency: {MintAddress: {is: $tokenAddress}}},
          Transaction: {Result: {Success: true}}
        }
      ) {
        BalanceUpdate {
          Currency {
            Name
            MintAddress
            Symbol
          }
          Account {
            Owner
          }
          Holding: PostBalance(maximum: Block_Slot, selectWhere: {gt: "0"})
        }
      }
    }
  }
`;

const variables = {
  tokenAddress: "2MgQAUxR3KtRGXby9x86fYdZQT8KNjsJzq7atKjJpump",
  devAddress: "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1",
  pairAddress: "HK2bpr3F1HPVuoqUb3QRAheSSMezyzGG6QhQGC2S1beu"
};

axios
  .post(
    "https://streaming.bitquery.io/eap", // <<<<<< USE THE /eap ENDPOINT
    { query, variables },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer ory_at_R6zAo2Kq3-6hVu200jVD5_FQ5LL9iSiJjZX_RBTeczI.QvcRS7bcsn_M2UAfyVUp31_Q64aN7e2_9PZf5e8PEIk"
      }
    }
  )
  .then((res) => {
    console.log("✅ SUCCESS:\n", JSON.stringify(res.data, null, 2));
  })
  .catch((err) => {
    console.error("❌ ERROR:\n", err.response?.data || err.message);
  });
