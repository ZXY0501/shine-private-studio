'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { createApp } = require('../src/app');
const { createAccountRecord, signSession } = require('../src/account-auth');
const { createOssHandbookStore, handbookOwnerPrefix, handbookVersionKey, feedbackKey } = require('../src/oss-handbook-store');
const H = require('../../color-handbook');

const SECRET = 'handbook-tests-only-local-secret';
const ADMIN = 'handbook-tests-only-admin-token';
const error = (status, code) => Object.assign(new Error(code), { status, code });

function fakeOss() {
  const objects = new Map(), puts = [];
  let beforePut = async () => {}, listOverride = null, failDelete = false;
  const client = {
    async get(key) { if (!objects.has(key)) throw error(404, 'NoSuchKey'); return { content: Buffer.from(objects.get(key)) }; },
    async put(key, bytes, options = {}) {
      await beforePut(key);
      puts.push({ key, options });
      if (objects.has(key) && options.headers?.['x-oss-forbid-overwrite'] === 'true') throw error(409, 'FileAlreadyExists');
      objects.set(key, Buffer.from(bytes));
    },
    async list(query) { return listOverride ? listOverride(query) : { objects: [...objects.keys()].filter(key => key.startsWith(query.prefix)).map(name => ({ name })) }; },
    async delete(key) { if (failDelete) throw error(503, 'ServiceUnavailable'); objects.delete(key); }
  };
  return { objects, puts, client, beforePut(fn) { beforePut = fn; }, list(fn) { listOverride = fn; }, failDelete(on) { failDelete = on; } };
}

function feedback(extra = {}) {
  return { schemaVersion: 1, id: 'order-one-final-a-hair', componentId: 'a-hair', category: 'HAIR', name: 'A 长卷发',
    recipeId: 'hair-gold', kind: 'changed', changes: [{ role: 'lineart', from: '#AB0000', to: '#DBB8AB' }],
    reason: 'AESTHETIC', confirmed: true, context: { templateSignature: 'wedding-2', orderId: 'order-one' }, ...extra };
}

