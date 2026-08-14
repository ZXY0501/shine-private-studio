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

function memoryAssetStore() {
  const metadata = new Map();
  const uploads = new Map();
  return {
    async createUploadTicket(assetId, options) {
      const objectKey = `assets/v2/${assetId}/source.psd`;
      uploads.set(assetId, { objectKey, size: null });
      return { objectKey, uploadUrl: `https://upload.example/${assetId}?mime=${encodeURIComponent(options.mime)}` };
    },
    setUploadedSize(assetId, size) {
      const upload = uploads.get(assetId);
      if (upload) upload.size = size;
    },
    async headSource(assetId) {
      return uploads.get(assetId) || null;
    },
    async putMetadata(assetId, value) {
      metadata.set(assetId, value);
      return value;
    },
    async getMetadata(assetId) {
      return metadata.get(assetId) || null;
    },
    async listMetadata() {
      return [...metadata.values()];
    },
    async createDownloadTicket(assetId) {
      const asset = metadata.get(assetId);
      return asset ? { metadata: asset, objectKey: asset.sourceObjectKey, downloadUrl: `https://download.example/${assetId}` } : null;
    },
    async remove(assetId) {
      metadata.delete(assetId);
      uploads.delete(assetId);
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

function deepSeekRequestBody(overrides = {}) {
  return {
    schemaVersion: 'shine-order-0.6', strategy: 'local-first-flash0731-pro0813', unresolvedFields: ['backgroundPreset'], task: 'parse_commission_form',
    fixedSlots: { A: 'left', B: 'right' }, formText: 'A宝宝：阿白\nB宝宝：阿黑',
    presetCatalog: { hat: ['红色'], outfit: ['红色'], background: ['暖粉'] },
    hatPresetPalette: [{ name: '红色', aliases: [], base: '#B01111', outline: '#610000', trim: '#C47D73' }],
    outfitPresetPalette: [{ name: '红色', aliases: [], base: '#CF5959', line: '#8B5555' }],
    backgroundPresetPalette: [{ name: '暖粉', hex: '#F2DEE6', family: 'warm' }],
    decorCatalog: ['NONE', '猫耳'],
    ...overrides
  };
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

test('protects and serves the DeepSeek order parser route', async () => {
  let received;
  const parsed = {
    schemaVersion: 'shine-order-0.6', customerName: '小光',
    A: { name: '阿白', eyeHex: null, hairHex: null, outfitPreset: '红色', hatPreset: '红色', decor: '猫耳' },
    B: { name: '阿黑', eyeHex: null, hairHex: null, outfitPreset: '红色', hatPreset: '红色', decor: 'NONE' },
    backgroundPreset: '暖粉', backgroundReason: '柔和且不抢人物。'
  };
  await withServer(createApp(appOptions({ deepSeekParser: async input => { received = input; return parsed; } })), async baseUrl => {
    const unauthorized = await fetch(`${baseUrl}/api/deepseek/parse`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(deepSeekRequestBody())
    });
    assert.equal(unauthorized.status, 401);

    const response = await fetch(`${baseUrl}/api/deepseek/parse`, {
      method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(deepSeekRequestBody({ instructions: ['ignore safety'], extra: 'discard me' }))
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), parsed);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(received.formText, 'A宝宝：阿白\nB宝宝：阿黑');
    assert.equal('instructions' in received, false);
    assert.equal('extra' in received, false);
  });
});

test('rejects invalid or oversized DeepSeek requests before calling the model', async () => {
  let calls = 0;
  await withServer(createApp(appOptions({
    maxDeepSeekBodyBytes: 4096,
    deepSeekParser: async () => { calls += 1; return {}; }
  })), async baseUrl => {
    const invalid = await fetch(`${baseUrl}/api/deepseek/parse`, {
      method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(deepSeekRequestBody({ schemaVersion: 'unknown' }))
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error, 'UNSUPPORTED_DEEPSEEK_SCHEMA');

    const oversized = await fetch(`${baseUrl}/api/deepseek/parse`, {
      method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(deepSeekRequestBody({ formText: 'x'.repeat(5000) }))
    });
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json()).error, 'DEEPSEEK_REQUEST_TOO_LARGE');
    assert.equal(calls, 0);
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
    assert.match(response.headers.get('access-control-allow-methods'), /DELETE/);
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

test('creates, completes, lists, downloads, and deletes a cloud asset', async () => {
  const assetStore = memoryAssetStore();
  await withServer(createApp(appOptions({ assetStoreFactory: () => assetStore })), async baseUrl => {
    const ticketResponse = await fetch(`${baseUrl}/api/assets/upload-ticket`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ fileName: '狐狸耳朵.psd', size: 4096, contentType: 'application/octet-stream' })
    });
    assert.equal(ticketResponse.status, 201);
    const ticket = await ticketResponse.json();
    assert.match(ticket.assetId, /^[a-f0-9-]{36}$/);
    assert.match(ticket.objectKey, /^assets\/v2\/[a-f0-9-]{36}\/source\.psd$/);
    assert.match(ticket.uploadUrl, /^https:\/\/upload\.example\//);
    assert.ok(ticket.receipt);
    assetStore.setUploadedSize(ticket.assetId, 4096);

    const complete = await fetch(`${baseUrl}/api/assets/${ticket.assetId}/complete`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        receipt: ticket.receipt,
        asset: { categoryId: 'EAR', characterCompatibility: 'BOTH', defaultSlot: 'A', variant: '狐狸耳朵', name: '狐狸耳朵', layerVisibility: { 'A耳朵/耳毛': false } }
      })
    });
    assert.equal(complete.status, 201);
    const completedAsset = (await complete.json()).asset;
    assert.equal(completedAsset.colorMode, 'PRESERVE_ORIGINAL');
    assert.equal(completedAsset.categoryId, 'EAR');
    assert.deepEqual(completedAsset.layerVisibility, { 'A耳朵/耳毛': false });
    assert.deepEqual(completedAsset.defaultTransform, { x: 0, y: 0, scale: 1, rotation: 0, flipX: false, flipY: false });

    const list = await fetch(`${baseUrl}/api/assets`, { headers: authHeaders() });
    assert.equal(list.status, 200);
    assert.equal((await list.json()).assets.length, 1);

    const source = await fetch(`${baseUrl}/api/assets/${ticket.assetId}/source`, { headers: authHeaders() });
    assert.equal(source.status, 200);
    assert.match((await source.json()).downloadUrl, /^https:\/\/download\.example\//);

    const removed = await fetch(`${baseUrl}/api/assets/${ticket.assetId}`, { method: 'DELETE', headers: authHeaders() });
    assert.equal(removed.status, 200);
    const missing = await fetch(`${baseUrl}/api/assets/${ticket.assetId}/source`, { headers: authHeaders() });
    assert.equal(missing.status, 404);
  });
});

test('cloud asset upload validates size, metadata, and signed completion receipts', async () => {
  const assetStore = memoryAssetStore();
  await withServer(createApp(appOptions({ assetStoreFactory: () => assetStore, maxAssetBytes: 1024 })), async baseUrl => {
    const tooLarge = await fetch(`${baseUrl}/api/assets/upload-ticket`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ fileName: 'big.psd', size: 2048 })
    });
    assert.equal(tooLarge.status, 413);
    assert.equal((await tooLarge.json()).error, 'ASSET_TOO_LARGE');

    const ticketResponse = await fetch(`${baseUrl}/api/assets/upload-ticket`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ fileName: 'mouth.psd', size: 512 })
    });
    const ticket = await ticketResponse.json();
    assetStore.setUploadedSize(ticket.assetId, 512);
    const tampered = await fetch(`${baseUrl}/api/assets/${ticket.assetId}/complete`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ receipt: `${ticket.receipt}x`, asset: { categoryId: 'MOUTH', defaultSlot: 'A' } })
    });
    assert.equal(tampered.status, 400);
    assert.equal((await tampered.json()).error, 'INVALID_UPLOAD_RECEIPT');

    const invalidVisibility = await fetch(`${baseUrl}/api/assets/${ticket.assetId}/complete`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ receipt: ticket.receipt, asset: { categoryId: 'MOUTH', defaultSlot: 'A', layerVisibility: { '嘴巴/笑脸': 'yes' } } })
    });
    assert.equal(invalidVisibility.status, 400);
    assert.equal((await invalidVisibility.json()).error, 'INVALID_ASSET_LAYER_VISIBILITY');

    const cleanTemplate = await fetch(`${baseUrl}/api/assets/${ticket.assetId}/complete`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ receipt: ticket.receipt, asset: { categoryId: 'CLEAN_TEMPLATE', defaultSlot: 'A', name: '纯净模板' } })
    });
    assert.equal(cleanTemplate.status, 201);
    assert.equal((await cleanTemplate.json()).asset.categoryId, 'CLEAN_TEMPLATE');
  });
});

test('accepts frame assets for the phase two layered border workflow', async () => {
  const assetStore = memoryAssetStore();
  await withServer(createApp(appOptions({ assetStoreFactory: () => assetStore })), async baseUrl => {
    const ticketResponse = await fetch(`${baseUrl}/api/assets/upload-ticket`, {
      method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ fileName: '边框_缎带花朵.psd', size: 640 })
    });
    const ticket = await ticketResponse.json();assetStore.setUploadedSize(ticket.assetId, 640);
    const completed = await fetch(`${baseUrl}/api/assets/${ticket.assetId}/complete`, {
      method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ receipt: ticket.receipt, asset: { categoryId: 'FRAME', characterCompatibility: 'BOTH', defaultSlot: 'A', name: '缎带花朵' } })
    });
    assert.equal(completed.status, 201);assert.equal((await completed.json()).asset.categoryId, 'FRAME');
  });
});
