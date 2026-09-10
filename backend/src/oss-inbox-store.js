'use strict';

const crypto = require('crypto');
const OSS = require('ali-oss');
const { StoreError, resolveCredentials } = require('./oss-profile-store');

const PREFIX = 'private-inbox/v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const missing = error => error?.status === 404 || ['NoSuchKey', 'NoSuchObject'].includes(error?.code);
const conflict = error => [409, 412].includes(error?.status) || ['FileAlreadyExists', 'ObjectAlreadyExists'].includes(error?.code);

function ownerScope(ownerId) {
  if (typeof ownerId !== 'string' || !ownerId || ownerId.length > 256) throw new StoreError(400, 'INVALID_INBOX_OWNER');
  return crypto.createHash('sha256').update(ownerId).digest('hex');
}
function safeId(id) {
  if (!UUID.test(String(id || ''))) throw new StoreError(400, 'INVALID_INBOX_ID');
  return id.toLowerCase();
}
function scopePrefix(scope) {
  if (!/^[a-f0-9]{64}$/.test(String(scope || ''))) throw new StoreError(400, 'INVALID_INBOX_OWNER');
  return `${PREFIX}/owners/${scope}`;
}
function inboxObjectKey(ownerId, id, kind = 'source') {
  if (!['source', 'upload', 'record', 'completed', 'received', 'deleted'].includes(kind)) throw new StoreError(400, 'INVALID_INBOX_KEY');
  return `${scopePrefix(ownerScope(ownerId))}/items/${safeId(id)}/${kind}${['source', 'upload'].includes(kind) ? '.bin' : '.json'}`;
}
function deviceKey(scope, id, revoked = false) {
  return `${scopePrefix(scope)}/devices/${safeId(id)}${revoked ? '.revoked' : ''}.json`;
}

