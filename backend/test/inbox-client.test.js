'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto').webcrypto;
const {
  normalizeEndpoint, endpointHint, normalizeDeviceToken, fileMetadata, validSignature,
  selectionKey, newRequestId, ticketInput, uploadTarget, createUploadClient,
  requestJson, persistedJobs, restoreJobs
} = require('../../inbox-client');

const ID = '0b6bbcf1-c285-4cb9-bac8-6f9a3c5779c1';
const TOKEN = 'test-session-never-production';
const ENDPOINT = 'https://backend.example';
const FILE = new File([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])], '头发_B.png', { type: 'image/png', lastModified: 100 });
const job = () => ({ ...fileMetadata(FILE), key: 'a'.repeat(64), clientRequestId: 'ipad-test-request-001', file: FILE, status: 'QUEUED' });
const item = (status = 'UPLOADING') => ({ id: ID, status, fileName: FILE.name, byteSize: FILE.size, contentType: 'image/png', expiresAt: '2099-09-10T00:00:00Z' });
const ticket = () => ({ ok: true, id: ID, item: item(), uploadUrl: 'https://bucket.example/private?signature=opaque-test', uploadHeaders: { 'Content-Type': 'image/png' }, receipt: 'opaque-receipt-test' });
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, async json() { return body; } });

test('inbox client accepts HTTPS and only loopback HTTP; rejects endpoint credentials, paths and secrets', () => {
  assert.equal(normalizeEndpoint(' https://backend.example/ '), ENDPOINT);
  assert.equal(normalizeEndpoint('http://127.0.0.1:8888'), 'http://127.0.0.1:8888');
  assert.equal(normalizeEndpoint('http://[::1]:8888/'), 'http://[::1]:8888');
  for (const value of ['http://192.168.1.2', 'http://localhost.evil.test', 'https://user:password@backend.example', 'https://backend.example/?token=123', 'https://backend.example/#token=123', 'https://backend.example/api/inbox', 'javascript:alert(1)', 'file:///tmp/index.html']) assert.throws(() => normalizeEndpoint(value), { code: 'INVALID_ENDPOINT' });
});

test('URL hint is endpoint-only and never accepts tokens in query or fragment', () => {
  assert.deepEqual(endpointHint('https://studio.example/inbox.html#endpoint=https%3A%2F%2Fbackend.example'), { endpoint: ENDPOINT, invalid: false });
  for (const suffix of ['?token=secret', '#token=secret', '#endpoint=https%3A%2F%2Fbackend.example&password=x', '#endpoint=http%3A%2F%2F192.168.0.1', '#endpoint=https://one.example&endpoint=https://two.example']) assert.equal(endpointHint('https://studio.example/inbox.html' + suffix).invalid, true);
});

test('device input cannot accept administrator tokens, session tokens or API keys', () => {
  const token = 'shine-inbox-device-v1.' + 'a'.repeat(64) + '.' + ID + '.' + 'b'.repeat(43);
  assert.equal(normalizeDeviceToken(' ' + token + ' '), token);
  for (const input of ['admin-secret', TOKEN, 'sk-some-api-key', token + '.extra']) assert.throws(() => normalizeDeviceToken(input), { code: 'INVALID_DEVICE_TOKEN' });
});

test('PSD/PNG file metadata is normalized, bounded and signature checked without decoding', () => {
  assert.deepEqual(fileMetadata({ name: '头发_B.PSD', size: 2048, type: '' }), { fileName: '头发_B.PSD', size: 2048, contentType: 'image/vnd.adobe.photoshop' });
  assert.equal(validSignature([56, 66, 80, 83, 0, 1, 0, 0], 'image/vnd.adobe.photoshop'), true);
  assert.equal(validSignature([56, 66, 80, 83, 0, 2, 0, 0], 'image/vnd.adobe.photoshop'), false);
  for (const name of ['../hair.psd', 'file.jpg', 'hair.png\u0000']) assert.throws(() => fileMetadata({ name, size: 100 }), { code: 'INVALID_INBOX_FILE_NAME' });
  assert.throws(() => fileMetadata({ name: 'hair.psd', size: 201 * 1024 * 1024 }), { code: 'INBOX_TOO_LARGE' });
  assert.throws(() => fileMetadata({ name: 'hair.psd', size: 7 }), { code: 'INVALID_INBOX_SIZE' });
});

