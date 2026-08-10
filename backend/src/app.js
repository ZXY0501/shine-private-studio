const crypto = require('crypto');

const PROFILE_PATH_PREFIX = '/api/template-profiles/';
const PROFILE_SCHEMA_VERSION = 'shine-template-0.28-alpha';
const DEFAULT_MAX_BODY_BYTES = 512 * 1024;
const SLOT_OPTIONS = new Set(['NONE', 'A', 'B', 'SHARED']);
const PART_OPTIONS = new Set(['UNKNOWN', 'HAIR', 'EYE', 'OUTFIT', 'HAT', 'HAT_DECOR', 'BODY_TRAIT', 'TAIL', 'FACE', 'WATERMARK', 'BACKGROUND', 'RENDER_SLOT', 'REFERENCE', 'OTHER']);
const ROLE_OPTIONS = new Set([
  'UNKNOWN', 'FIXED', 'REFERENCE', 'BACKGROUND_BASE', 'BACKGROUND_LACE_FIXED',
  'HAIR_BASE', 'HAIR_SHADE_MASK', 'HAIR_OUTLINE', 'HAIR_HIGHLIGHT_FIXED', 'HAIR_SKIN_AIR_FIXED', 'BROW_BASE',
  'EYE_IRIS_BASE', 'EYE_DARK', 'EYE_PUPIL', 'EYE_HIGHLIGHT', 'EYE_OUTLINE', 'LASH_FIXED', 'LASH_HIGHLIGHT', 'PUPIL_HIGHLIGHT_FIXED',
  'OUTFIT_BASE', 'OUTFIT_LINE', 'HAT_BASE', 'HAT_OUTLINE', 'HAT_TRIM_EDGE', 'HAT_FUR_FIXED',
  'DECOR_CONTAINER', 'DECOR_BASE', 'DECOR_OUTLINE', 'DECOR_INNER', 'DECOR_FUR', 'DECOR_SHADOW', 'DECOR_ACCENT',
  'BODY_TRAIT_BASE', 'BODY_TRAIT_OUTLINE', 'BODY_TRAIT_INNER', 'BODY_TRAIT_ACCENT',
  'WATERMARK_PREVIEW', 'RENDER_SLOT_HAIR', 'RENDER_SLOT_HAT_DECOR', 'RENDER_SLOT_TAIL', 'RENDER_SLOT_PROP_FRONT', 'RENDER_SLOT_PROP_BACK',
  'TAIL_BASE', 'TAIL_OUTLINE', 'TAIL_TIP', 'FACE_FIXED', 'GROUP', 'OTHER'
]);
const SOURCE_OPTIONS = new Set(['AUTO', 'NONE', 'FIXED', 'PRESET', 'MANUAL_ANCHOR', 'DERIVED', 'OVERRIDE']);

class HttpError extends Error {
  constructor(status, code, message = code) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

function corsHeaders(req, allowedOrigin) {
  const origin = req.headers.origin || '';
  const allowOrigin = allowedOrigin === '*' ? '*' : (origin === allowedOrigin ? origin : allowedOrigin);
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,If-Match,If-None-Match',
    'Access-Control-Expose-Headers': 'ETag',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin'
  };
}

function sendJson(req, res, status, body, allowedOrigin, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders(req, allowedOrigin),
    ...extraHeaders
  });
  res.end(JSON.stringify(body));
}

function secureTokenMatches(received, expected) {
  const left = crypto.createHash('sha256').update(String(received || '')).digest();
  const right = crypto.createHash('sha256').update(String(expected || '')).digest();
  return crypto.timingSafeEqual(left, right);
}

function authorizeProfileRequest(req, profileToken) {
  if (!profileToken) {
    throw new HttpError(503, 'PROFILE_AUTH_NOT_CONFIGURED');
  }

  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  if (!match || !secureTokenMatches(match[1], profileToken)) {
    throw new HttpError(401, 'UNAUTHORIZED');
  }
}

