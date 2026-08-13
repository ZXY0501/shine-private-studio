const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assetMetadataObjectKey,
  assetSourceObjectKey,
  createOssAssetStore
} = require('../src/oss-asset-store');

const ASSET_ID = '123e4567-e89b-12d3-a456-426614174000';

test('uses fixed opaque object keys for asset PSD and metadata', () => {
  assert.equal(assetSourceObjectKey(ASSET_ID), `assets/v2/${ASSET_ID}/source.psd`);
  assert.equal(assetMetadataObjectKey(ASSET_ID), `asset-metadata/v2/${ASSET_ID}.json`);
});

test('signs source URLs and stores only server-chosen asset paths', async () => {
  const objects = new Map();
  const signed = [];
  const deleted = [];
  const listed = [];
  objects.set(assetSourceObjectKey(ASSET_ID), Buffer.alloc(4096));
  const client = {
    signatureUrl(key, options) {
      signed.push({ key, options });
      return `https://signed.example/${key}?method=${options.method}`;
    },
    async head(key) {
      if (!objects.has(key)) throw Object.assign(new Error('missing'), { status: 404, code: 'NoSuchKey' });
      return { res: { headers: { 'content-length': String(objects.get(key).length) } } };
    },
    async put(key, content) {
      objects.set(key, Buffer.from(content));
    },
    async get(key) {
      if (!objects.has(key)) throw Object.assign(new Error('missing'), { status: 404, code: 'NoSuchKey' });
      return { content: objects.get(key) };
    },
    async list(query) {
      listed.push(query);
      const { prefix } = query;
      return { objects: [...objects.keys()].filter(name => name.startsWith(prefix)).map(name => ({ name })) };
    },
    async delete(key) {
      deleted.push(key);
      objects.delete(key);
    }
  };
  const store = createOssAssetStore({ client, env: {} });

  const upload = await store.createUploadTicket(ASSET_ID, { mime: 'application/octet-stream', expiresSeconds: 900 });
  assert.equal(upload.objectKey, assetSourceObjectKey(ASSET_ID));
  assert.equal(signed[0].options.method, 'PUT');
  assert.equal(signed[0].options.expires, 900);
  assert.equal(signed[0].options['Content-Type'], 'application/octet-stream');

  const head = await store.headSource(ASSET_ID);
  assert.equal(head.size, 4096);

  const metadata = { schemaVersion: 'shine-asset-v2', assetId: ASSET_ID, sourceObjectKey: upload.objectKey };
  await store.putMetadata(ASSET_ID, metadata);
  assert.deepEqual(await store.getMetadata(ASSET_ID), metadata);
  assert.deepEqual(await store.listMetadata(), [metadata]);
  assert.equal(Object.prototype.hasOwnProperty.call(listed[0], 'marker'), false);

  const download = await store.createDownloadTicket(ASSET_ID, 600);
  assert.equal(download.metadata.assetId, ASSET_ID);
  assert.equal(signed.at(-1).options.method, 'GET');

  await store.remove(ASSET_ID);
  assert.deepEqual(deleted, [assetSourceObjectKey(ASSET_ID), assetMetadataObjectKey(ASSET_ID)]);
});