test('same file selection reuses fingerprint; changed selection gets a new fingerprint', async () => {
  const same = new File([await FILE.arrayBuffer()], FILE.name, { lastModified: 100 });
  const changed = new File([await FILE.arrayBuffer()], FILE.name, { lastModified: 101 });
  assert.equal(await selectionKey(FILE, crypto), await selectionKey(same, crypto));
  assert.notEqual(await selectionKey(FILE, crypto), await selectionKey(changed, crypto));
  await assert.rejects(selectionKey(new File(['not a PNG'], 'fake.png'), crypto), { code: 'INBOX_FILE_SIGNATURE_MISMATCH' });
  assert.match(newRequestId(crypto), /^ipad-[a-f0-9]{32}$/);
});

test('upload is ticket → raw file PUT → complete; no bearer token or multipart reaches OSS', async () => {
  const calls = [], target = job(), stages = [];
  const client = createUploadClient({ endpoint: ENDPOINT, token: TOKEN,
    fetcher: async (url, options) => { calls.push({ url, options }); return url.endsWith('/upload-ticket') ? json(ticket(), 201) : json({ ok: true, item: item('READY') }, 201); },
    put: async (url, headers, file) => { calls.push({ url, headers, file }); }
  });
  const result = await client.upload(target, { onStage: state => stages.push(state) });
  assert.equal(result.status, 'READY'); assert.equal(calls.length, 3);
  assert.equal(calls[0].url, ENDPOINT + '/api/inbox/upload-ticket');
  assert.deepEqual(JSON.parse(calls[0].options.body), ticketInput(target));
  assert.equal(calls[0].options.headers.Authorization, 'Bearer ' + TOKEN);
  assert.equal(calls[0].options.redirect, 'error'); assert.equal(calls[0].options.credentials, 'omit');
  assert.deepEqual(calls[1].headers, { 'Content-Type': 'image/png' }); assert.equal(calls[1].file, FILE);
  assert.equal(calls[2].url, ENDPOINT + '/api/inbox/' + ID + '/complete');
  assert.deepEqual(JSON.parse(calls[2].options.body), { receipt: 'opaque-receipt-test' });
  assert.deepEqual(stages, ['TICKET', 'UPLOADING', 'CONFIRMING']); assert.equal(target.inFlight, false);
});

test('reused READY/RECEIVED ticket skips file transfer and confirmation', async () => {
  for (const status of ['READY', 'RECEIVED']) {
    let calls = 0;
    const client = createUploadClient({ endpoint: ENDPOINT, token: TOKEN, fetcher: async () => { calls++; return json({ ok: true, id: ID, item: item(status), uploadUrl: null, receipt: null }); }, put: async () => assert.fail('must not resend') });
    assert.equal((await client.upload(job())).status, status); assert.equal(calls, 1);
  }
});

test('lost complete response retries confirmation only with original id; no duplicate PSD upload', async () => {
  const paths = [], target = job(); let failComplete = true, puts = 0;
  const client = createUploadClient({ endpoint: ENDPOINT, token: TOKEN,
    fetcher: async url => { paths.push(url); if (url.endsWith('/upload-ticket')) return json(ticket()); if (failComplete) { failComplete = false; throw new TypeError('network with sensitive URL'); } return json({ ok: true, item: item('READY') }); },
    put: async () => { puts++; }
  });
  await assert.rejects(client.upload(target), { code: 'NETWORK_ERROR' });
  assert.equal((await client.upload(target)).status, 'READY');
  assert.equal(puts, 1); assert.equal(paths.filter(url => url.endsWith('/upload-ticket')).length, 1);
  assert.equal(target.clientRequestId, 'ipad-test-request-001');
});

