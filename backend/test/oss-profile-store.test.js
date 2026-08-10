const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createOssProfileStore,
  profileObjectKey,
  resolveCredentials
} = require('../src/oss-profile-store');

test('maps FC environment credentials and request-header fallback', () => {
  assert.deepEqual(resolveCredentials(null, {
    ALIBABA_CLOUD_ACCESS_KEY_ID: 'env-id',
    ALIBABA_CLOUD_ACCESS_KEY_SECRET: 'env-secret',
    ALIBABA_CLOUD_SECURITY_TOKEN: 'env-token'
  }), { accessKeyId: 'env-id', accessKeySecret: 'env-secret', stsToken: 'env-token' });

  assert.deepEqual(resolveCredentials({ headers: {
    'x-fc-access-key-id': 'header-id',
    'x-fc-access-key-secret': 'header-secret',
    'x-fc-security-token': 'header-token'
  } }, {}), { accessKeyId: 'header-id', accessKeySecret: 'header-secret', stsToken: 'header-token' });
});

test('uses an opaque, fixed-prefix OSS key', () => {
  const key = profileObjectKey('1500x1500:2:abc123');
  assert.match(key, /^template-profiles\/v1\/[a-f0-9]{64}\.json$/);
  assert.doesNotMatch(key, /1500x1500/);
});

test('creates with forbid-overwrite and rejects stale updates', async () => {
  const objects = new Map();
  const puts = [];
  const client = {
    async get(key) {
      if (!objects.has(key)) throw Object.assign(new Error('missing'), { status: 404, code: 'NoSuchKey' });
      return { content: Buffer.from(objects.get(key)) };
    },
    async put(key, content, options) {
      puts.push({ key, options });
      if (options.headers?.['x-oss-forbid-overwrite'] === 'true' && objects.has(key)) {
        throw Object.assign(new Error('exists'), { status: 409, code: 'FileAlreadyExists' });
      }
      objects.set(key, Buffer.from(content));
    }
  };
  const store = createOssProfileStore({ client, env: {} });
  const signature = '1500x1500:2:abc123';
  const profile = { revision: 1, data: { template: { signature } } };

  const created = await store.create(signature, profile);
  assert.equal(puts[0].options.headers['x-oss-forbid-overwrite'], 'true');
  await assert.rejects(() => store.update(signature, { ...profile, revision: 2 }, '"stale"'), error => {
    assert.equal(error.status, 412);
    assert.equal(error.code, 'PROFILE_CONFLICT');
    return true;
  });
  const updated = await store.update(signature, { ...profile, revision: 2 }, created.etag);
  assert.equal(updated.profile.revision, 2);
});
