const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { createApp } = require('../src/app');
const { profileEtag } = require('../src/oss-profile-store');

const TOKEN = 'local-test-token';
const SIGNATURE = '1500x1500:2:abc123';

function templateData(signature = SIGNATURE) {
  return {
    schemaVersion: 'shine-template-0.28-alpha',
    template: { fileName: 'template.psd', width: 1500, height: 1500, signature },
    colorPolicy: { preset: [], manualAnchor: [], derived: [], fixed: [] },
    rootStackOrder: [],
    hairInsertion: { A: { path: '', position: 'below' }, B: { path: '', position: 'below' } },
    bindings: {}
  };
}

function memoryStore() {
  const records = new Map();
  return {
    async get(signature) {
      return records.get(signature) || null;
    },
    async create(signature, profile) {
      if (records.has(signature)) throw Object.assign(new Error('conflict'), { status: 412, code: 'PROFILE_CONFLICT' });
      const stored = { profile, etag: profileEtag(profile) };
      records.set(signature, stored);
      return stored;
    },
    async update(signature, profile, expectedEtag) {
      const current = records.get(signature);
      if (!current || current.etag !== expectedEtag) {
        throw Object.assign(new Error('conflict'), { status: 412, code: 'PROFILE_CONFLICT' });
      }
      const stored = { profile, etag: profileEtag(profile) };
      records.set(signature, stored);
      return stored;
    }
  };
}

async function withServer(app, callback) {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function appOptions(overrides = {}) {
  const store = overrides.store || memoryStore();
  return {
    profileToken: TOKEN,
    allowedOrigin: 'https://zxy0501.github.io',
    storeFactory: () => store,
    now: () => new Date('2026-08-09T12:00:00.000Z'),
    logger: { error() {} },
    ...overrides
  };
}

function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${TOKEN}`, ...extra };
}

test('preserves the v0.1 health and ping response contracts', async () => {
  await withServer(createApp(appOptions()), async baseUrl => {
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      ok: true,
      service: 'shine-backend',
      stage: 'phase-1-connectivity'
    });

    const ping = await fetch(`${baseUrl}/api/ping`);
    assert.equal(ping.status, 200);
    assert.deepEqual(await ping.json(), {
      ok: true,
      message: 'Shine backend is connected.',
      time: '2026-08-09T12:00:00.000Z'
    });
  });
});

test('profile endpoints fail closed when auth is not configured', async () => {
  await withServer(createApp(appOptions({ profileToken: '' })), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/template-profiles/${SIGNATURE}`, { headers: authHeaders() });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, 'PROFILE_AUTH_NOT_CONFIGURED');
  });
});

test('rejects missing and incorrect bearer tokens', async () => {
  await withServer(createApp(appOptions()), async baseUrl => {
    const missing = await fetch(`${baseUrl}/api/template-profiles/${SIGNATURE}`);
    assert.equal(missing.status, 401);

    const wrong = await fetch(`${baseUrl}/api/template-profiles/${SIGNATURE}`, {
      headers: { Authorization: 'Bearer wrong-token' }
    });
    assert.equal(wrong.status, 401);
  });
});

test('creates and reads a valid template profile with an ETag', async () => {
  await withServer(createApp(appOptions()), async baseUrl => {
    const create = await fetch(`${baseUrl}/api/template-profiles/${SIGNATURE}`, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json', 'If-None-Match': '*' }),
      body: JSON.stringify({ data: templateData() })
    });
    assert.equal(create.status, 201);
    assert.match(create.headers.get('etag'), /^"[a-f0-9]{64}"$/);
    assert.equal((await create.json()).revision, 1);

    const get = await fetch(`${baseUrl}/api/template-profiles/${SIGNATURE}`, { headers: authHeaders() });
    assert.equal(get.status, 200);
    assert.equal((await get.json()).data.template.signature, SIGNATURE);
    assert.equal(get.headers.get('cache-control'), 'no-store');
  });
});

test('validates schema, signature, and request size', async () => {
  await withServer(createApp(appOptions({ maxBodyBytes: 1024 })), async baseUrl => {
    const mismatch = await fetch(`${baseUrl}/api/template-profiles/${SIGNATURE}`, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json', 'If-None-Match': '*' }),
      body: JSON.stringify({ data: templateData('other-signature') })
    });
    assert.equal(mismatch.status, 400);
    assert.equal((await mismatch.json()).error, 'PROFILE_SIGNATURE_MISMATCH');

    const tooLarge = await fetch(`${baseUrl}/api/template-profiles/${SIGNATURE}`, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json', 'If-None-Match': '*' }),
      body: JSON.stringify({ padding: 'x'.repeat(1200) })
    });
    assert.equal(tooLarge.status, 413);
  });
});

test('requires and enforces ETag preconditions for updates', async () => {
  await withServer(createApp(appOptions()), async baseUrl => {
    const url = `${baseUrl}/api/template-profiles/${SIGNATURE}`;
    const create = await fetch(url, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json', 'If-None-Match': '*' }),
      body: JSON.stringify({ data: templateData() })
    });
    const firstEtag = create.headers.get('etag');

    const noCondition = await fetch(url, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ data: templateData() })
    });
    assert.equal(noCondition.status, 428);

    const stale = await fetch(url, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json', 'If-Match': '"stale"' }),
      body: JSON.stringify({ data: templateData() })
    });
    assert.equal(stale.status, 412);

    const update = await fetch(url, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json', 'If-Match': firstEtag }),
      body: JSON.stringify({ data: templateData() })
    });
    assert.equal(update.status, 200);
    assert.equal((await update.json()).revision, 2);
    assert.notEqual(update.headers.get('etag'), firstEtag);
  });
});

test('advertises PUT, conditional headers, and ETag through CORS', async () => {
  await withServer(createApp(appOptions()), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/template-profiles/${SIGNATURE}`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://zxy0501.github.io' }
    });
    assert.equal(response.status, 204);
    assert.match(response.headers.get('access-control-allow-methods'), /PUT/);
    assert.match(response.headers.get('access-control-allow-headers'), /If-Match/);
    assert.equal(response.headers.get('access-control-expose-headers'), 'ETag');
  });
});

test('rejects a malformed profile already present in storage', async () => {
  const store = {
    async get() {
      return { profile: { apiVersion: 1, revision: 1 }, etag: '"invalid"' };
    }
  };
  await withServer(createApp(appOptions({ store })), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/template-profiles/${SIGNATURE}`, { headers: authHeaders() });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, 'PROFILE_OBJECT_INVALID');
  });
});
