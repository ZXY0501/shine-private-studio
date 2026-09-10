'use strict';

const assert = require('node:assert/strict');
const crypto = require('crypto');
const http = require('node:http');
const test = require('node:test');
const { createApp } = require('../src/app');
const { createAccountRecord, signSession } = require('../src/account-auth');
const { createOssInboxStore, inboxObjectKey, ownerScope } = require('../src/oss-inbox-store');
const { signReceipt, readReceipt } = require('../src/inbox-api');

const SECRET = 'inbox-test-secret-only-never-production';
const ADMIN_TOKEN = 'inbox-local-admin-test';
const PNG = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
const PSD = Buffer.from([56,66,80,83,0,1,0,0,0,0,0,0]);
const requestInput = (extra = {}) => ({ fileName: '头发_B.png', size: PNG.length, contentType: 'image/png', clientRequestId: 'request-test-001', ...extra });
const storeError = (status, code) => Object.assign(new Error(code), { status, code });

function fakeOss() {
  const objects = new Map(), signatures = [], deletes = [], lists = [];
  let deleteFailure = false;
  function upload(key, content, mime = 'image/png') { const bytes = Buffer.from(content); objects.set(key, { content: bytes, mime, etag: `"${crypto.createHash('md5').update(bytes).digest('hex')}"` }); }
  const client = {
    signatureUrl(key, options) { signatures.push({ key, options }); return `https://oss.invalid/${key}?method=${options.method}`; },
    async get(key, options = {}) {
      const object = objects.get(key); if (!object) throw storeError(404, 'NoSuchKey');
      if (options.headers?.['If-Match'] && options.headers['If-Match'] !== object.etag) throw storeError(412, 'PreconditionFailed');
      return { content: options.headers?.Range ? object.content.subarray(0, 8) : object.content };
    },
    async put(key, content, options = {}) {
      if (objects.has(key) && options.headers?.['x-oss-forbid-overwrite'] === 'true') throw storeError(409, 'FileAlreadyExists');
      upload(key, content, options.mime || 'application/octet-stream');
    },
    async head(key) {
      const object = objects.get(key); if (!object) throw storeError(404, 'NoSuchKey');
      return { res: { headers: { 'content-length': String(object.content.length), 'content-type': object.mime, etag: object.etag } } };
    },
    async copy(key, sourceKey, options) {
      const source = objects.get(sourceKey); if (!source) throw storeError(404, 'NoSuchKey');
      if (options.headers['If-Match'] !== source.etag) throw storeError(412, 'PreconditionFailed');
      if (objects.has(key) && options.headers['x-oss-forbid-overwrite'] === 'true') throw storeError(409, 'FileAlreadyExists');
      upload(key, source.content, source.mime);
    },
    async list(query) { lists.push(query); return { objects: [...objects.keys()].filter(key => key.startsWith(query.prefix)).map(name => ({ name })) }; },
    async delete(key) { if (deleteFailure) throw storeError(503, 'ServiceUnavailable'); deletes.push(key); objects.delete(key); }
  };
  return { client, objects, signatures, deletes, lists, upload, failDeletes(on) { deleteFailure = on; } };
}

