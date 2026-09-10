'use strict';

const crypto = require('crypto');
const { inboxObjectKey, ownerScope } = require('./oss-inbox-store');
const PREFIX = '/api/inbox';
const RETENTION_HOURS = 48;
const DEVICE_PREFIX = 'shine-inbox-device-v1.';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
class InboxError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }
const fail = (status, code) => { throw new InboxError(status, code); };
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function equal(left, right) { return crypto.timingSafeEqual(Buffer.from(hash(String(left))), Buffer.from(hash(String(right)))); }
function idForRequest(ownerId, requestId) { const h = hash(JSON.stringify([ownerId, requestId])); return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; }
function signReceipt(claim, secret) { const payload = Buffer.from(JSON.stringify(claim)).toString('base64url'); return `${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('base64url')}`; }
function readReceipt(value, secret) {
  const [payload, signature, extra] = String(value || '').split('.');
  if (!payload || !signature || extra || payload.length > 8192 || !equal(signature, crypto.createHmac('sha256', secret).update(payload).digest('base64url'))) fail(400, 'INVALID_INBOX_RECEIPT');
  let claim; try { claim = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { fail(400, 'INVALID_INBOX_RECEIPT'); }
  if (!claim || claim.v !== 1 || claim.purpose !== 'inbox-upload' || !Number.isFinite(claim.uploadExpiresAt)) fail(400, 'INVALID_INBOX_RECEIPT');
  return claim;
}
function validateInput(body, maxBytes) {
  if (['owner', 'ownerId', 'accountId', 'objectKey', 'sourceObjectKey'].some(key => Object.prototype.hasOwnProperty.call(body, key))) fail(400, 'INBOX_OWNER_SERVER_ONLY');
  const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
  if (!fileName || fileName.length > 255 || /[\\/\x00-\x1f]/.test(fileName) || !/\.(psd|png)$/i.test(fileName)) fail(400, 'INVALID_INBOX_FILE_NAME');
  const size = body.size;
  if (!Number.isSafeInteger(size) || size < 8) fail(400, 'INVALID_INBOX_SIZE');
  if (size > maxBytes) fail(413, 'INBOX_TOO_LARGE');
  const contentType = typeof body.contentType === 'string' ? body.contentType.trim().toLowerCase() : '';
  const png = /\.png$/i.test(fileName), allowed = png ? ['image/png'] : ['image/vnd.adobe.photoshop', 'application/vnd.adobe.photoshop', 'application/photoshop', 'image/psd', 'application/octet-stream'];
  if (!allowed.includes(contentType)) fail(400, 'INVALID_INBOX_CONTENT_TYPE');
  const clientRequestId = typeof body.clientRequestId === 'string' ? body.clientRequestId : '';
  if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(clientRequestId)) fail(400, 'INVALID_INBOX_REQUEST_ID');
  return { fileName, byteSize: size, contentType, clientRequestId };
}
function publicItem(item, time) {
  const status = item.status === 'DELETED' ? 'DELETED' : Date.parse(item.expiresAt) <= time ? 'EXPIRED' : item.status;
  return { id: item.id, fileName: item.fileName, byteSize: item.byteSize, contentType: item.contentType, status, createdAt: item.createdAt, expiresAt: item.expiresAt, completedAt: item.completedAt || null, receivedAt: item.receivedAt || null, colorMode: 'PRESERVE_ORIGINAL' };
}
function publicDevice(device) { return { id: device.id, name: device.name, createdAt: device.createdAt, expiresAt: device.expiresAt, revokedAt: device.revokedAt || null, scope: 'inbox:upload' }; }