function createOssInboxStore({ req, env = process.env, client, signingClient } = {}) {
  const credentials = resolveCredentials(req, env);
  if (!client && (!credentials.accessKeyId || !credentials.accessKeySecret)) throw new StoreError(503, 'OSS_CREDENTIALS_MISSING');
  const shared = { ...credentials, bucket: env.SHINE_OSS_BUCKET || 'shine-private-studio-nick', region: env.SHINE_OSS_REGION || 'oss-cn-hangzhou', secure: true, authorizationV4: true };
  const oss = client || new OSS({ ...shared, endpoint: env.SHINE_OSS_ENDPOINT || 'https://oss-cn-hangzhou-internal.aliyuncs.com' });
  const signer = signingClient || (client?.signatureUrl ? client : new OSS({ ...shared, endpoint: env.SHINE_OSS_PUBLIC_ENDPOINT || 'https://oss-cn-hangzhou.aliyuncs.com' }));

  async function getJson(key) {
    try { return JSON.parse(Buffer.from((await oss.get(key)).content).toString('utf8')); }
    catch (error) { if (missing(error)) return null; throw new StoreError(502, error instanceof SyntaxError ? 'INBOX_METADATA_INVALID' : 'OSS_READ_FAILED', error); }
  }
  async function createJson(key, data) {
    try { await oss.put(key, Buffer.from(JSON.stringify(data)), { mime: 'application/json; charset=utf-8', headers: { 'x-oss-forbid-overwrite': 'true' } }); return data; }
    catch (error) { if (conflict(error)) { const existing = await getJson(key); if (existing) return existing; } throw new StoreError(502, 'OSS_WRITE_FAILED', error); }
  }
  async function listKeys(prefix, filter) {
    const keys = [], seenMarkers = new Set(); let marker;
    do {
      let page;
      try { page = await oss.list({ prefix, 'max-keys': 1000, ...(marker ? { marker } : {}) }); }
      catch (error) { throw new StoreError(502, 'OSS_READ_FAILED', error); }
      for (const item of page.objects || []) if (typeof item.name === 'string' && item.name.startsWith(prefix) && filter(item.name)) keys.push(item.name);
      if (keys.length > 10000) throw new StoreError(502, 'INBOX_LIST_LIMIT');
      marker = page.nextMarker;
      if (marker && seenMarkers.has(marker)) throw new StoreError(502, 'INBOX_LIST_INVALID');
      if (marker) seenMarkers.add(marker);
    } while (marker);
    return keys;
  }
  async function removeKey(key) {
    try { await oss.delete(key); } catch (error) { if (!missing(error)) throw new StoreError(502, 'OSS_DELETE_FAILED', error); }
  }
  function sign(key, method, seconds, mime) {
    try { return signer.signatureUrl(key, { method, expires: seconds, ...(mime ? { 'Content-Type': mime } : {}) }); }
    catch (error) { throw new StoreError(502, 'OSS_SIGN_FAILED', error); }
  }
  async function getItem(ownerId, id) {
    const keys = ['record', 'completed', 'received', 'deleted'].map(kind => inboxObjectKey(ownerId, id, kind));
    const [record, completed, received, deleted] = await Promise.all(keys.map(getJson));
    if (!record) return null;
    if (record.ownerId !== ownerId || record.id !== id) throw new StoreError(502, 'INBOX_METADATA_INVALID');
    // Immutable markers prevent completion retries from reverting RECEIVED or DELETED.
    return { ...record, ...(completed || {}), ...(received || {}), ...(deleted || {}), status: deleted ? deleted.status : received ? 'RECEIVED' : completed ? 'READY' : 'UPLOADING' };
  }
  async function listItems(ownerId) {
    const prefix = `${scopePrefix(ownerScope(ownerId))}/items/`;
    const keys = await listKeys(prefix, key => /\/[a-f0-9-]{36}\/record\.json$/.test(key));
    const rows = [];
    // Bound concurrent reads: iPad uploads must not trigger hundreds of requests at once.
    for (let offset = 0; offset < keys.length; offset += 8) {
      rows.push(...await Promise.all(keys.slice(offset, offset + 8).map(key => getItem(ownerId, key.slice(prefix.length).split('/')[0]))));
    }
    return rows.filter(Boolean);
  }
  async function createItem(ownerId, item) {
    if (item.ownerId !== ownerId) throw new StoreError(400, 'INVALID_INBOX_OWNER');
    await createJson(inboxObjectKey(ownerId, item.id, 'record'), item);
    return getItem(ownerId, item.id);
  }
  async function createUploadTicket(ownerId, item, expiresSeconds) {
    const objectKey = inboxObjectKey(ownerId, item.id, 'upload');
    return { objectKey, uploadUrl: sign(objectKey, 'PUT', expiresSeconds, item.contentType), uploadHeaders: { 'Content-Type': item.contentType } };
  }
  async function headKey(key) {
    try {
      const response = await oss.head(key), headers = response?.res?.headers || {};
      const size = Number(headers['content-length']);
      return { objectKey: key, size: Number.isSafeInteger(size) ? size : null, contentType: String(headers['content-type'] || '').split(';')[0].toLowerCase(), etag: String(headers.etag || response?.etag || '') };
    } catch (error) { if (missing(error)) return null; throw new StoreError(502, 'OSS_READ_FAILED', error); }
  }
  async function inspectUpload(ownerId, id) {
    const head = await headKey(inboxObjectKey(ownerId, id, 'upload')); if (!head) return null;
    if (!head.etag) throw new StoreError(409, 'INBOX_UPLOAD_UNVERIFIABLE');
    try {
      const result = await oss.get(head.objectKey, { headers: { Range: 'bytes=0-7', 'If-Match': head.etag } });
      return { ...head, magic: Buffer.from(result.content).subarray(0, 8) };
    } catch (error) { if (error?.status === 412) throw new StoreError(409, 'INBOX_UPLOAD_CHANGED'); throw new StoreError(502, 'OSS_READ_FAILED', error); }
  }
  async function finalizeSource(ownerId, id, upload) {
    const key = inboxObjectKey(ownerId, id, 'source');
    try {
      // Copy condition pins the inspected bytes; forbid-overwrite makes the final source immutable.
      await oss.copy(key, inboxObjectKey(ownerId, id, 'upload'), { headers: { 'If-Match': upload.etag, 'x-oss-forbid-overwrite': 'true' } });
    } catch (error) {
      if (!conflict(error)) throw new StoreError(502, 'OSS_WRITE_FAILED', error);
      const existing = await headKey(key);
      if (!existing || existing.etag !== upload.etag || existing.size !== upload.size) throw new StoreError(409, 'INBOX_UPLOAD_CHANGED');
    }
    const final = await headKey(key);
    if (!final || final.size !== upload.size || final.etag !== upload.etag) throw new StoreError(409, 'INBOX_UPLOAD_CHANGED');
    return final;
  }
  async function markComplete(ownerId, id, value) { await createJson(inboxObjectKey(ownerId, id, 'completed'), value); return getItem(ownerId, id); }
  async function markReceived(ownerId, id, value) { await createJson(inboxObjectKey(ownerId, id, 'received'), value); return getItem(ownerId, id); }
  async function deleteItem(ownerId, id, timestamp, status = 'DELETED') {
    await createJson(inboxObjectKey(ownerId, id, 'deleted'), { status, deletedAt: timestamp });
    await Promise.all(['source', 'upload'].map(kind => removeKey(inboxObjectKey(ownerId, id, kind))));
    // Keep private small idempotency tombstones, never a recoverable PSD/PNG file.
    return true;
  }
  function createDownloadTicket(ownerId, id, expiresSeconds) { return { downloadUrl: sign(inboxObjectKey(ownerId, id, 'source'), 'GET', expiresSeconds) }; }
  async function createDevice(ownerId, device) { return createJson(deviceKey(ownerScope(ownerId), device.id), device); }
  async function getDeviceByScope(scope, id) {
    const [record, revoked] = await Promise.all([getJson(deviceKey(scope, id)), getJson(deviceKey(scope, id, true))]);
    return record ? { ...record, ...(revoked || {}) } : null;
  }
  async function listDevices(ownerId) {
    const scope = ownerScope(ownerId), prefix = `${scopePrefix(scope)}/devices/`;
    const keys = await listKeys(prefix, key => /^[a-f0-9-]{36}\.json$/.test(key.slice(prefix.length)));
    return Promise.all(keys.map(key => getDeviceByScope(scope, key.slice(prefix.length, -5))));
  }
  async function revokeDevice(ownerId, id, revokedAt) { await createJson(deviceKey(ownerScope(ownerId), id, true), { revokedAt }); }
  return { getItem, listItems, createItem, createUploadTicket, inspectUpload, finalizeSource, markComplete, markReceived, deleteItem, createDownloadTicket, createDevice, getDeviceByScope, listDevices, revokeDevice };
}

module.exports = { createOssInboxStore, inboxObjectKey, ownerScope };
