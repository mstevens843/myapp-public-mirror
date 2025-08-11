const { checkToken } = require('../services/security/tokenSafetyService');

// Mock prisma tokenSafetyList
jest.mock('../prisma/prisma', () => ({
  tokenSafetyList: {
    findUnique: jest.fn(() => null),
  },
}));

// Mock @solana/web3.js Connection
jest.mock('@solana/web3.js', () => {
  return {
    Connection: jest.fn().mockImplementation(() => {
      return {
        getParsedAccountInfo: async (pub) => {
          // Return no account for unknown mints
          if (pub.toBase58() === 'unknown') return null;
          return {
            value: {
              data: {
                parsed: {
                  info: { decimals: 6, supply: '1000000', freezeAuthority: null },
                },
              },
            },
          };
        },
      };
    }),
    PublicKey: jest.fn().mockImplementation((mint) => {
      return {
        toBase58: () => mint,
      };
    }),
  };
});

describe('tokenSafetyService', () => {
  test('allows stable token', async () => {
    const res = await checkToken('So11111111111111111111111111111111111111112');
    expect(res.verdict).toBe('allow');
  });
  test('blocks unknown mint', async () => {
    const res = await checkToken('unknown');
    expect(res.verdict).toBe('block');
  });
});