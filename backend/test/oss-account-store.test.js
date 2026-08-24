const assert = require('node:assert/strict');
const test = require('node:test');

const { accountObjectKey, createOssAccountStore } = require('../src/oss-account-store');

function fakeClient() {
  const objects = new Map();
  return {
    objects,
    async get(name) {
      if (!objects.has(name)) throw Object.assign(new Error('missing'), { status: 404, code: 'NoSuchKey' });
      return { content: objects.get(name) };
    },
    async put(name, body, options) {
      if (options?.headers?.['x-oss-forbid-overwrite'] === 'true' && objects.has(name)) {
        throw Object.assign(new Error('exists'), { status: 409, code: 'FileAlreadyExists' });
      }
      objects.set(name, Buffer.from(body));
    },
    async list({ prefix }) {
      return { objects: [...objects.keys()].filter(name => name.startsWith(prefix)).map(name => ({ name })) };
    },
    async delete(name) { objects.delete(name); }
  };
}

test('uses opaque object keys and persists account records in OSS', async () => {
  const client = fakeClient();
  const store = createOssAccountStore({ client, env: { SHINE_ACCOUNT_PREFIX: 'private/accounts' } });
  const account = { schemaVersion: 'shine-account-v1', username: 'friend', accountId: 'account-1' };
  const key = accountObjectKey('friend', 'private/accounts');
  assert.match(key, /^private\/accounts\/[a-f0-9]{64}\.json$/);
  assert.equal(key.includes('friend'), false);

  assert.equal(await store.get('friend'), null);
  await store.create(account);
  assert.deepEqual(await store.get('friend'), account);
  assert.deepEqual(await store.list(), [account]);
  await assert.rejects(() => store.create(account), error => error.code === 'ACCOUNT_ALREADY_EXISTS');
  await store.remove('friend');
  assert.equal(await store.get('friend'), null);
});

