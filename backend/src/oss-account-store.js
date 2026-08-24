const crypto = require('crypto');
const OSS = require('ali-oss');
const { StoreError, resolveCredentials } = require('./oss-profile-store');
const { normalizeUsername } = require('./account-auth');

function cleanPrefix(value, fallback) {
  return String(value || fallback).replace(/^\/+|\/+$/g, '');
}

function accountObjectKey(username, prefix = 'accounts/v1') {
  const digest = crypto.createHash('sha256').update(normalizeUsername(username)).digest('hex');
  return `${cleanPrefix(prefix, 'accounts/v1')}/${digest}.json`;
}

function isMissingObject(error) {
  return error?.status === 404 || ['NoSuchKey', 'NoSuchObject'].includes(error?.code);
}

function createOssAccountStore({ req, env = process.env, client } = {}) {
  const credentials = resolveCredentials(req, env);
  if (!client && (!credentials.accessKeyId || !credentials.accessKeySecret)) {
    throw new StoreError(503, 'OSS_CREDENTIALS_MISSING');
  }
  const bucket = env.SHINE_OSS_BUCKET || 'shine-private-studio-nick';
  const region = env.SHINE_OSS_REGION || 'oss-cn-hangzhou';
  const endpoint = env.SHINE_OSS_ENDPOINT || 'https://oss-cn-hangzhou-internal.aliyuncs.com';
  const prefix = cleanPrefix(env.SHINE_ACCOUNT_PREFIX, 'accounts/v1');
  const oss = client || new OSS({ ...credentials, bucket, region, endpoint, secure: true, authorizationV4: true });

  async function get(username) {
    const key = accountObjectKey(username, prefix);
    try {
      const result = await oss.get(key);
      return JSON.parse(Buffer.from(result.content).toString('utf8'));
    } catch (error) {
      if (isMissingObject(error)) return null;
      if (error instanceof SyntaxError) throw new StoreError(502, 'ACCOUNT_OBJECT_INVALID', error);
      throw new StoreError(502, 'OSS_READ_FAILED', error);
    }
  }

  async function create(account) {
    const key = accountObjectKey(account.username, prefix);
    try {
      await oss.put(key, Buffer.from(JSON.stringify(account)), {
        mime: 'application/json; charset=utf-8',
        headers: { 'x-oss-forbid-overwrite': 'true' }
      });
      return account;
    } catch (error) {
      if (error?.status === 409 || ['FileAlreadyExists', 'ObjectAlreadyExists'].includes(error?.code)) {
        throw Object.assign(new Error('ACCOUNT_ALREADY_EXISTS'), { status: 409, code: 'ACCOUNT_ALREADY_EXISTS' });
      }
      throw new StoreError(502, 'OSS_WRITE_FAILED', error);
    }
  }

  async function list() {
    const records = [];
    let marker;
    try {
      do {
        const query = { prefix: `${prefix}/`, 'max-keys': 1000 };
        if (marker) query.marker = marker;
        const page = await oss.list(query);
        for (const object of page.objects || []) {
          if (!object.name.endsWith('.json')) continue;
          const result = await oss.get(object.name);
          records.push(JSON.parse(Buffer.from(result.content).toString('utf8')));
        }
        marker = page.nextMarker;
      } while (marker);
      return records;
    } catch (error) {
      if (error instanceof SyntaxError) throw new StoreError(502, 'ACCOUNT_OBJECT_INVALID', error);
      throw new StoreError(502, 'OSS_READ_FAILED', error);
    }
  }

  async function remove(username) {
    const key = accountObjectKey(username, prefix);
    try { await oss.delete(key); } catch (error) {
      if (!isMissingObject(error)) throw new StoreError(502, 'OSS_DELETE_FAILED', error);
    }
  }

  return { get, create, list, remove };
}

module.exports = { accountObjectKey, createOssAccountStore };