async function fixture(fn, extra = {}) {
  let time = Date.parse('2026-09-07T04:00:00Z'); const now = () => new Date(time);
  const alice = createAccountRecord({ username: 'alice', displayName: 'Alice', password: 'alice-test-123' }, { now });
  const bob = createAccountRecord({ username: 'bob', displayName: 'Bob', password: 'bob-test-123' }, { now });
  const accounts = new Map([['alice', alice], ['bob', bob]]), oss = fakeOss();
  const store = createOssInboxStore({ client: oss.client, env: {} });
  const app = createApp({ profileToken: ADMIN_TOKEN, sessionSecret: SECRET, now, logger: { error() {} }, accountStoreFactory: () => ({ get: async username => accounts.get(username) || null }), inboxStoreFactory: () => store, ...extra });
  const server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = username => signSession(accounts.get(username), SECRET, { now, sessionSeconds: 30 * 86400 });
  async function request(path, { method = 'GET', body, auth = 'alice' } = {}) {
    const bearer = auth === null ? null : accounts.has(auth) ? token(auth) : auth;
    const response = await fetch(base + path, { method, headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json(), headers: response.headers };
  }
  async function ticket(input = {}, auth = 'alice') { const res = await request('/api/inbox/upload-ticket', { method: 'POST', body: requestInput(input), auth }); assert.ok([200, 201].includes(res.status), JSON.stringify(res.body)); return res.body; }
  async function complete(t, auth = 'alice', bytes = PNG) { oss.upload(t.objectKey, bytes, requestInput().contentType); return request(`/api/inbox/${t.id}/complete`, { method: 'POST', body: { receipt: t.receipt }, auth }); }
  try { await fn({ request, ticket, complete, oss, store, accounts, alice, bob, advance(ms) { time += ms; }, now }); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('inbox is authenticated, owner-scoped, private-prefix, and has a truthful cleanup policy', async () => {
  await fixture(async ({ request, ticket, complete, alice, bob, oss }) => {
    assert.equal((await request('/api/inbox', { auth: null })).status, 401);
    const t = await ticket(); assert.match(t.objectKey, new RegExp(`^private-inbox/v1/owners/${ownerScope(alice.accountId)}/`));
    assert.doesNotMatch(t.objectKey, /assets\/v2/); assert.equal(t.expiresAt, '2026-09-09T04:00:00.000Z');
    assert.equal((await complete(t)).status, 201);
    assert.deepEqual((await request('/api/inbox', { auth: 'bob' })).body.items, []);
    for (const suffix of ['/source', '/received', '/complete', '']) {
      const method = suffix === '/source' ? 'GET' : suffix ? 'POST' : 'DELETE';
      assert.equal((await request(`/api/inbox/${t.id}${suffix}`, { method, ...(method === 'POST' ? { body: { receipt: t.receipt } } : {}), auth: 'bob' })).status, 404);
    }
    assert.equal((await request('/api/inbox', { auth: ADMIN_TOKEN })).body.items.length, 0, 'admin does not bypass private ownership');
    const list = await request('/api/inbox'); assert.equal(list.body.items[0].status, 'READY'); assert.equal(list.body.cleanup.physicalDeletionScheduled, false);
    assert.equal(list.headers.get('cache-control'), 'no-store');
    assert.ok(oss.lists.every(query => !Object.prototype.hasOwnProperty.call(query, 'marker')));
    assert.notEqual(ownerScope(alice.accountId), ownerScope(bob.accountId));
  });
});

test('upload ticket and completion retries are idempotent; received does not reset on retry', async () => {
  await fixture(async ({ request, ticket, complete, advance }) => {
    const [first, retry] = await Promise.all([ticket(), ticket()]); assert.equal(first.id, retry.id);
    const conflict = await request('/api/inbox/upload-ticket', { method: 'POST', body: requestInput({ fileName: 'another.png' }) });
    assert.equal(conflict.status, 409); assert.equal(conflict.body.error, 'INBOX_REQUEST_ID_CONFLICT');
    const ready = await complete(first); assert.equal(ready.status, 201);
    const received = await request(`/api/inbox/${first.id}/received`, { method: 'POST', body: {} }); assert.equal(received.body.item.status, 'RECEIVED');
    advance(20 * 60000);
    const completedAgain = await request(`/api/inbox/${first.id}/complete`, { method: 'POST', body: { receipt: retry.receipt } });
    assert.equal(completedAgain.status, 200); assert.equal(completedAgain.body.reused, true); assert.equal(completedAgain.body.item.receivedAt, received.body.item.receivedAt);
    const uploadedAgain = await ticket(); assert.equal(uploadedAgain.uploadUrl, null); assert.equal(uploadedAgain.expiresAt, first.expiresAt);
  });
});

test('validates size, extension, matching MIME, owner override and idempotency key', async () => {
  await fixture(async ({ request }) => {
    const cases = [
      [{ ownerId: 'someone-else' }, 400], [{ objectKey: 'assets/v2/steal' }, 400],
      [{ fileName: '../art.psd' }, 400], [{ fileName: 'code.html' }, 400],
      [{ contentType: 'text/html' }, 400], [{ contentType: 'application/octet-stream' }, 400],
      [{ size: null }, 400], [{ size: '12' }, 400], [{ size: -1 }, 400], [{ size: 300 * 1024 * 1024 }, 413],
      [{ clientRequestId: '../a' }, 400]
    ];
    for (const [input, expected] of cases) assert.equal((await request('/api/inbox/upload-ticket', { method: 'POST', body: requestInput(input) })).status, expected, JSON.stringify(input));
  });
});

test('rejects forged, cross-owner, cross-item, expired and metadata-mismatched receipts', async () => {
  await fixture(async ({ request, ticket, oss, advance }) => {
    const t = await ticket(), other = await ticket({ clientRequestId: 'request-other-001' }); oss.upload(t.objectKey, PNG);
    const claim = readReceipt(t.receipt, SECRET);
    const receipts = [t.receipt + 'x', signReceipt({ ...claim, ownerId: 'other' }, SECRET), signReceipt({ ...claim, id: other.id }, SECRET), signReceipt({ ...claim, size: 13 }, SECRET), signReceipt({ ...claim, objectKey: 'assets/v2/another/source.psd' }, SECRET), signReceipt({ ...claim, expiresAt: '2100-01-01T00:00:00Z' }, SECRET)];
    for (const receipt of receipts) assert.equal((await request(`/api/inbox/${t.id}/complete`, { method: 'POST', body: { receipt } })).status, 400);
    advance(16 * 60000);
    const expired = await request(`/api/inbox/${t.id}/complete`, { method: 'POST', body: { receipt: t.receipt } }); assert.equal(expired.status, 410);
    const renewed = await ticket(); assert.equal(renewed.id, t.id); assert.equal((await request(`/api/inbox/${t.id}/complete`, { method: 'POST', body: { receipt: renewed.receipt } })).status, 201);
  });
});

test('checks uploaded bytes, content type and actual PNG/PSD signature before complete', async () => {
  await fixture(async ({ request, ticket, oss }) => {
    const t = await ticket(), url = `/api/inbox/${t.id}/complete`, args = { method: 'POST', body: { receipt: t.receipt } };
    assert.equal((await request(url, args)).body.error, 'INBOX_UPLOAD_MISSING');
    oss.upload(t.objectKey, Buffer.alloc(13)); assert.equal((await request(url, args)).body.error, 'INBOX_UPLOAD_MISMATCH');
    oss.upload(t.objectKey, PNG, 'text/html'); assert.equal((await request(url, args)).body.error, 'INBOX_UPLOAD_MISMATCH');
    oss.upload(t.objectKey, Buffer.alloc(12)); assert.equal((await request(url, args)).status, 415);
    oss.upload(t.objectKey, PNG); assert.equal((await request(url, args)).status, 201);
    const psd = await ticket({ fileName: '头发_A.psd', contentType: 'application/octet-stream', size: PSD.length, clientRequestId: 'request-psd-001' });
    oss.upload(psd.objectKey, PSD, 'application/octet-stream'); assert.equal((await request(`/api/inbox/${psd.id}/complete`, { method: 'POST', body: { receipt: psd.receipt } })).status, 201);
  });
});

test('completed source cannot be replaced by reusing its unexpired signed upload URL', async () => {
  await fixture(async ({ request, ticket, complete, oss, alice }) => {
    const t = await ticket(); await complete(t);
    const finalKey = inboxObjectKey(alice.accountId, t.id, 'source'); assert.deepEqual(oss.objects.get(finalKey).content, PNG);
    oss.upload(t.objectKey, Buffer.alloc(12), 'image/png');
    const retry = await request(`/api/inbox/${t.id}/complete`, { method: 'POST', body: { receipt: t.receipt } }); assert.equal(retry.status, 200);
    assert.deepEqual(oss.objects.get(finalKey).content, PNG);
    await request(`/api/inbox/${t.id}/source`); assert.equal(oss.signatures.at(-1).key, finalKey); assert.equal(oss.signatures.at(-1).options.method, 'GET');
  });
});

test('expiry blocks downloads immediately, caps signed URLs, and cleans raw sources on activity', async () => {
  await fixture(async ({ request, ticket, complete, oss, advance, now }) => {
    const t = await ticket(); await complete(t); advance(48 * 3600000 - 60000);
    const source = await request(`/api/inbox/${t.id}/source`); assert.equal(source.status, 200); assert.ok(Date.parse(source.body.downloadExpiresAt) <= Date.parse(t.expiresAt));
    assert.equal(oss.signatures.at(-1).options.expires, 60);
    advance(60000); assert.equal(now().toISOString(), t.expiresAt);
    const expired = await request(`/api/inbox/${t.id}/source`); assert.equal(expired.status, 410); assert.equal(expired.body.error, 'INBOX_EXPIRED');
    assert.ok(!oss.objects.has(t.objectKey));
    assert.equal((await request('/api/inbox')).body.items[0].status, 'EXPIRED');
  });
});

test('cleanup failure is reported as deferred and does not reopen expired sources', async () => {
  await fixture(async ({ request, ticket, complete, oss, advance }) => {
    const t = await ticket(); await complete(t); advance(48 * 3600000); oss.failDeletes(true);
    const list = await request('/api/inbox'); assert.equal(list.status, 200); assert.equal(list.body.cleanup.deferred, 1); assert.ok(oss.objects.has(t.objectKey));
    assert.equal((await request(`/api/inbox/${t.id}/source`)).status, 410);
    oss.failDeletes(false); assert.equal((await request('/api/inbox')).body.cleanup.cleaned, 1); assert.ok(!oss.objects.has(t.objectKey));
  });
});

test('delete is idempotent and cannot resurrect an item through an old ticket or request ID', async () => {
  await fixture(async ({ request, ticket, complete, oss }) => {
    const t = await ticket(); await complete(t);
    for (let i = 0; i < 2; i++) assert.equal((await request(`/api/inbox/${t.id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await request('/api/inbox')).body.items.length, 0); assert.ok(!oss.objects.has(t.objectKey));
    assert.equal((await request(`/api/inbox/${t.id}/source`)).status, 410);
    assert.equal((await request(`/api/inbox/${t.id}/complete`, { method: 'POST', body: { receipt: t.receipt } })).status, 410);
    assert.equal((await request('/api/inbox/upload-ticket', { method: 'POST', body: requestInput() })).status, 410);
  });
});

test('upload-only device token is returned once, hashed at rest, constrained and revocable', async () => {
  await fixture(async ({ request, ticket, complete, oss }) => {
    const created = await request('/api/inbox/devices', { method: 'POST', body: { name: '画画 iPad' } }); assert.equal(created.status, 201);
    const { token, device } = created.body; assert.match(token, /^shine-inbox-device-v1\./); assert.equal(device.scope, 'inbox:upload');
    const list = await request('/api/inbox/devices'); assert.equal(list.body.devices.length, 1); assert.ok(!JSON.stringify(list.body).includes(token)); assert.ok(!JSON.stringify(list.body).includes('tokenHash'));
    assert.ok([...oss.objects.values()].every(value => !value.content.toString().includes(token)));
    const t = await ticket({}, token); assert.equal((await complete(t, token)).status, 201);
    assert.equal((await request('/api/inbox')).body.items.length, 1);
    const denied = [['/api/inbox', 'GET'], [`/api/inbox/${t.id}/source`, 'GET'], [`/api/inbox/${t.id}/received`, 'POST'], [`/api/inbox/${t.id}`, 'DELETE'], ['/api/inbox/devices', 'GET'], ['/api/inbox/devices', 'POST']];
    for (const [path, method] of denied) assert.equal((await request(path, { method, body: method === 'POST' ? {} : undefined, auth: token })).status, 403);
    assert.equal((await request('/api/assets', { auth: token })).status, 401);
    assert.equal((await request(`/api/inbox/devices/${device.id}`, { method: 'DELETE', auth: 'bob' })).status, 404);
    assert.equal((await request(`/api/inbox/devices/${device.id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await request('/api/inbox/upload-ticket', { method: 'POST', body: requestInput({ clientRequestId: 'request-device-002' }), auth: token })).status, 401);
  });
});

test('disabled or deleted accounts invalidate their upload-only devices; cross-device completion is denied', async () => {
  await fixture(async ({ request, ticket, accounts, oss }) => {
    const first = (await request('/api/inbox/devices', { method: 'POST', body: { name: 'one' } })).body;
    const second = (await request('/api/inbox/devices', { method: 'POST', body: { name: 'two' } })).body;
    const t = await ticket({}, first.token); oss.upload(t.objectKey, PNG);
    assert.equal((await request(`/api/inbox/${t.id}/complete`, { method: 'POST', body: { receipt: t.receipt }, auth: second.token })).status, 403);
    accounts.get('alice').disabled = true;
    assert.equal((await request('/api/inbox/upload-ticket', { method: 'POST', body: requestInput(), auth: first.token })).status, 401);
    accounts.delete('alice');
    assert.equal((await request('/api/inbox/upload-ticket', { method: 'POST', body: requestInput(), auth: first.token })).status, 401);
  });
});

test('device expiration and metadata quota are enforced without leaking token secrets', async () => {
  await fixture(async ({ request, ticket, advance }) => {
    const device = (await request('/api/inbox/devices', { method: 'POST', body: { name: 'iPad' } })).body;
    const size = 200 * 1024 * 1024;
    for (let i = 0; i < 5; i++) await ticket({ size, clientRequestId: `request-quota-${i}` });
    assert.equal((await request('/api/inbox/upload-ticket', { method: 'POST', body: requestInput({ size, clientRequestId: 'request-quota-extra' }) })).status, 429);
    advance(31 * 86400000);
    assert.equal((await request('/api/inbox/upload-ticket', { method: 'POST', body: requestInput(), auth: device.token })).status, 401);
  });
});

test('private object key guards refuse traversal and a crafted owner cannot escape its namespace', () => {
  const id = '11111111-1111-4111-a111-111111111111';
  assert.throws(() => inboxObjectKey('alice', '../assets', 'source'));
  assert.throws(() => inboxObjectKey('alice', id, '../source'));
  const key = inboxObjectKey('../../assets/v2/', id); assert.ok(key.startsWith(`private-inbox/v1/owners/${ownerScope('../../assets/v2/')}/`));
});

test('deleted uploads recreated by a still-valid PUT ticket are cleaned without resurrection', async () => {
  await fixture(async ({ request, ticket, complete, oss }) => {
    const t = await ticket(); await complete(t);
    await request(`/api/inbox/${t.id}`, { method: 'DELETE' });
    oss.upload(t.objectKey, PNG);
    assert.ok(oss.objects.has(t.objectKey));
    const list = await request('/api/inbox');
    assert.equal(list.status, 200); assert.deepEqual(list.body.items, []);
    assert.ok(!oss.objects.has(t.objectKey));
    assert.equal((await request(`/api/inbox/${t.id}/source`)).status, 410);
  });
});

test('source finalization refuses bytes changed after inspection and uses immutable copies', async () => {
  await fixture(async ({ ticket, oss, store, alice }) => {
    const t = await ticket(); oss.upload(t.objectKey, PNG);
    const inspected = await store.inspectUpload(alice.accountId, t.id);
    const changed = Buffer.from(PNG); changed[8] = 1; oss.upload(t.objectKey, changed);
    await assert.rejects(store.finalizeSource(alice.accountId, t.id, inspected), error => error.code === 'INBOX_UPLOAD_CHANGED');
    assert.ok(!oss.objects.has(inboxObjectKey(alice.accountId, t.id, 'source')));
  });
});

test('corrupted device expiry is rejected instead of turning into a permanent token', async () => {
  await fixture(async ({ request, oss }) => {
    const { token, device } = (await request('/api/inbox/devices', { method: 'POST', body: { name: 'iPad' } })).body;
    const entry = [...oss.objects.entries()].find(([key]) => key.endsWith(`/devices/${device.id}.json`));
    const record = JSON.parse(entry[1].content.toString()); record.expiresAt = 'invalid-date';
    oss.upload(entry[0], Buffer.from(JSON.stringify(record)), 'application/json');
    assert.equal((await request('/api/inbox/upload-ticket', { method: 'POST', body: requestInput(), auth: token })).status, 401);
  });
});

test('repeated OSS pagination markers fail closed and unrelated listed keys are never read', async () => {
  const seen = [];
  const store = createOssInboxStore({ env: {}, client: {
    signatureUrl() { return ''; },
    async list() { return { objects: [{ name: 'assets/v2/private.json' }, { name: null }], nextMarker: 'same' }; },
    async get(key) { seen.push(key); throw storeError(404, 'NoSuchKey'); }
  } });
  await assert.rejects(store.listItems('alice'), error => error.code === 'INBOX_LIST_INVALID');
  assert.deepEqual(seen, []);
});
