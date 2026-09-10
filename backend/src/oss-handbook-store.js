const crypto = require('crypto');
const OSS = require('ali-oss');
const { StoreError, resolveCredentials } = require('./oss-profile-store');

const DEFAULT_PREFIX = 'private-handbooks/v1';
const MAX_LIST_OBJECTS = 10000;

function handbookOwnerPrefix(owner, prefix = DEFAULT_PREFIX) {
  if (typeof owner !== 'string' || !owner || owner.length > 256) throw new StoreError(401, 'HANDBOOK_OWNER_REQUIRED');
  const digest = crypto.createHash('sha256').update(owner).digest('hex');
  return `${String(prefix || DEFAULT_PREFIX).replace(/^\/+|\/+$/g, '')}/${digest}`;
}

function revisionNumber(value) {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 1 || revision > 999999999999) {
    throw new StoreError(400, 'INVALID_HANDBOOK_REVISION');
  }
  return revision;
}

function handbookVersionKey(owner, revision, prefix) {
  return `${handbookOwnerPrefix(owner, prefix)}/versions/${String(revisionNumber(revision)).padStart(12, '0')}.json`;
}

function feedbackKey(owner, id, prefix) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new StoreError(400, 'INVALID_FEEDBACK_ID');
  return `${handbookOwnerPrefix(owner, prefix)}/feedback/${id}.json`;
}

function handbookEtag(record) {
  return `"${crypto.createHash('sha256').update(JSON.stringify(record)).digest('hex')}"`;
}

function missing(error) { return error?.status === 404 || ['NoSuchKey', 'NoSuchObject'].includes(error?.code); }
function conflict(error) { return [409, 412].includes(error?.status) || ['FileAlreadyExists', 'ObjectAlreadyExists', 'PreconditionFailed'].includes(error?.code); }

