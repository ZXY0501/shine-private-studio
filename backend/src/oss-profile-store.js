const crypto = require('crypto');
const OSS = require('ali-oss');

class StoreError extends Error {
  constructor(status, code, cause) {
    super(code, cause ? { cause } : undefined);
    this.name = 'StoreError';
    this.status = status;
    this.code = code;
  }
}

function profileEtag(profile) {
  const digest = crypto.createHash('sha256').update(JSON.stringify(profile)).digest('hex');
  return `"${digest}"`;
}

function profileObjectKey(signature, prefix = 'template-profiles/v1') {
  const digest = crypto.createHash('sha256').update(signature).digest('hex');
  return `${String(prefix).replace(/^\/+|\/+$/g, '')}/${digest}.json`;
}

function requestHeader(req, name) {
  return String(req?.headers?.[name.toLowerCase()] || '');
}

function resolveCredentials(req, env) {
  return {
    accessKeyId: env.ALIBABA_CLOUD_ACCESS_KEY_ID || requestHeader(req, 'x-fc-access-key-id'),
    accessKeySecret: env.ALIBABA_CLOUD_ACCESS_KEY_SECRET || requestHeader(req, 'x-fc-access-key-secret'),
    stsToken: env.ALIBABA_CLOUD_SECURITY_TOKEN || requestHeader(req, 'x-fc-security-token')
  };
}

function isMissingObject(error) {
  return error?.status === 404 || ['NoSuchKey', 'NoSuchObject'].includes(error?.code);
}

function isCreateConflict(error) {
  return error?.status === 409 || ['FileAlreadyExists', 'ObjectAlreadyExists'].includes(error?.code);
}

function createOssProfileStore({ req, env = process.env, client } = {}) {
  const credentials = resolveCredentials(req, env);
  if (!client && (!credentials.accessKeyId || !credentials.accessKeySecret)) {
    throw new StoreError(503, 'OSS_CREDENTIALS_MISSING');
  }

  const bucket = env.SHINE_OSS_BUCKET || 'shine-private-studio-nick';
  const region = env.SHINE_OSS_REGION || 'oss-cn-hangzhou';
  const endpoint = env.SHINE_OSS_ENDPOINT || 'https://oss-cn-hangzhou-internal.aliyuncs.com';
  const prefix = env.SHINE_PROFILE_PREFIX || 'template-profiles/v1';
  const oss = client || new OSS({
    ...credentials,
    bucket,
    region,
    endpoint,
    secure: true,
    authorizationV4: true
  });

  async function get(signature) {
    const key = profileObjectKey(signature, prefix);
    try {
      const result = await oss.get(key);
      const profile = JSON.parse(Buffer.from(result.content).toString('utf8'));
      return { profile, etag: profileEtag(profile) };
    } catch (error) {
      if (isMissingObject(error)) return null;
      if (error instanceof SyntaxError) throw new StoreError(502, 'PROFILE_OBJECT_INVALID', error);
      throw new StoreError(502, 'OSS_READ_FAILED', error);
    }
  }

  async function create(signature, profile) {
    const key = profileObjectKey(signature, prefix);
    try {
      await oss.put(key, Buffer.from(JSON.stringify(profile)), {
        mime: 'application/json; charset=utf-8',
        headers: { 'x-oss-forbid-overwrite': 'true' }
      });
      return { profile, etag: profileEtag(profile) };
    } catch (error) {
      if (isCreateConflict(error)) throw new StoreError(412, 'PROFILE_CONFLICT', error);
      throw new StoreError(502, 'OSS_WRITE_FAILED', error);
    }
  }

  async function update(signature, profile, expectedEtag) {
    // OSS PutObject has no atomic If-Match update in this adapter. Re-check as
    // close to the write as possible; the API documents this single-writer limit.
    const current = await get(signature);
    if (!current || current.etag !== expectedEtag) {
      throw new StoreError(412, 'PROFILE_CONFLICT');
    }
    const key = profileObjectKey(signature, prefix);
    try {
      await oss.put(key, Buffer.from(JSON.stringify(profile)), {
        mime: 'application/json; charset=utf-8'
      });
      return { profile, etag: profileEtag(profile) };
    } catch (error) {
      throw new StoreError(502, 'OSS_WRITE_FAILED', error);
    }
  }

  return { get, create, update };
}

module.exports = {
  StoreError,
  createOssProfileStore,
  profileEtag,
  profileObjectKey,
  resolveCredentials
};