test('uncertain PUT is confirmed before retrying transfer; missing upload reuses same request id', async () => {
  const target = job(), requests = []; let puts = 0, missing = true;
  const client = createUploadClient({ endpoint: ENDPOINT, token: TOKEN,
    fetcher: async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); if (url.endsWith('/upload-ticket')) return json(ticket()); if (missing) { missing = false; return json({ ok: false, error: 'INBOX_UPLOAD_MISSING' }, 409); } return json({ ok: true, item: item('READY') }); },
    put: async () => { if (++puts === 1) throw Object.assign(new Error('interrupted'), { code: 'UPLOAD_FAILED' }); }
  });
  await assert.rejects(client.upload(target), { code: 'UPLOAD_FAILED' });
  assert.equal((await client.upload(target)).status, 'READY');
  assert.ok(requests[1].url.endsWith('/complete'));
  assert.deepEqual(requests.filter(row => row.url.endsWith('/upload-ticket')).map(row => row.body.clientRequestId), ['ipad-test-request-001', 'ipad-test-request-001']);
});

test('parallel send of one job is rejected; protocol guard releases lock after failure', async () => {
  let release;
  const target = job();
  const client = createUploadClient({ endpoint: ENDPOINT, token: TOKEN, fetcher: () => new Promise(resolve => { release = resolve; }) });
  const first = client.upload(target);
  await assert.rejects(client.upload(target), { code: 'UPLOAD_FAILED' });
  release(json({ ok: true, id: ID, item: item('RECEIVED'), uploadUrl: null, receipt: null }));
  await first; assert.equal(target.inFlight, false);
});

test('malformed signed targets and credential header forwarding are rejected', () => {
  const meta = fileMetadata(FILE);
  assert.throws(() => uploadTarget({ ...ticket(), uploadUrl: 'http://bucket.example/object' }, meta, ENDPOINT), { code: 'INVALID_RESPONSE' });
  assert.throws(() => uploadTarget({ ...ticket(), uploadHeaders: { 'Content-Type': 'image/png', Authorization: 'Bearer secret' } }, meta, ENDPOINT), { code: 'INVALID_RESPONSE' });
  assert.throws(() => uploadTarget({ ...ticket(), uploadHeaders: { 'Content-Type': 'application/octet-stream' } }, meta, ENDPOINT), { code: 'INVALID_RESPONSE' });
});

test('only harmless retry metadata persists: no file bytes, bearer, receipt, URL or private object key', () => {
  const target = { ...job(), id: ID, status: 'UPLOADING', token: TOKEN, receipt: 'sensitive', uploadUrl: 'https://private?signature=x', objectKey: 'private/object' };
  const records = persistedJobs([target]), serialized = JSON.stringify(records);
  for (const forbidden of ['sensitive', TOKEN, 'private', 'receipt', 'uploadUrl', 'objectKey', '"file":']) assert.equal(serialized.includes(forbidden), false);
  const restored = restoreJobs(records)[0]; assert.equal(restored.status, 'WAITING_FILE'); assert.equal(restored.clientRequestId, target.clientRequestId); assert.equal(restored.file, null);
  assert.deepEqual(restoreJobs([{ ...records[0], clientRequestId: '' }]), []);
});

test('request failure messages do not expose server errors, tokens or signed URLs', async () => {
  await assert.rejects(requestJson(async () => { throw new Error('secret=https://private?token=sensitive'); }, ENDPOINT, '/api/inbox'), error => error.code === 'NETWORK_ERROR' && !error.message.includes('sensitive'));
  await assert.rejects(requestJson(async () => json({ ok: false, error: 'sensitive internal URL' }, 500), ENDPOINT, '/api/inbox'), error => !error.message.includes('sensitive'));
  const abort = new AbortController(); abort.abort();
  await assert.rejects(requestJson(async () => assert.fail('must not send'), ENDPOINT, '/api/inbox', { signal: abort.signal }), { code: 'REQUEST_CANCELLED' });
});