function createOssHandbookStore({ req, env = process.env, client, now = () => new Date() } = {}) {
  const credentials = resolveCredentials(req, env);
  if (!client && (!credentials.accessKeyId || !credentials.accessKeySecret)) throw new StoreError(503, 'OSS_CREDENTIALS_MISSING');
  const prefix = env.SHINE_HANDBOOK_PREFIX || DEFAULT_PREFIX;
  const oss = client || new OSS({
    ...credentials,
    bucket: env.SHINE_OSS_BUCKET || 'shine-private-studio-nick',
    region: env.SHINE_OSS_REGION || 'oss-cn-hangzhou',
    endpoint: env.SHINE_OSS_ENDPOINT || 'https://oss-cn-hangzhou-internal.aliyuncs.com',
    secure: true,
    authorizationV4: true
  });

  async function read(key) {
    try {
      const result = await oss.get(key);
      return JSON.parse(Buffer.from(result.content).toString('utf8'));
    } catch (error) {
      if (missing(error)) return null;
      throw new StoreError(502, error instanceof SyntaxError ? 'HANDBOOK_OBJECT_INVALID' : 'OSS_READ_FAILED', error);
    }
  }

  async function listKeys(objectPrefix) {
    const keys = [];
    const seenMarkers = new Set();
    let marker;
    try {
      do {
        const query = { prefix: objectPrefix, 'max-keys': 1000 };
        if (marker) query.marker = marker;
        const page = await oss.list(query);
        for (const object of page.objects || []) {
          if (typeof object.name === 'string' && object.name.startsWith(objectPrefix)) keys.push(object.name);
        }
        if (keys.length > MAX_LIST_OBJECTS) throw new StoreError(502, 'HANDBOOK_LIST_LIMIT');
        marker = page.nextMarker;
        if (marker && seenMarkers.has(marker)) throw new StoreError(502, 'HANDBOOK_LIST_INVALID');
        if (marker) seenMarkers.add(marker);
      } while (marker);
      return [...new Set(keys)];
    } catch (error) {
      if (error instanceof StoreError) throw error;
      throw new StoreError(502, 'OSS_READ_FAILED', error);
    }
  }

  async function versionNumbers(owner) {
    const objectPrefix = `${handbookOwnerPrefix(owner, prefix)}/versions/`;
    return (await listKeys(objectPrefix)).map(key => /^([0-9]{12})\.json$/.exec(key.slice(objectPrefix.length)))
      .filter(Boolean).map(match => revisionNumber(match[1])).sort((a, b) => b - a);
  }

  async function getVersion(owner, revision) {
    revision = revisionNumber(revision);
    const record = await read(handbookVersionKey(owner, revision, prefix));
    if (!record) return null;
    if (record.revision !== revision || typeof record.createdAt !== 'string' || !record.data ||
        typeof record.data !== 'object' || Array.isArray(record.data) || record.data.owner !== owner) {
      throw new StoreError(502, 'HANDBOOK_OBJECT_INVALID');
    }
    return { record, etag: handbookEtag(record) };
  }

  async function get(owner) {
    const revisions = await versionNumbers(owner);
    if (!revisions.length) return null;
    const current = await getVersion(owner, revisions[0]);
    if (!current) throw new StoreError(502, 'HANDBOOK_OBJECT_INVALID');
    return current;
  }

  async function commit(owner, data, { ifMatch, ifNoneMatch } = {}) {
    if ((ifMatch && ifNoneMatch) || (ifNoneMatch && ifNoneMatch !== '*')) throw new StoreError(400, 'INVALID_HANDBOOK_PRECONDITION');
    if (!ifMatch && !ifNoneMatch) throw new StoreError(428, 'HANDBOOK_PRECONDITION_REQUIRED');
    const current = await get(owner);
    if (current ? ifNoneMatch === '*' || ifMatch !== current.etag : ifNoneMatch !== '*') throw new StoreError(412, 'HANDBOOK_CONFLICT');
    const record = {
      revision: current ? current.record.revision + 1 : 1,
      createdAt: new Date(now()).toISOString(),
      data: JSON.parse(JSON.stringify({ ...data, owner }))
    };
    const key = handbookVersionKey(owner, record.revision, prefix);
    try {
      // A stale listing can only contend for an already-created revision. Never
      // retry that write at a newer revision: the user must reconcile the conflict.
      await oss.put(key, Buffer.from(JSON.stringify(record)), {
        mime: 'application/json; charset=utf-8',
        headers: { 'x-oss-forbid-overwrite': 'true' }
      });
      return { record, etag: handbookEtag(record) };
    } catch (error) {
      if (conflict(error)) throw new StoreError(412, 'HANDBOOK_CONFLICT', error);
      throw new StoreError(502, 'OSS_WRITE_FAILED', error);
    }
  }

  async function versions(owner) {
    const summaries = [];
    for (const revision of await versionNumbers(owner)) {
      const item = await getVersion(owner, revision);
      if (!item) throw new StoreError(502, 'HANDBOOK_OBJECT_INVALID');
      summaries.push({ revision, createdAt: item.record.createdAt, etag: item.etag });
    }
    return summaries;
  }

  async function createFeedback(owner, data) {
    if (typeof data?.id !== 'string' || !data.id || data.id.length > 160) throw new StoreError(400, 'INVALID_FEEDBACK_ID');
    // Retries of one finalized event cannot count as multiple aesthetic votes.
    const id = crypto.createHash('sha256').update(data.id).digest('hex');
    const key = feedbackKey(owner, id, prefix);
    const withdrawnKey = `${handbookOwnerPrefix(owner, prefix)}/withdrawn-feedback/${id}.json`;
    if (await read(withdrawnKey)) throw new StoreError(410, 'FEEDBACK_WITHDRAWN');
    const record = { id, createdAt: new Date(now()).toISOString(), data: JSON.parse(JSON.stringify(data)) };
    try {
      await oss.put(key, Buffer.from(JSON.stringify(record)), {
        mime: 'application/json; charset=utf-8',
        headers: { 'x-oss-forbid-overwrite': 'true' }
      });
    } catch (error) {
      if (conflict(error)) {
        const existing = await read(key);
        if (!existing || JSON.stringify(existing.data) !== JSON.stringify(record.data)) throw new StoreError(409, 'FEEDBACK_CONFLICT', error);
        if (await read(withdrawnKey)) throw new StoreError(410, 'FEEDBACK_WITHDRAWN');
        return existing;
      }
      throw new StoreError(502, 'OSS_WRITE_FAILED', error);
    }
    // The withdrawal marker always wins over a simultaneous submission.
    if (await read(withdrawnKey)) {
      try { await oss.delete(key); } catch { /* Hidden permanently; cleanup can retry. */ }
      throw new StoreError(410, 'FEEDBACK_WITHDRAWN');
    }
    return record;
  }

  async function listFeedback(owner) {
    const objectPrefix = `${handbookOwnerPrefix(owner, prefix)}/feedback/`;
    const records = [];
    for (const key of await listKeys(objectPrefix)) {
      const match = /^([a-zA-Z0-9_-]{1,128})\.json$/.exec(key.slice(objectPrefix.length));
      if (!match) continue;
      const record = await read(key);
      if (!record) continue; // A concurrent withdrawal is not an invalid list.
      if (await read(`${handbookOwnerPrefix(owner, prefix)}/withdrawn-feedback/${match[1]}.json`)) continue;
      if (record.id !== match[1] || typeof record.createdAt !== 'string' || !record.data || typeof record.data !== 'object') {
        throw new StoreError(502, 'HANDBOOK_OBJECT_INVALID');
      }
      records.push(record);
    }
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  }

  async function deleteFeedback(owner, id) {
    const key = feedbackKey(owner, id, prefix);
    const withdrawnKey = `${handbookOwnerPrefix(owner, prefix)}/withdrawn-feedback/${id}.json`;
    if (!await read(key) && !await read(withdrawnKey)) return false;
    try {
      try {
        // Only an opaque event ID and timestamp survive, never its colors or notes.
        await oss.put(withdrawnKey, Buffer.from(JSON.stringify({ id, withdrawnAt: new Date(now()).toISOString() })), {
          mime: 'application/json; charset=utf-8', headers: { 'x-oss-forbid-overwrite': 'true' }
        });
      } catch (error) { if (!conflict(error)) throw error; }
      await oss.delete(key);
      return true;
    }
    catch (error) {
      if (missing(error)) return false;
      throw new StoreError(502, 'OSS_DELETE_FAILED', error);
    }
  }

  return { get, getVersion, versions, commit, createFeedback, listFeedback, deleteFeedback };
}

module.exports = { createOssHandbookStore, handbookOwnerPrefix, handbookVersionKey, handbookEtag, feedbackKey };