async function fixture(fn, overrides = {}) {
  const now = () => new Date('2026-09-08T01:00:00.000Z');
  const alice = createAccountRecord({ username: 'alice', password: 'test-alice-password' }, { now });
  const bob = createAccountRecord({ username: 'bob', password: 'test-bob-password' }, { now });
  const accounts = new Map([['alice', alice], ['bob', bob]]), oss = fakeOss();
  const store = createOssHandbookStore({ env: {}, client: oss.client, now });
  const app = createApp({ profileToken: ADMIN, sessionSecret: SECRET, now, logger: { error() {} },
    accountStoreFactory: () => ({ get: async username => accounts.get(username) }), handbookStoreFactory: () => store, ...overrides });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  async function request(path = '/api/handbook', { method = 'GET', body, auth = 'alice', headers = {}, raw } = {}) {
    const token = accounts.has(auth) ? signSession(accounts.get(auth), SECRET, { now }) : auth;
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body || raw ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(body || raw ? { body: raw || JSON.stringify(body) } : {}) });
    return { status: res.status, headers: res.headers, body: await res.json() };
  }
  const create = (data = H.seedHandbook('client-owner'), auth = 'alice') => request('/api/handbook', { method: 'PUT', body: { data }, auth, headers: { 'If-None-Match': '*' } });
  try { await fn({ request, create, store, oss, alice, bob, accounts, now }); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('handbook routes require live account authentication; owner comes only from auth', async () => {
  await fixture(async ({ request, create, alice, bob, accounts, oss }) => {
    assert.equal((await request('/api/handbook', { auth: null })).status, 401);
    const created = await create(H.seedHandbook(bob.accountId));
    assert.equal(created.status, 201); assert.equal(created.body.data.owner, alice.accountId);
    assert.equal((await request('/api/handbook', { auth: 'bob' })).status, 404);
    assert.equal((await request('/api/handbook/versions/1', { auth: 'bob' })).status, 404);
    assert.equal((await request('/api/handbook', { auth: ADMIN })).status, 404, 'administrator token never bypasses owner namespace');
    assert.deepEqual((await request('/api/handbook/versions', { auth: 'bob' })).body, { versions: [] });
    assert.ok([...oss.objects.keys()].every(key => key.startsWith(handbookOwnerPrefix(alice.accountId) + '/')));
    const current = await request(); assert.equal(current.headers.get('cache-control'), 'no-store'); assert.ok(current.headers.get('etag'));
    accounts.get('alice').disabled = true; assert.equal((await request()).status, 401);
  });
});

test('handbook immutable versions use preconditions and expose readable export/history', async () => {
  await fixture(async ({ request, create }) => {
    const book = H.seedHandbook('client');
    assert.equal((await request('/api/handbook', { method: 'PUT', body: { data: book } })).status, 428);
    assert.equal((await request('/api/handbook', { method: 'PUT', body: { data: book }, headers: { 'If-None-Match': 'invalid' } })).status, 400);
    const first = await create(book), etag = first.headers.get('etag');
    assert.equal((await create(book)).status, 412);
    book.recipes[0].layers.lineart = '#AABBCC';
    assert.equal((await request('/api/handbook', { method: 'PUT', body: { data: book }, headers: { 'If-Match': 'stale' } })).status, 412);
    const second = await request('/api/handbook', { method: 'PUT', body: { data: book }, headers: { 'If-Match': etag } });
    assert.equal(second.status, 200); assert.equal(second.body.revision, 2); assert.notEqual(second.headers.get('etag'), etag);
    assert.deepEqual((await request('/api/handbook/versions/1')).body, first.body);
    assert.equal((await request('/api/handbook/export')).body.data.recipes[0].layers.lineart, '#AABBCC');
    assert.deepEqual((await request('/api/handbook/versions')).body.versions.map(x => x.revision), [2, 1]);
  });
});

test('simultaneous immutable revision creation and update have exactly one winner and one 412', async () => {
  await fixture(async ({ create, request, oss, alice }) => {
    let pending = [], revision = 1;
    oss.beforePut(async key => {
      if (key !== handbookVersionKey(alice.accountId, revision)) return;
      await new Promise(resolve => { pending.push(resolve); if (pending.length === 2) pending.splice(0).forEach(done => done()); });
    });
    const a = H.seedHandbook('alice'), b = H.seedHandbook('alice'); b.recipes[0].layers.lineart = '#ABCD00';
    const creates = await Promise.all([create(a), create(b)]);
    assert.deepEqual(creates.map(x => x.status).sort(), [201, 412]);
    const first = creates.find(x => x.status === 201), bytes = Buffer.from(oss.objects.get(handbookVersionKey(alice.accountId, 1)));
    revision = 2;
    const updates = await Promise.all([a, b].map(data => request('/api/handbook', { method: 'PUT', body: { data }, headers: { 'If-Match': first.headers.get('etag') } })));
    assert.deepEqual(updates.map(x => x.status).sort(), [200, 412]);
    assert.deepEqual(oss.objects.get(handbookVersionKey(alice.accountId, 1)), bytes);
    assert.equal((await request()).body.revision, 2);
    assert.ok(oss.puts.every(x => x.options.headers['x-oss-forbid-overwrite'] === 'true'));
  });
});

test('real handbook validator rejects invalid colors, pollution, unknown categories and oversized request', async () => {
  await fixture(async ({ create, request, oss }) => {
    for (const mutate of [b => { b.recipes[0].layers.lineart = 'red'; }, b => { b.recipes[0].anchorHex = '#GGGGGG'; }, b => { b.recipes[0].category = 'UNKNOWN'; }]) {
      const book = H.seedHandbook('alice'); mutate(book); assert.equal((await create(book)).status, 400);
    }
    const good = H.seedHandbook('alice'); good.recipes[0].layers.lineart = '#abc';
    const polluted = JSON.stringify({ data: good }).replace('"schemaVersion":1', '"schemaVersion":1,"__proto__":{"polluted":true}');
    assert.equal((await request('/api/handbook', { method: 'PUT', raw: polluted, headers: { 'If-None-Match': '*' } })).status, 400);
    assert.equal({}.polluted, undefined); assert.equal(oss.objects.size, 0);
    assert.equal((await create(good)).body.data.recipes[0].layers.lineart, '#AABBCC');
    const huge = JSON.stringify({ data: { ignored: 'a'.repeat(1024 * 1024) } });
    assert.equal((await request('/api/handbook', { method: 'PUT', raw: huge, headers: { 'If-None-Match': '*' } })).status, 413);
  });
});

test('feedback retries count once, conflicting replay is rejected, withdrawal cannot be revived', async () => {
  await fixture(async ({ request, oss, alice }) => {
    const args = { method: 'POST', body: { data: feedback() } };
    const submitted = await Promise.all([request('/api/handbook/feedback', args), request('/api/handbook/feedback', args)]);
    assert.deepEqual(submitted.map(x => x.status), [201, 201]); assert.deepEqual(submitted[0].body, submitted[1].body);
    const id = submitted[0].body.id; assert.match(id, /^[a-f0-9]{64}$/);
    assert.equal((await request('/api/handbook/feedback')).body.feedback.length, 1);
    const changed = feedback({ changes: [{ role: 'lineart', from: '#AB0000', to: '#123456' }] });
    assert.equal((await request('/api/handbook/feedback', { method: 'POST', body: { data: changed } })).status, 409);
    assert.equal((await request(`/api/handbook/feedback/${id}`, { method: 'DELETE', auth: 'bob' })).status, 404);
    assert.deepEqual((await request('/api/handbook/feedback', { auth: 'bob' })).body.feedback, []);
    for (let i = 0; i < 2; i++) assert.equal((await request(`/api/handbook/feedback/${id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await request('/api/handbook/feedback', args)).status, 410);
    assert.equal(oss.objects.has(feedbackKey(alice.accountId, id)), false);
    assert.deepEqual((await request('/api/handbook/feedback')).body.feedback, []);
    assert.ok([...oss.objects.values()].every(bytes => !bytes.toString().includes('#DBB8AB')), 'withdrawal tombstones retain no color data');
  });
});

test('feedback validator derives eligibility; forged client flags cannot submit overrides or unconfirmed votes', async () => {
  await fixture(async ({ request, oss }) => {
    for (const data of [feedback({ confirmed: false, learningEligible: true }), feedback({ reason: 'CUSTOMER_OVERRIDE', learningEligible: true, learningWeight: 999 }), feedback({ reason: null }), feedback({ reason: 'IP' }), feedback({ changes: [] })]) {
      const result = await request('/api/handbook/feedback', { method: 'POST', body: { data } });
      assert.equal(result.status, 422, JSON.stringify(result.body));
    }
    const result = await request('/api/handbook/feedback', { method: 'POST', body: { data: feedback({ changes: [{ role: 'lineart', from: '#FFFFFF', to: 'javascript:alert(1)' }] }) } });
    assert.equal(result.status, 400); assert.equal(oss.objects.size, 0);
  });
});

test('an explicitly approved unchanged Golden sample retains its actual valid scoped colors', async () => {
  await fixture(async ({ request }) => {
    const context = { templateSignature: 'wedding-2', orderId: 'order-one' };
    const data = feedback({ kind: 'golden', changes: [], finalSnapshot: { id: 'a-hair', category: 'HAIR', context, layers: { lineart: '#DBB8AB', base: '#FAEFE7' }, anchorHex: '#FAEFE7' } });
    const result = await request('/api/handbook/feedback', { method: 'POST', body: { data } });
    assert.equal(result.status, 201); assert.equal(result.body.data.learningEligible, true); assert.equal(result.body.data.learningWeight, 1);
    assert.equal(result.body.data.finalSnapshot.layers.lineart, '#DBB8AB');
    data.id = 'invalid-golden'; data.finalSnapshot.layers.base = '#NOPE00';
    assert.equal((await request('/api/handbook/feedback', { method: 'POST', body: { data } })).status, 400);
  });
});

test('corrupt stored owner and cyclic OSS pagination fail closed instead of reading another owner or looping', async () => {
  const oss = fakeOss(), store = createOssHandbookStore({ env: {}, client: oss.client });
  const key = handbookVersionKey('alice', 1);
  oss.objects.set(key, Buffer.from(JSON.stringify({ revision: 1, createdAt: 'today', data: H.seedHandbook('bob') })));
  await assert.rejects(store.get('alice'), e => e.code === 'HANDBOOK_OBJECT_INVALID');
  oss.list(() => ({ objects: [], nextMarker: 'same-page' }));
  await assert.rejects(store.versions('alice'), e => e.code === 'HANDBOOK_LIST_INVALID');
});

test('a failed physical feedback delete stays hidden until retried', async () => {
  await fixture(async ({ request, oss, alice }) => {
    const args = { method: 'POST', body: { data: feedback() } };
    const created = await request('/api/handbook/feedback', args), id = created.body.id;
    const key = feedbackKey(alice.accountId, id);
    oss.failDelete(true);
    assert.equal((await request(`/api/handbook/feedback/${id}`, { method: 'DELETE' })).status, 502);
    assert.ok(oss.objects.has(key)); assert.deepEqual((await request('/api/handbook/feedback')).body.feedback, []);
    assert.equal((await request('/api/handbook/feedback', args)).status, 410);
    oss.failDelete(false);
    assert.equal((await request(`/api/handbook/feedback/${id}`, { method: 'DELETE' })).status, 200); assert.ok(!oss.objects.has(key));
  });
});

test('a submission racing with withdrawal cannot restore withdrawn feedback', async () => {
  await fixture(async ({ request, oss, alice }) => {
    const args = { method: 'POST', body: { data: feedback() } };
    const first = await request('/api/handbook/feedback', args), id = first.body.id;
    const key = feedbackKey(alice.accountId, id);
    let entered, release;
    const started = new Promise(resolve => { entered = resolve; });
    const blocked = new Promise(resolve => { release = resolve; });
    oss.beforePut(async pendingKey => { if (pendingKey === key) { entered(); await blocked; } });
    const retry = request('/api/handbook/feedback', args);
    await started;
    assert.equal((await request(`/api/handbook/feedback/${id}`, { method: 'DELETE' })).status, 200);
    release();
    assert.equal((await retry).status, 410);
    assert.ok(!oss.objects.has(key));
    assert.deepEqual((await request('/api/handbook/feedback')).body.feedback, []);
  });
});
