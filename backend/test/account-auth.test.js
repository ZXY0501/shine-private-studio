const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createAccountRecord,
  publicAccount,
  readSession,
  signSession,
  verifyAccountPassword
} = require('../src/account-auth');

const NOW = () => new Date('2026-08-24T08:00:00.000Z');

test('stores salted password hashes and exposes only public account fields', () => {
  const first = createAccountRecord({ username: 'Friend', displayName: '朋友', password: 'secret-123' }, { now: NOW });
  const second = createAccountRecord({ username: 'friend', displayName: '朋友', password: 'secret-123' }, { now: NOW });
  assert.equal(first.username, 'friend');
  assert.notEqual(first.passwordSalt, second.passwordSalt);
  assert.notEqual(first.passwordHash, second.passwordHash);
  assert.equal(verifyAccountPassword(first, 'secret-123'), true);
  assert.equal(verifyAccountPassword(first, 'wrong-pass'), false);
  assert.equal('passwordHash' in publicAccount(first), false);
  assert.equal('passwordSalt' in publicAccount(first), false);
});

test('signs, validates, and expires account sessions', () => {
  const account = createAccountRecord({ username: 'friend', password: 'secret-123' }, { now: NOW });
  const token = signSession(account, 'session-secret', { now: NOW, sessionSeconds: 3600 });
  const session = readSession(token, 'session-secret', { now: () => new Date('2026-08-24T08:59:59.000Z') });
  assert.equal(session.username, 'friend');
  assert.equal(session.role, 'user');
  assert.throws(
    () => readSession(token, 'session-secret', { now: () => new Date('2026-08-24T09:00:00.000Z') }),
    error => error.code === 'SESSION_EXPIRED'
  );
  assert.throws(() => readSession(`${token}x`, 'session-secret', { now: NOW }), error => error.code === 'SESSION_INVALID');
});