function createInboxHandler({ storeFactory, authorize, accountStoreFactory, profileToken, secret, readBody, now, maxBytes = 200 * 1024 * 1024, logger = console }) {
  async function authorizeInbox(req, store) {
    const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')?.[1] || '';
    if (!bearer.startsWith(DEVICE_PREFIX)) { const auth = await authorize(req); return { ownerId: auth.legacy ? auth.accountId : auth.sub, username: auth.username, legacy: !!auth.legacy, uploadOnly: false }; }
    const match = /^shine-inbox-device-v1\.([a-f0-9]{64})\.([a-f0-9-]{36})\.([A-Za-z0-9_-]{43})$/.exec(bearer);
    if (!match || !UUID.test(match[2])) fail(401, 'INVALID_INBOX_DEVICE');
    const device = await store.getDeviceByScope(match[1], match[2]);
    if (!device || !equal(hash(bearer), device.tokenHash) || ownerScope(device.ownerId) !== match[1] || device.id !== match[2] || device.revokedAt || !Number.isFinite(Date.parse(device.expiresAt)) || Date.parse(device.expiresAt) <= now().getTime()) fail(401, 'INBOX_DEVICE_REVOKED_OR_EXPIRED');
    if (device.legacy) { if (!profileToken || device.ownerId !== 'legacy-admin') fail(401, 'INBOX_DEVICE_REVOKED_OR_EXPIRED'); }
    else {
      if (typeof accountStoreFactory !== 'function') fail(503, 'ACCOUNT_STORE_NOT_CONFIGURED');
      const account = await (await accountStoreFactory(req)).get(device.username);
      if (!account || account.disabled || account.accountId !== device.ownerId) fail(401, 'INBOX_DEVICE_REVOKED_OR_EXPIRED');
    }
    return { ownerId: device.ownerId, username: device.username, legacy: device.legacy, uploadOnly: true, deviceId: device.id };
  }
  async function cleanup(store, ownerId, item) {
    try { await store.deleteItem(ownerId, item.id, now().toISOString(), 'EXPIRED'); return true; }
    catch { logger.error?.('Shine inbox cleanup deferred', { code: 'INBOX_CLEANUP_DEFERRED' }); return false; }
  }
  return async function handle(req, url) {
    if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`)) return null;
    if (typeof storeFactory !== 'function') fail(503, 'INBOX_STORE_NOT_CONFIGURED');
    if (!secret) fail(503, 'PROFILE_AUTH_NOT_CONFIGURED');
    const store = await storeFactory(req), auth = await authorizeInbox(req, store), ownerId = auth.ownerId;
    if (!ownerId) fail(401, 'UNAUTHORIZED');
    const path = url.pathname.slice(PREFIX.length), timestamp = now().getTime();
    const deviceRoute = /^\/devices(?:\/([a-f0-9-]{36}))?$/.exec(path);
    if (deviceRoute) {
      if (auth.uploadOnly) fail(403, 'INBOX_UPLOAD_ONLY');
      const id = deviceRoute[1]; if (id && !UUID.test(id)) fail(400, 'INVALID_INBOX_DEVICE');
      if (!id && req.method === 'GET') return { status: 200, body: { ok: true, devices: (await store.listDevices(ownerId)).filter(Boolean).map(publicDevice) } };
      if (!id && req.method === 'POST') {
        const body = await readBody(req), name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!name || name.length > 80 || /[\x00-\x1f]/.test(name)) fail(400, 'INVALID_INBOX_DEVICE_NAME');
        const active = (await store.listDevices(ownerId)).filter(d => d && !d.revokedAt && Date.parse(d.expiresAt) > timestamp);
        if (active.length >= 12) fail(409, 'INBOX_DEVICE_LIMIT');
        const deviceId = crypto.randomUUID(), token = `${DEVICE_PREFIX}${ownerScope(ownerId)}.${deviceId}.${crypto.randomBytes(32).toString('base64url')}`;
        const device = { id: deviceId, name, ownerId, username: auth.username, legacy: auth.legacy, tokenHash: hash(token), createdAt: now().toISOString(), expiresAt: new Date(timestamp + 30 * 86400000).toISOString() };
        await store.createDevice(ownerId, device);
        return { status: 201, body: { ok: true, device: publicDevice(device), token, warning: 'UPLOAD_ONLY_TOKEN_SHOWN_ONCE' } };
      }
      if (id && req.method === 'DELETE') {
        const device = await store.getDeviceByScope(ownerScope(ownerId), id); if (!device) fail(404, 'INBOX_DEVICE_NOT_FOUND');
        await store.revokeDevice(ownerId, id, now().toISOString()); return { status: 200, body: { ok: true, revokedDeviceId: id } };
      }
      fail(404, 'NOT_FOUND');
    }
    if (auth.uploadOnly && !(path === '/upload-ticket' && req.method === 'POST') && !(/^\/[a-f0-9-]{36}\/complete$/.test(path) && req.method === 'POST')) fail(403, 'INBOX_UPLOAD_ONLY');
    if (!path && req.method === 'GET') {
      // A still-valid PUT URL can recreate staging bytes after a delete. Keep
      // retrying tombstone cleanup too; the record can never become downloadable.
      const rows = await store.listItems(ownerId), expired = rows.filter(item => item.status === 'DELETED' || Date.parse(item.expiresAt) <= timestamp);
      let cleaned = 0, deferred = 0;
      for (const item of expired.slice(0, 20)) (await cleanup(store, ownerId, item)) ? cleaned++ : deferred++;
      const items = rows.filter(item => item.status !== 'DELETED').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100).map(item => publicItem(item, timestamp));
      return { status: 200, body: { ok: true, items, retentionHours: RETENTION_HOURS, cleanupPolicy: 'opportunistic', cleanup: { cleaned, deferred: deferred + Math.max(0, expired.length - 20), physicalDeletionScheduled: false } } };
    }
    if (path === '/upload-ticket' && req.method === 'POST') {
      const input = validateInput(await readBody(req), maxBytes), id = idForRequest(ownerId, input.clientRequestId);
      let item = await store.getItem(ownerId, id), reused = !!item;
      if (!item) {
        const active = (await store.listItems(ownerId)).filter(row => row.status !== 'DELETED' && Date.parse(row.expiresAt) > timestamp);
        if (active.length >= 30 || active.reduce((sum, row) => sum + row.byteSize, 0) + input.byteSize > 1024 * 1024 * 1024) fail(429, 'INBOX_QUOTA_EXCEEDED');
        item = await store.createItem(ownerId, { schemaVersion: 'shine-inbox-v1', id, ownerId, ...input, sourceDeviceId: auth.deviceId || null, status: 'UPLOADING', createdAt: now().toISOString(), expiresAt: new Date(timestamp + RETENTION_HOURS * 3600000).toISOString() });
      }
      if (auth.uploadOnly && item.sourceDeviceId !== auth.deviceId) fail(403, 'INBOX_DEVICE_ITEM_MISMATCH');
      if (Object.keys(input).some(key => input[key] !== item[key])) fail(409, 'INBOX_REQUEST_ID_CONFLICT');
      if (item.status === 'DELETED') fail(410, 'INBOX_DELETED');
      if (Date.parse(item.expiresAt) <= timestamp) { await cleanup(store, ownerId, item); fail(410, 'INBOX_EXPIRED'); }
      if (['READY', 'RECEIVED'].includes(item.status)) return { status: 200, body: { ok: true, id, reused: true, item: publicItem(item, timestamp), uploadUrl: null, receipt: null, expiresAt: item.expiresAt } };
      const seconds = Math.max(1, Math.min(900, Math.floor((Date.parse(item.expiresAt) - timestamp) / 1000))), signed = await store.createUploadTicket(ownerId, item, seconds), uploadExpiresAt = timestamp + seconds * 1000;
      const claim = { v: 1, purpose: 'inbox-upload', ownerId, id, fileName: item.fileName, size: item.byteSize, mime: item.contentType, objectKey: signed.objectKey, uploadExpiresAt, expiresAt: item.expiresAt };
      return { status: reused ? 200 : 201, body: { ok: true, id, ...signed, receipt: signReceipt(claim, secret), uploadExpiresAt: new Date(uploadExpiresAt).toISOString(), expiresAt: item.expiresAt, item: publicItem(item, timestamp), reused } };
    }
    const match = /^\/([a-f0-9-]{36})(?:\/(complete|source|received))?$/.exec(path);
    if (!match || !UUID.test(match[1])) fail(404, 'NOT_FOUND');
    const id = match[1], action = match[2] || 'item', item = await store.getItem(ownerId, id);
    if (!item) fail(404, 'INBOX_NOT_FOUND');
    if (auth.uploadOnly && item.sourceDeviceId !== auth.deviceId) fail(403, 'INBOX_DEVICE_ITEM_MISMATCH');
    if (action === 'item' && req.method === 'DELETE') { await store.deleteItem(ownerId, id, now().toISOString()); return { status: 200, body: { ok: true, deletedId: id } }; }
    if (item.status === 'DELETED') fail(410, 'INBOX_DELETED');
    if (Date.parse(item.expiresAt) <= timestamp) { await cleanup(store, ownerId, item); fail(410, 'INBOX_EXPIRED'); }
    if (action === 'complete' && req.method === 'POST') {
      const body = await readBody(req), claim = readReceipt(body.receipt, secret);
      if (claim.ownerId !== ownerId || claim.id !== id || claim.fileName !== item.fileName || claim.size !== item.byteSize || claim.mime !== item.contentType || claim.expiresAt !== item.expiresAt || claim.objectKey !== inboxObjectKey(ownerId, id, 'upload')) fail(400, 'INBOX_RECEIPT_MISMATCH');
      // A completed retry may outlive its PUT ticket, but not the 48-hour item expiry.
      if (['READY', 'RECEIVED'].includes(item.status)) return { status: 200, body: { ok: true, item: publicItem(item, timestamp), reused: true } };
      if (claim.uploadExpiresAt <= timestamp) fail(410, 'INBOX_UPLOAD_RECEIPT_EXPIRED');
      const upload = await store.inspectUpload(ownerId, id);
      if (!upload) fail(409, 'INBOX_UPLOAD_MISSING');
      if (upload.objectKey !== claim.objectKey || upload.size !== item.byteSize || upload.contentType !== item.contentType) fail(409, 'INBOX_UPLOAD_MISMATCH');
      const magic = Buffer.from(upload.magic || []), validType = /\.png$/i.test(item.fileName) ? magic.equals(Buffer.from([137,80,78,71,13,10,26,10])) : magic.length >= 6 && magic.subarray(0,4).toString('ascii') === '8BPS' && magic[4] === 0 && magic[5] === 1;
      if (!validType) fail(415, 'INBOX_FILE_SIGNATURE_MISMATCH');
      const final = await store.finalizeSource(ownerId, id, upload);
      const completed = await store.markComplete(ownerId, id, { completedAt: now().toISOString(), sourceObjectKey: final.objectKey, sourceEtag: final.etag });
      // A parallel delete marker always wins over completion.
      if (completed.status === 'DELETED' || completed.status === 'EXPIRED') { await store.deleteItem(ownerId, id, now().toISOString(), completed.status); fail(410, 'INBOX_DELETED'); }
      return { status: 201, body: { ok: true, item: publicItem(completed, timestamp), reused: false } };
    }
    if (action === 'source' && req.method === 'GET') {
      if (!['READY', 'RECEIVED'].includes(item.status)) fail(409, 'INBOX_UPLOAD_NOT_COMPLETE');
      const seconds = Math.max(1, Math.min(300, Math.floor((Date.parse(item.expiresAt) - timestamp) / 1000)));
      const signed = await store.createDownloadTicket(ownerId, id, seconds);
      return { status: 200, body: { ok: true, item: publicItem(item, timestamp), ...signed, downloadExpiresAt: new Date(timestamp + seconds * 1000).toISOString() } };
    }
    if (action === 'received' && req.method === 'POST') {
      if (!['READY', 'RECEIVED'].includes(item.status)) fail(409, 'INBOX_UPLOAD_NOT_COMPLETE');
      const received = await store.markReceived(ownerId, id, { receivedAt: now().toISOString() });
      return { status: 200, body: { ok: true, item: publicItem(received, timestamp) } };
    }
    fail(404, 'NOT_FOUND');
  };
}

module.exports = { createInboxHandler, idForRequest, publicItem, readReceipt, signReceipt, validateInput };
