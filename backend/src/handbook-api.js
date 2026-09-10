const { StoreError } = require('./oss-profile-store');

function loadValidators() {
  // Deployment bundles keep the same shared validator beside server.js.
  try { return require('../color-handbook'); }
  catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND' || !error.message.includes("'../color-handbook'")) throw error;
    return require('../../color-handbook');
  }
}

function isHandbookPath(pathname) {
  return pathname === '/api/handbook' || pathname.startsWith('/api/handbook/');
}

function ownerFromAuth(auth) {
  const owner = auth?.sub || auth?.accountId;
  if (typeof owner !== 'string' || !owner || owner.length > 256) throw new StoreError(401, 'HANDBOOK_OWNER_REQUIRED');
  return owner;
}

function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

function validated(validator, input, code) {
  const result = validator(input);
  if (!result?.valid || !result.value) throw new StoreError(400, code);
  return result.value;
}

function createHandbookApi({ storeFactory, readJsonBody, sendJson, allowedOrigin = '*', validateHandbook, validateFeedback } = {}) {
  async function handle(req, res, url, auth) {
    const pathname = url.pathname;
    if (!isHandbookPath(pathname)) return false;
    const owner = ownerFromAuth(auth);
    if (typeof storeFactory !== 'function') throw new StoreError(503, 'HANDBOOK_STORE_NOT_CONFIGURED');
    const store = await storeFactory(req);
    const reply = (status, body, headers = {}) => {
      sendJson(req, res, status, body, allowedOrigin, { 'Cache-Control': 'no-store', ...headers });
      return true;
    };
    const bodyData = async (maxBytes, code) => {
      const body = await readJsonBody(req, maxBytes, 'HANDBOOK_REQUEST_TOO_LARGE');
      if (!plain(body) || Object.keys(body).some(key => key !== 'data') || !plain(body.data)) throw new StoreError(400, code);
      return body.data;
    };

    if (pathname === '/api/handbook' || pathname === '/api/handbook/export') {
      if (req.method === 'GET') {
        const current = await store.get(owner);
        if (!current) throw new StoreError(404, 'HANDBOOK_NOT_FOUND');
        return reply(200, current.record, { ETag: current.etag });
      }
      if (pathname === '/api/handbook' && req.method === 'PUT') {
        const ifMatch = String(req.headers['if-match'] || '');
        const ifNoneMatch = String(req.headers['if-none-match'] || '');
        if (!ifMatch && !ifNoneMatch) throw new StoreError(428, 'HANDBOOK_PRECONDITION_REQUIRED');
        if ((ifMatch && ifNoneMatch) || (ifNoneMatch && ifNoneMatch !== '*')) throw new StoreError(400, 'INVALID_HANDBOOK_PRECONDITION');
        const data = await bodyData(1024 * 1024, 'INVALID_HANDBOOK');
        // Client-provided ownership cannot select or impersonate another account.
        const book = validated(validateHandbook || loadValidators().validateHandbook, { ...data, owner }, 'INVALID_HANDBOOK');
        const saved = await store.commit(owner, book, { ifMatch, ifNoneMatch });
        return reply(ifNoneMatch ? 201 : 200, saved.record, { ETag: saved.etag });
      }
      throw new StoreError(405, 'METHOD_NOT_ALLOWED');
    }

    if (pathname === '/api/handbook/versions') {
      if (req.method !== 'GET') throw new StoreError(405, 'METHOD_NOT_ALLOWED');
      return reply(200, { versions: await store.versions(owner) });
    }

    const version = /^\/api\/handbook\/versions\/([1-9][0-9]{0,11})$/.exec(pathname);
    if (version) {
      if (req.method !== 'GET') throw new StoreError(405, 'METHOD_NOT_ALLOWED');
      const item = await store.getVersion(owner, Number(version[1]));
      if (!item) throw new StoreError(404, 'HANDBOOK_VERSION_NOT_FOUND');
      return reply(200, item.record, { ETag: item.etag });
    }

    if (pathname === '/api/handbook/feedback') {
      if (req.method === 'GET') return reply(200, { feedback: await store.listFeedback(owner) });
      if (req.method === 'POST') {
        const data = await bodyData(64 * 1024, 'INVALID_HANDBOOK_FEEDBACK');
        const feedback = validated(validateFeedback || loadValidators().validateFeedback, data, 'INVALID_HANDBOOK_FEEDBACK');
        if (!feedback.confirmed || !feedback.learningEligible || feedback.reason === 'CUSTOMER_OVERRIDE') {
          throw new StoreError(422, 'FEEDBACK_NOT_LEARNING_ELIGIBLE');
        }
        return reply(201, await store.createFeedback(owner, feedback));
      }
      throw new StoreError(405, 'METHOD_NOT_ALLOWED');
    }

    const feedback = /^\/api\/handbook\/feedback\/([a-zA-Z0-9_-]{1,128})$/.exec(pathname);
    if (feedback) {
      if (req.method !== 'DELETE') throw new StoreError(405, 'METHOD_NOT_ALLOWED');
      if (!await store.deleteFeedback(owner, feedback[1])) throw new StoreError(404, 'FEEDBACK_NOT_FOUND');
      return reply(200, { deleted: true });
    }
    throw new StoreError(404, 'NOT_FOUND');
  }
  return handle;
}

module.exports = { createHandbookApi, isHandbookPath, ownerFromAuth };
