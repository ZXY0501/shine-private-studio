const crypto = require('crypto');

const SESSION_VERSION = 1;
const DEFAULT_SESSION_SECONDS = 30 * 24 * 60 * 60;

function authError(status, code) {
  return Object.assign(new Error(code), { status, code });
}

function normalizeUsername(value) {
  return String(value || '').trim().normalize('NFKC').toLowerCase();
}

function validateUsername(value) {
  const username = normalizeUsername(value);
  if (!/^[\p{L}\p{N}_-]{2,40}$/u.test(username)) throw authError(400, 'INVALID_ACCOUNT_USERNAME');
  return username;
}

function validatePassword(value) {
  const password = String(value || '');
  if (password.length < 8 || password.length > 128) throw authError(400, 'INVALID_ACCOUNT_PASSWORD');
  return password;
}

function validateDisplayName(value, fallback) {
  const displayName = String(value || fallback || '').trim().normalize('NFKC');
  if (!displayName || displayName.length > 40 || /[\u0000-\u001F\u007F]/.test(displayName)) {
    throw authError(400, 'INVALID_ACCOUNT_DISPLAY_NAME');
  }
  return displayName;
}

function passwordDigest(password, salt) {
  return crypto.scryptSync(password, Buffer.from(salt, 'base64url'), 64, {
    N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024
  }).toString('base64url');
}

function createAccountRecord(input, { role = 'user', now = () => new Date() } = {}) {
  const username = validateUsername(input?.username);
  const password = validatePassword(input?.password);
  const displayName = validateDisplayName(input?.displayName, username);
  const salt = crypto.randomBytes(18).toString('base64url');
  const timestamp = now().toISOString();
  return {
    schemaVersion: 'shine-account-v1',
    accountId: crypto.randomUUID(),
    username,
    displayName,
    role: role === 'admin' ? 'admin' : 'user',
    passwordSalt: salt,
    passwordHash: passwordDigest(password, salt),
    disabled: false,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function verifyAccountPassword(account, value) {
  if (!account || account.disabled || account.schemaVersion !== 'shine-account-v1') return false;
  let candidate;
  try { candidate = passwordDigest(validatePassword(value), account.passwordSalt); } catch { return false; }
  const left = Buffer.from(candidate);
  const right = Buffer.from(String(account.passwordHash || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function publicAccount(account) {
  return {
    accountId: account.accountId,
    username: account.username,
    displayName: account.displayName,
    role: account.role === 'admin' ? 'admin' : 'user',
    disabled: account.disabled === true,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt
  };
}

function signSession(account, secret, { now = () => new Date(), sessionSeconds = DEFAULT_SESSION_SECONDS } = {}) {
  if (!secret) throw authError(503, 'ACCOUNT_AUTH_NOT_CONFIGURED');
  const issuedAt = Math.floor(now().getTime() / 1000);
  const payload = Buffer.from(JSON.stringify({
    v: SESSION_VERSION,
    sub: account.accountId,
    username: account.username,
    displayName: account.displayName,
    role: account.role === 'admin' ? 'admin' : 'user',
    iat: issuedAt,
    exp: issuedAt + sessionSeconds
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function readSession(token, secret, { now = () => new Date() } = {}) {
  if (!secret) throw authError(503, 'ACCOUNT_AUTH_NOT_CONFIGURED');
  const [payload, signature, extra] = String(token || '').split('.');
  if (!payload || !signature || extra) throw authError(401, 'SESSION_INVALID');
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) throw authError(401, 'SESSION_INVALID');
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { throw authError(401, 'SESSION_INVALID'); }
  if (data?.v !== SESSION_VERSION || !data.sub || !data.username || !['admin', 'user'].includes(data.role)) {
    throw authError(401, 'SESSION_INVALID');
  }
  if (!Number.isFinite(data.exp) || Math.floor(now().getTime() / 1000) >= data.exp) throw authError(401, 'SESSION_EXPIRED');
  return data;
}

module.exports = {
  DEFAULT_SESSION_SECONDS,
  createAccountRecord,
  normalizeUsername,
  publicAccount,
  readSession,
  signSession,
  validateUsername,
  verifyAccountPassword
};