function parseTemplateSignature(pathname) {
  if (!pathname.startsWith(PROFILE_PATH_PREFIX)) return null;
  const encoded = pathname.slice(PROFILE_PATH_PREFIX.length);
  if (!encoded || encoded.includes('/')) throw new HttpError(400, 'INVALID_TEMPLATE_SIGNATURE');

  let signature;
  try {
    signature = decodeURIComponent(encoded);
  } catch {
    throw new HttpError(400, 'INVALID_TEMPLATE_SIGNATURE');
  }

  if (!/^[A-Za-z0-9._:-]{1,256}$/.test(signature)) {
    throw new HttpError(400, 'INVALID_TEMPLATE_SIGNATURE');
  }
  return signature;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateTemplateData(data, signature) {
  if (!isPlainObject(data)) throw new HttpError(400, 'INVALID_PROFILE_DATA');
  if (data.schemaVersion !== PROFILE_SCHEMA_VERSION) {
    throw new HttpError(400, 'UNSUPPORTED_PROFILE_SCHEMA');
  }
  if (!isPlainObject(data.template) || data.template.signature !== signature) {
    throw new HttpError(400, 'PROFILE_SIGNATURE_MISMATCH');
  }
  if (!isPlainObject(data.colorPolicy) || !Array.isArray(data.rootStackOrder) ||
      !isPlainObject(data.hairInsertion) || !isPlainObject(data.bindings)) {
    throw new HttpError(400, 'INVALID_PROFILE_DATA');
  }
  if (![data.colorPolicy.preset, data.colorPolicy.manualAnchor, data.colorPolicy.derived, data.colorPolicy.fixed]
    .every(items => Array.isArray(items) && items.every(item => typeof item === 'string'))) {
    throw new HttpError(400, 'INVALID_PROFILE_DATA');
  }
  if (data.rootStackOrder.length > 10000 || data.rootStackOrder.some(item => typeof item !== 'string' || item.length > 4096)) {
    throw new HttpError(400, 'INVALID_PROFILE_DATA');
  }
  if (!['A', 'B'].every(slot => isPlainObject(data.hairInsertion[slot]) &&
    typeof data.hairInsertion[slot].path === 'string' && data.hairInsertion[slot].path.length <= 4096 &&
    ['above', 'below'].includes(data.hairInsertion[slot].position))) {
    throw new HttpError(400, 'INVALID_PROFILE_DATA');
  }
  const bindings = Object.entries(data.bindings);
  if (bindings.length > 10000 || bindings.some(([path, binding]) =>
    !path || path.length > 4096 || !isPlainObject(binding) ||
    !SLOT_OPTIONS.has(binding.slot) || !PART_OPTIONS.has(binding.part) || !ROLE_OPTIONS.has(binding.role) ||
    !SOURCE_OPTIONS.has(binding.source) || typeof binding.locked !== 'boolean')) {
    throw new HttpError(400, 'INVALID_PROFILE_DATA');
  }
}

function validateStoredProfile(stored, signature) {
  try {
    if (!isPlainObject(stored) || stored.apiVersion !== 1 || stored.profileKey !== signature ||
        !Number.isInteger(stored.revision) || stored.revision < 1 ||
        typeof stored.createdAt !== 'string' || typeof stored.updatedAt !== 'string') {
      throw new Error('invalid profile envelope');
    }
    validateTemplateData(stored.data, signature);
  } catch {
    throw new HttpError(502, 'PROFILE_OBJECT_INVALID');
  }
}

async function readJsonBody(req, maxBodyBytes) {
  const declaredLength = Number(req.headers['content-length'] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    throw new HttpError(413, 'PROFILE_TOO_LARGE');
  }

  const chunks = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      tooLarge = true;
    } else if (!tooLarge) {
      chunks.push(chunk);
    }
  }
  if (tooLarge) throw new HttpError(413, 'PROFILE_TOO_LARGE');

  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!isPlainObject(parsed)) throw new Error('body must be an object');
    return parsed;
  } catch {
    throw new HttpError(400, 'INVALID_JSON');
  }
}

function etagMatches(headerValue, etag) {
  return String(headerValue || '').split(',').map(value => value.trim()).includes(etag);
}

function createProfileEnvelope(data, signature, current, now) {
  const timestamp = now().toISOString();
  return {
    apiVersion: 1,
    profileKey: signature,
    revision: current ? current.profile.revision + 1 : 1,
    createdAt: current ? current.profile.createdAt : timestamp,
    updatedAt: timestamp,
    data
  };
}

