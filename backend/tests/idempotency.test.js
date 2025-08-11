const idempotencyMiddleware = require('../middleware/idempotency');

// Mock prisma client
jest.mock('../prisma/prisma', () => {
  const store = new Map();
  return {
    idempotencyRecord: {
      findUnique: jest.fn(({ where }) => {
        const key = `${where.userId_key.userId}:${where.userId_key.key}`;
        return store.get(key) || null;
      }),
      create: jest.fn(({ data }) => {
        const key = `${data.userId}:${data.key}`;
        store.set(key, data);
        return data;
      }),
    },
  };
});

describe('idempotencyMiddleware', () => {
  test('stores and replays response for same key', async () => {
    const req = {
      get: (h) => (h === 'Idempotency-Key' ? '11111111-1111-4111-8111-111111111111' : undefined),
      user: { id: 'userA' },
    };
    const jsonResponses = [];
    const res = {
      locals: {},
      status: jest.fn().mockReturnThis(),
      json: function (body) {
        jsonResponses.push(body);
        return this;
      },
      send: function (body) {
        jsonResponses.push(body);
        return this;
      },
      statusCode: 200,
    };
    const next = jest.fn();
    // First call should proceed and persist
    await idempotencyMiddleware(req, res, next);
    // Simulate downstream handler sending response
    await res.json({ ok: true });
    expect(jsonResponses).toEqual([{ ok: true }]);
    expect(next).toHaveBeenCalled();
    // Second call should return stored response without calling next
    const next2 = jest.fn();
    const res2 = {
      locals: {},
      status: jest.fn().mockReturnThis(),
      json: function (body) {
        jsonResponses.push(body);
        return this;
      },
      send: function (body) {
        jsonResponses.push(body);
        return this;
      },
    };
    await idempotencyMiddleware(req, res2, next2);
    expect(next2).not.toHaveBeenCalled();
    // The replayed response should be same as first
    expect(jsonResponses[1]).toEqual({ ok: true });
  });
});