const OSS = require('ali-oss');
const { StoreError, resolveCredentials } = require('./oss-profile-store');

function cleanPrefix(value, fallback) {
  return String(value || fallback).replace(/^\/+|\/+$/g, '');
}

function assetSourceObjectKey(assetId, prefix = 'assets/v2') {
  return `${cleanPrefix(prefix, 'assets/v2')}/${assetId}/source.psd`;
}

function assetMetadataObjectKey(assetId, prefix = 'asset-metadata/v2') {
  return `${cleanPrefix(prefix, 'asset-metadata/v2')}/${assetId}.json`;
}

function isMissingObject(error) {
  return error?.status === 404 || ['NoSuchKey', 'NoSuchObject'].includes(error?.code);
}

function objectSize(result) {
  const raw = result?.res?.headers?.['content-length'] ?? result?.meta?.contentLength ?? result?.size;
  const size = Number(raw);
  return Number.isFinite(size) ? size : null;
}

function createOssAssetStore({ req, env = process.env, client, signingClient } = {}) {
  const credentials = resolveCredentials(req, env);
  if (!client && (!credentials.accessKeyId || !credentials.accessKeySecret)) {
    throw new StoreError(503, 'OSS_CREDENTIALS_MISSING');
  }

  const bucket = env.SHINE_OSS_BUCKET || 'shine-private-studio-nick';
  const region = env.SHINE_OSS_REGION || 'oss-cn-hangzhou';
  const endpoint = env.SHINE_OSS_ENDPOINT || 'https://oss-cn-hangzhou-internal.aliyuncs.com';
  const publicEndpoint = env.SHINE_OSS_PUBLIC_ENDPOINT || 'https://oss-cn-hangzhou.aliyuncs.com';
  const sourcePrefix = env.SHINE_ASSET_PREFIX || 'assets/v2';
  const metadataPrefix = env.SHINE_ASSET_METADATA_PREFIX || 'asset-metadata/v2';
  const shared = { ...credentials, bucket, region, secure: true, authorizationV4: true };
  const oss = client || new OSS({ ...shared, endpoint });
  const signer = signingClient || (client && typeof client.signatureUrl === 'function'
    ? client
    : new OSS({ ...shared, endpoint: publicEndpoint }));

  function signedUrl(key, method, expiresSeconds, mime) {
    try {
      const options = { method, expires: expiresSeconds };
      if (mime) options['Content-Type'] = mime;
      return signer.signatureUrl(key, options);
    } catch (error) {
      throw new StoreError(502, 'OSS_SIGN_FAILED', error);
    }
  }

  async function createUploadTicket(assetId, { mime, expiresSeconds }) {
    const objectKey = assetSourceObjectKey(assetId, sourcePrefix);
    return {
      objectKey,
      uploadUrl: signedUrl(objectKey, 'PUT', expiresSeconds, mime)
    };
  }

  async function headSource(assetId) {
    const objectKey = assetSourceObjectKey(assetId, sourcePrefix);
    try {
      const result = await oss.head(objectKey);
      return { objectKey, size: objectSize(result) };
    } catch (error) {
      if (isMissingObject(error)) return null;
      throw new StoreError(502, 'OSS_READ_FAILED', error);
    }
  }

  async function putMetadata(assetId, metadata) {
    const key = assetMetadataObjectKey(assetId, metadataPrefix);
    try {
      await oss.put(key, Buffer.from(JSON.stringify(metadata)), { mime: 'application/json; charset=utf-8' });
      return metadata;
    } catch (error) {
      throw new StoreError(502, 'OSS_WRITE_FAILED', error);
    }
  }

  async function getMetadata(assetId) {
    const key = assetMetadataObjectKey(assetId, metadataPrefix);
    try {
      const result = await oss.get(key);
      return JSON.parse(Buffer.from(result.content).toString('utf8'));
    } catch (error) {
      if (isMissingObject(error)) return null;
      if (error instanceof SyntaxError) throw new StoreError(502, 'ASSET_METADATA_INVALID', error);
      throw new StoreError(502, 'OSS_READ_FAILED', error);
    }
  }

  async function listMetadata() {
    const prefix = `${cleanPrefix(metadataPrefix, 'asset-metadata/v2')}/`;
    const records = [];
    let marker;
    try {
      do {
        // Do not pass an undefined marker. The SDK omits undefined values when
        // calculating the V4 canonical query, while the URL formatter can emit
        // `marker=`, producing SignatureDoesNotMatch on the first page.
        const query = { prefix, 'max-keys': 1000 };
        if (marker) query.marker = marker;
        const page = await oss.list(query);
        for (const object of page.objects || []) {
          if (!object.name.endsWith('.json')) continue;
          const result = await oss.get(object.name);
          records.push(JSON.parse(Buffer.from(result.content).toString('utf8')));
        }
        marker = page.nextMarker;
      } while (marker);
      return records;
    } catch (error) {
      if (error instanceof SyntaxError) throw new StoreError(502, 'ASSET_METADATA_INVALID', error);
      const wrapped = new StoreError(502, 'OSS_READ_FAILED', error);
      wrapped.ossCode = error?.code || null;
      wrapped.ossStatus = error?.status || error?.statusCode || null;
      wrapped.ossRequestId = error?.requestId || error?.request_id || null;
      throw wrapped;
    }
  }

  async function createDownloadTicket(assetId, expiresSeconds) {
    const metadata = await getMetadata(assetId);
    if (!metadata) return null;
    const objectKey = assetSourceObjectKey(assetId, sourcePrefix);
    return { metadata, objectKey, downloadUrl: signedUrl(objectKey, 'GET', expiresSeconds) };
  }

  async function remove(assetId) {
    const sourceKey = assetSourceObjectKey(assetId, sourcePrefix);
    const metadataKey = assetMetadataObjectKey(assetId, metadataPrefix);
    try {
      await oss.delete(sourceKey);
      await oss.delete(metadataKey);
    } catch (error) {
      if (!isMissingObject(error)) throw new StoreError(502, 'OSS_DELETE_FAILED', error);
    }
  }

  return { createUploadTicket, headSource, putMetadata, getMetadata, listMetadata, createDownloadTicket, remove };
}

module.exports = {
  assetMetadataObjectKey,
  assetSourceObjectKey,
  createOssAssetStore
};