function createApp(options = {}) {
  const allowedOrigin = options.allowedOrigin ?? process.env.ALLOWED_ORIGIN ?? '*';
  const profileToken = options.profileToken ?? process.env.SHINE_PROFILE_TOKEN ?? '';
  const configuredMaxBodyBytes = Number(options.maxBodyBytes ?? process.env.PROFILE_MAX_BYTES ?? DEFAULT_MAX_BODY_BYTES);
  const maxBodyBytes = Number.isFinite(configuredMaxBodyBytes) && configuredMaxBodyBytes > 0
    ? configuredMaxBodyBytes
    : DEFAULT_MAX_BODY_BYTES;
  const storeFactory = options.storeFactory;
  const now = options.now || (() => new Date());
  const logger = options.logger || console;

  return async function app(req, res) {
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders(req, allowedOrigin));
        return res.end();
      }

      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

      // These two responses intentionally preserve the backend v0.1 contract.
      if (req.method === 'GET' && url.pathname === '/health') {
        return sendJson(req, res, 200, {
          ok: true,
          service: 'shine-backend',
          stage: 'phase-1-connectivity'
        }, allowedOrigin);
      }

      if (req.method === 'GET' && url.pathname === '/api/ping') {
        return sendJson(req, res, 200, {
          ok: true,
          message: 'Shine backend is connected.',
          time: now().toISOString()
        }, allowedOrigin);
      }

      const signature = parseTemplateSignature(url.pathname);
      if (signature === null || !['GET', 'PUT'].includes(req.method)) {
        return sendJson(req, res, 404, { ok: false, error: 'NOT_FOUND' }, allowedOrigin);
      }

      authorizeProfileRequest(req, profileToken);
      if (typeof storeFactory !== 'function') throw new HttpError(503, 'PROFILE_STORE_NOT_CONFIGURED');
      const store = await storeFactory(req);

      if (req.method === 'GET') {
        const stored = await store.get(signature);
        if (!stored) throw new HttpError(404, 'PROFILE_NOT_FOUND');
        validateStoredProfile(stored.profile, signature);
        return sendJson(req, res, 200, stored.profile, allowedOrigin, {
          ETag: stored.etag,
          'Cache-Control': 'no-store'
        });
      }

      const body = await readJsonBody(req, maxBodyBytes);
      validateTemplateData(body.data, signature);
      const current = await store.get(signature);
      if (current) validateStoredProfile(current.profile, signature);

      if (!current) {
        if (req.headers['if-none-match'] !== '*') {
          throw new HttpError(428, 'PRECONDITION_REQUIRED');
        }
        const profile = createProfileEnvelope(body.data, signature, null, now);
        const created = await store.create(signature, profile);
        return sendJson(req, res, 201, created.profile, allowedOrigin, {
          ETag: created.etag,
          'Cache-Control': 'no-store'
        });
      }

      const ifMatch = req.headers['if-match'];
      if (!ifMatch) throw new HttpError(428, 'PRECONDITION_REQUIRED');
      if (!etagMatches(ifMatch, current.etag)) throw new HttpError(412, 'PROFILE_CONFLICT');

      const profile = createProfileEnvelope(body.data, signature, current, now);
      const updated = await store.update(signature, profile, current.etag);
      return sendJson(req, res, 200, updated.profile, allowedOrigin, {
        ETag: updated.etag,
        'Cache-Control': 'no-store'
      });
    } catch (error) {
      const known = error instanceof HttpError || Number.isInteger(error.status);
      const status = known ? error.status : 502;
      const code = known ? (error.code || 'PROFILE_STORE_ERROR') : 'PROFILE_STORE_ERROR';
      if (status >= 500) {
        logger.error?.('Template profile request failed', {
          method: req.method,
          path: req.url?.split('?')[0],
          code
        });
      }
      return sendJson(req, res, status, { ok: false, error: code }, allowedOrigin);
    }
  };
}

module.exports = {
  HttpError,
  PROFILE_SCHEMA_VERSION,
  createApp,
  validateStoredProfile,
  validateTemplateData
};
