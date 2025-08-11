const { logSecurityEvent } = require('../services/security/auditLog');

// Mock prisma storage
jest.mock('../prisma/prisma', () => {
  const rows = [];
  return {
    securityAuditLog: {
      findFirst: jest.fn(({ where, orderBy }) => {
        const byUser = rows.filter((r) => r.userId === where.userId);
        if (!byUser.length) return null;
        return byUser.reduce((a, b) => (a.ts > b.ts ? a : b));
      }),
      create: jest.fn(({ data }) => {
        rows.push(data);
        return data;
      }),
    },
  };
});

describe('auditLog', () => {
  test('creates chain of hashes', async () => {
    await logSecurityEvent('u1', 'LOGIN', { ip: '1.2.3.4' });
    await logSecurityEvent('u1', 'LOGOUT', { ip: '1.2.3.4' });
    const prisma = require('../prisma/prisma');
    const logs = prisma.securityAuditLog.create.mock.calls.map(([, args]) => args);
    expect(logs.length).toBe(2);
    const first = logs[0];
    const second = logs[1];
    expect(second.prevHash).toBe(first.hash);
  });
});