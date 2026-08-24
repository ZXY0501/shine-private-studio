const crypto = require('crypto');
const { createDeepSeekOrderParser, validateDeepSeekRequest } = require('./deepseek-order-parser');
const {
  createAccountRecord,
  publicAccount,
  readSession,
  signSession,
  validateUsername,
  verifyAccountPassword
} = require('./account-auth');

const PROFILE_PATH_PREFIX = '/api/template-profiles/';
const ASSET_PATH_PREFIX = '/api/assets';
const DEEPSEEK_PATH = '/api/deepseek/parse';
const AUTH_LOGIN_PATH = '/api/auth/login';
const AUTH_ME_PATH = '/api/auth/me';
const ACCOUNTS_PATH = '/api/accounts';
const PROFILE_SCHEMA_VERSION = 'shine-template-0.28-alpha';
const DEFAULT_MAX_BODY_BYTES = 512 * 1024;
const DEFAULT_MAX_DEEPSEEK_BODY_BYTES = 64 * 1024;
const DEFAULT_MAX_ASSET_BYTES = 200 * 1024 * 1024;
const DEFAULT_ASSET_TICKET_SECONDS = 15 * 60;
const ASSET_CATEGORIES = new Set(['CLEAN_TEMPLATE', 'CLOTHING', 'REUSABLE_HAIR', 'EAR', 'MOUTH', 'EYE', 'EYE_LASH', 'TAIL', 'BACKDROP', 'ORIGINAL_ASSET']);
const SLOT_OPTIONS = new Set(['NONE', 'A', 'B', 'SHARED']);
const PART_OPTIONS = new Set(['UNKNOWN', 'HAIR', 'EYE', 'OUTFIT', 'HAT', 'HAT_DECOR', 'BODY_TRAIT', 'TAIL', 'FACE', 'WATERMARK', 'BACKGROUND', 'RENDER_SLOT', 'REFERENCE', 'OTHER']);
const ROLE_OPTIONS = new Set([
  'UNKNOWN', 'FIXED', 'REFERENCE', 'BACKGROUND_BASE', 'BACKGROUND_LACE_FIXED',
  'HAIR_BASE', 'HAIR_SHADE_MASK', 'HAIR_OUTLINE', 'HAIR_HIGHLIGHT', 'HAIR_HIGHLIGHT_FIXED', 'HAIR_SKIN_AIR_FIXED', 'BROW_BASE',
  'EYE_IRIS_BASE', 'EYE_IRIS_MID', 'EYE_IRIS_DARK', 'EYE_IRIS_DEEP', 'EYE_IRIS_HIGHLIGHT_MID', 'EYE_IRIS_HIGHLIGHT',
  'EYE_DARK', 'EYE_PUPIL', 'EYE_PUPIL_DARK', 'EYE_PUPIL_HIGHLIGHT', 'EYE_HIGHLIGHT', 'EYE_OUTLINE', 'EYE_LASH', 'EYE_LASH_HIGHLIGHT', 'LASH_FIXED', 'LASH_HIGHLIGHT', 'PUPIL_HIGHLIGHT_FIXED',
  'OUTFIT_BASE', 'OUTFIT_SHADOW', 'OUTFIT_LINE', 'OUTFIT_HIGHLIGHT', 'HAT_BASE', 'HAT_OUTLINE', 'HAT_TRIM_EDGE', 'HAT_FUR_FIXED',
  'DECOR_CONTAINER', 'DECOR_BASE', 'DECOR_OUTLINE', 'DECOR_INNER', 'DECOR_FUR', 'DECOR_SHADOW', 'DECOR_ACCENT',
  'BODY_TRAIT_BASE', 'BODY_TRAIT_OUTLINE', 'BODY_TRAIT_INNER', 'BODY_TRAIT_ACCENT',
  'WATERMARK_PREVIEW', 'RENDER_SLOT_HAIR', 'RENDER_SLOT_HAT_DECOR', 'RENDER_SLOT_TAIL', 'RENDER_SLOT_PROP_FRONT', 'RENDER_SLOT_PROP_BACK',
  'TAIL_BASE', 'TAIL_SHADE', 'TAIL_OUTLINE', 'TAIL_TIP', 'TAIL_FUR',
  'COMPONENT_BASE', 'COMPONENT_SHADOW', 'COMPONENT_LINEART', 'COMPONENT_HIGHLIGHT',
  'FACE_FIXED', 'GROUP', 'OTHER'
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
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
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

async function authorizeProfileRequest(req, profileToken, sessionSecret, now, accountStoreFactory) {
  if (!profileToken && !sessionSecret) {
    throw new HttpError(503, 'PROFILE_AUTH_NOT_CONFIGURED');
  }

  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  if (!match) throw new HttpError(401, 'UNAUTHORIZED');
  if (profileToken && secureTokenMatches(match[1], profileToken)) {
    return { accountId: 'legacy-admin', username: 'admin', displayName: '管理员', role: 'admin', legacy: true };
  }
  try {
    const session = readSession(match[1], sessionSecret, { now });
    if (typeof accountStoreFactory !== 'function') throw new HttpError(503, 'ACCOUNT_STORE_NOT_CONFIGURED');
    const account = await (await accountStoreFactory(req)).get(session.username);
    if (!account || account.disabled || account.accountId !== session.sub) throw new HttpError(401, 'SESSION_REVOKED');
    return { ...session, displayName: account.displayName, role: account.role === 'admin' ? 'admin' : 'user', legacy: false };
  }
  catch (error) {
    if (error?.status === 401) throw new HttpError(401, error.code || 'UNAUTHORIZED');
    throw error;
  }
}

function requireAdmin(auth) {
  if (auth?.role !== 'admin') throw new HttpError(403, 'ADMIN_REQUIRED');
}

function parseAccountUsername(pathname) {
  const match = /^\/api\/accounts\/([^/]+)$/.exec(pathname);
  if (!match) return null;
  let username;
  try { username = decodeURIComponent(match[1]); } catch { throw new HttpError(400, 'INVALID_ACCOUNT_USERNAME'); }
  return validateUsername(username);
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

function parseAssetRoute(pathname) {
  if (pathname === ASSET_PATH_PREFIX) return { action: 'list' };
  if (pathname === `${ASSET_PATH_PREFIX}/upload-ticket`) return { action: 'upload-ticket' };
  const match = /^\/api\/assets\/([^/]+)(?:\/(complete|source))?$/.exec(pathname);
  if (!match) return null;
  let assetId;
  try { assetId = decodeURIComponent(match[1]); } catch { throw new HttpError(400, 'INVALID_ASSET_ID'); }
  if (!/^[a-f0-9-]{36}$/i.test(assetId)) throw new HttpError(400, 'INVALID_ASSET_ID');
  return { action: match[2] || 'item', assetId: assetId.toLowerCase() };
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

async function readJsonBody(req, maxBodyBytes, tooLargeCode = 'PROFILE_TOO_LARGE') {
  const declaredLength = Number(req.headers['content-length'] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    throw new HttpError(413, tooLargeCode);
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
  if (tooLarge) throw new HttpError(413, tooLargeCode);

  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!isPlainObject(parsed)) throw new Error('body must be an object');
    return parsed;
  } catch {
    throw new HttpError(400, 'INVALID_JSON');
  }
}

function requiredText(value, code, max = 255) {
  const text = String(value || '').trim();
  if (!text || text.length > max) throw new HttpError(400, code);
  return text;
}

function validateUploadTicketInput(body, maxAssetBytes) {
  const fileName = requiredText(body.fileName, 'INVALID_ASSET_FILE_NAME');
  if (!/\.(?:psd|png)$/i.test(fileName) || /[\\/\0]/.test(fileName)) throw new HttpError(400, 'INVALID_ASSET_FILE_NAME');
  const size = Number(body.size);
  if (!Number.isInteger(size) || size < 1) throw new HttpError(400, 'INVALID_ASSET_SIZE');
  if (size > maxAssetBytes) throw new HttpError(413, 'ASSET_TOO_LARGE');
  const mime = String(body.contentType || 'application/octet-stream').slice(0, 120);
  return { fileName, size, mime };
}

function validateAssetMetadataInput(input, claim) {
  if (!isPlainObject(input)) throw new HttpError(400, 'INVALID_ASSET_METADATA');
  const categoryId = requiredText(input.categoryId, 'INVALID_ASSET_CATEGORY', 96);
  if (!ASSET_CATEGORIES.has(categoryId) && !/^CUSTOM_[A-Za-z0-9_-]{1,80}$/.test(categoryId)) {
    throw new HttpError(400, 'INVALID_ASSET_CATEGORY');
  }
  const characterCompatibility = String(input.characterCompatibility || input.defaultSlot || 'BOTH').toUpperCase();
  if (!['A', 'B', 'BOTH', 'GLOBAL'].includes(characterCompatibility)) throw new HttpError(400, 'INVALID_ASSET_COMPATIBILITY');
  const defaultSlot = String(input.defaultSlot || (characterCompatibility === 'GLOBAL' ? 'GLOBAL' : (characterCompatibility === 'B' ? 'B' : 'A'))).toUpperCase();
  if (!['A', 'B', 'GLOBAL'].includes(defaultSlot)) throw new HttpError(400, 'INVALID_ASSET_SLOT');
  const variant = requiredText(input.variant || input.name || claim.fileName.replace(/\.(?:psd|png)$/i, ''), 'INVALID_ASSET_NAME', 255);
  const name = requiredText(input.name || variant, 'INVALID_ASSET_NAME', 255);
  const contentHash = input.contentHash == null ? null : String(input.contentHash).toLowerCase();
  if (contentHash !== null && !/^[a-f0-9]{64}$/.test(contentHash)) throw new HttpError(400, 'INVALID_ASSET_HASH');
  const sanitizeLayerVisibility = raw => {
    const rawVisibility = raw == null ? {} : raw;
    if (!isPlainObject(rawVisibility)) throw new HttpError(400, 'INVALID_ASSET_LAYER_VISIBILITY');
    const visibilityEntries = Object.entries(rawVisibility);
    if (visibilityEntries.length > 2000) throw new HttpError(400, 'INVALID_ASSET_LAYER_VISIBILITY');
    const cleanVisibility = {};
    for (const [path, visible] of visibilityEntries) {
      if (!path || path.length > 1024 || /\0/.test(path) || typeof visible !== 'boolean') {
        throw new HttpError(400, 'INVALID_ASSET_LAYER_VISIBILITY');
      }
      cleanVisibility[path] = visible;
    }
    return cleanVisibility;
  };
  const rawVisibility = input.layerVisibility == null ? {} : input.layerVisibility;
  const layerVisibility = sanitizeLayerVisibility(rawVisibility);
  let records;
  if (input.records != null) {
    if (!Array.isArray(input.records) || input.records.length < 1 || input.records.length > 64) {
      throw new HttpError(400, 'INVALID_ASSET_RECORDS');
    }
    records = input.records.map(record => {
      if (!isPlainObject(record)) throw new HttpError(400, 'INVALID_ASSET_RECORDS');
      const recordCategory = requiredText(record.categoryId || categoryId, 'INVALID_ASSET_CATEGORY', 96);
      if (recordCategory !== categoryId) throw new HttpError(400, 'INVALID_ASSET_RECORDS');
      const slot = String(record.slot || defaultSlot).toUpperCase();
      if (!['A', 'B', 'GLOBAL'].includes(slot)) throw new HttpError(400, 'INVALID_ASSET_RECORDS');
      const recordCompatibility = String(record.characterCompatibility || slot).toUpperCase();
      if (!['A', 'B', 'BOTH', 'GLOBAL'].includes(recordCompatibility)) throw new HttpError(400, 'INVALID_ASSET_RECORDS');
      const type = requiredText(record.type || categoryId, 'INVALID_ASSET_RECORDS', 96);
      const recordVariant = requiredText(record.variant || record.name || variant, 'INVALID_ASSET_RECORDS', 255);
      const recordName = requiredText(record.name || recordVariant, 'INVALID_ASSET_RECORDS', 255);
      const cleanOptional = (value, max = 1024) => {
        if (value == null || value === '') return null;
        const text = String(value);
        if (text.length > max || /\0/.test(text)) throw new HttpError(400, 'INVALID_ASSET_RECORDS');
        return text;
      };
      const componentOrder = record.componentOrder == null ? null : Number(record.componentOrder);
      if (componentOrder !== null && (!Number.isInteger(componentOrder) || componentOrder < 0 || componentOrder > 255)) {
        throw new HttpError(400, 'INVALID_ASSET_RECORDS');
      }
      const hairPlacement = record.hairPlacement == null ? null : String(record.hairPlacement).toUpperCase();
      if (hairPlacement !== null && !['FRONT', 'BACK'].includes(hairPlacement)) throw new HttpError(400, 'INVALID_ASSET_RECORDS');
      return {
        slot, type, variant: recordVariant, name: recordName,
        groupPath: cleanOptional(record.groupPath),
        packageName: cleanOptional(record.packageName, 255),
        componentName: cleanOptional(record.componentName, 255),
        componentOrder,
        hairPlacement,
        categoryId: recordCategory,
        characterCompatibility: recordCompatibility,
        defaultSlot: ['A', 'B', 'GLOBAL'].includes(String(record.defaultSlot || slot).toUpperCase()) ? String(record.defaultSlot || slot).toUpperCase() : slot,
        colorMode: record.colorMode === 'FOLLOW_ORDER' ? 'FOLLOW_ORDER' : 'PRESERVE_ORIGINAL',
        colorModeExplicit: record.colorModeExplicit === true,
        layerVisibility: sanitizeLayerVisibility(record.layerVisibility)
      };
    });
  }
  return { categoryId, characterCompatibility, defaultSlot, variant, name, contentHash, layerVisibility, ...(records ? { records } : {}) };
}

function createAssetReceipt(claim, secret) {
  const payload = Buffer.from(JSON.stringify(claim)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function readAssetReceipt(receipt, secret, now) {
  const [payload, signature, extra] = String(receipt || '').split('.');
  if (!payload || !signature || extra) throw new HttpError(400, 'INVALID_UPLOAD_RECEIPT');
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  if (!secureTokenMatches(signature, expected)) throw new HttpError(400, 'INVALID_UPLOAD_RECEIPT');
  let claim;
  try { claim = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { throw new HttpError(400, 'INVALID_UPLOAD_RECEIPT'); }
  if (!isPlainObject(claim) || !claim.assetId || !claim.objectKey || !Number.isInteger(claim.size) || !Number.isFinite(claim.expiresAt)) {
    throw new HttpError(400, 'INVALID_UPLOAD_RECEIPT');
  }
  if (now().getTime() > claim.expiresAt) throw new HttpError(410, 'UPLOAD_RECEIPT_EXPIRED');
  return claim;
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
  const sessionSecret = options.sessionSecret ?? process.env.SHINE_SESSION_SECRET ?? profileToken;
  const configuredSessionSeconds = Number(options.sessionSeconds ?? process.env.SHINE_SESSION_SECONDS ?? 7 * 24 * 60 * 60);
  const sessionSeconds = Number.isFinite(configuredSessionSeconds)
    ? Math.max(60 * 60, Math.min(configuredSessionSeconds, 30 * 24 * 60 * 60))
    : 7 * 24 * 60 * 60;
  const configuredMaxBodyBytes = Number(options.maxBodyBytes ?? process.env.PROFILE_MAX_BYTES ?? DEFAULT_MAX_BODY_BYTES);
  const maxBodyBytes = Number.isFinite(configuredMaxBodyBytes) && configuredMaxBodyBytes > 0
    ? configuredMaxBodyBytes
    : DEFAULT_MAX_BODY_BYTES;
  const storeFactory = options.storeFactory;
  const assetStoreFactory = options.assetStoreFactory;
  const accountStoreFactory = options.accountStoreFactory;
  const configuredMaxAssetBytes = Number(options.maxAssetBytes ?? process.env.ASSET_MAX_BYTES ?? DEFAULT_MAX_ASSET_BYTES);
  const maxAssetBytes = Number.isFinite(configuredMaxAssetBytes) && configuredMaxAssetBytes > 0
    ? configuredMaxAssetBytes
    : DEFAULT_MAX_ASSET_BYTES;
  const configuredTicketSeconds = Number(options.assetTicketSeconds ?? process.env.ASSET_TICKET_SECONDS ?? DEFAULT_ASSET_TICKET_SECONDS);
  const assetTicketSeconds = Number.isFinite(configuredTicketSeconds) && configuredTicketSeconds >= 60
    ? Math.min(configuredTicketSeconds, 60 * 60)
    : DEFAULT_ASSET_TICKET_SECONDS;
  const now = options.now || (() => new Date());
  const logger = options.logger || console;
  const configuredDeepSeekBodyBytes = Number(options.maxDeepSeekBodyBytes ?? process.env.DEEPSEEK_MAX_BODY_BYTES ?? DEFAULT_MAX_DEEPSEEK_BODY_BYTES);
  const maxDeepSeekBodyBytes = Number.isFinite(configuredDeepSeekBodyBytes) && configuredDeepSeekBodyBytes > 0
    ? Math.min(configuredDeepSeekBodyBytes, DEFAULT_MAX_BODY_BYTES)
    : DEFAULT_MAX_DEEPSEEK_BODY_BYTES;
  const deepSeekParser = options.deepSeekParser || createDeepSeekOrderParser({
    apiKey: options.deepSeekApiKey,
    baseUrl: options.deepSeekApiBase,
    flashModel: options.deepSeekFlashModel,
    proModel: options.deepSeekProModel,
    timeoutMs: options.deepSeekTimeoutMs,
    fetchImpl: options.fetchImpl
  });

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

      if (url.pathname === AUTH_LOGIN_PATH) {
        if (req.method !== 'POST') return sendJson(req, res, 404, { ok: false, error: 'NOT_FOUND' }, allowedOrigin);
        if (typeof accountStoreFactory !== 'function') throw new HttpError(503, 'ACCOUNT_STORE_NOT_CONFIGURED');
        const body = await readJsonBody(req, 16 * 1024, 'ACCOUNT_REQUEST_TOO_LARGE');
        const username = validateUsername(body.username);
        const accountStore = await accountStoreFactory(req);
        const account = await accountStore.get(username);
        if (!account || !verifyAccountPassword(account, body.password)) throw new HttpError(401, 'INVALID_CREDENTIALS');
        const token = signSession(account, sessionSecret, { now, sessionSeconds });
        return sendJson(req, res, 200, {
          ok: true,
          token,
          account: publicAccount(account),
          expiresAt: new Date(now().getTime() + sessionSeconds * 1000).toISOString()
        }, allowedOrigin, { 'Cache-Control': 'no-store' });
      }

      if (url.pathname === AUTH_ME_PATH) {
        if (req.method !== 'GET') return sendJson(req, res, 404, { ok: false, error: 'NOT_FOUND' }, allowedOrigin);
        const auth = await authorizeProfileRequest(req, profileToken, sessionSecret, now, accountStoreFactory);
        return sendJson(req, res, 200, {
          ok: true,
          account: auth.legacy
            ? { accountId: auth.accountId, username: auth.username, displayName: auth.displayName, role: 'admin', legacy: true }
            : { accountId: auth.sub, username: auth.username, displayName: auth.displayName, role: auth.role, legacy: false },
          permissions: { sharedAssets: true, uploadAssets: true, deleteAssets: auth.role === 'admin', manageAccounts: auth.role === 'admin' }
        }, allowedOrigin, { 'Cache-Control': 'no-store' });
      }

      const accountUsername = parseAccountUsername(url.pathname);
      if (url.pathname === ACCOUNTS_PATH || accountUsername) {
        const auth = await authorizeProfileRequest(req, profileToken, sessionSecret, now, accountStoreFactory);
        requireAdmin(auth);
        if (typeof accountStoreFactory !== 'function') throw new HttpError(503, 'ACCOUNT_STORE_NOT_CONFIGURED');
        const accountStore = await accountStoreFactory(req);
        if (url.pathname === ACCOUNTS_PATH && req.method === 'GET') {
          const accounts = (await accountStore.list()).map(publicAccount).sort((a, b) => a.username.localeCompare(b.username));
          return sendJson(req, res, 200, { ok: true, accounts }, allowedOrigin, { 'Cache-Control': 'no-store' });
        }
        if (url.pathname === ACCOUNTS_PATH && req.method === 'POST') {
          const body = await readJsonBody(req, 16 * 1024, 'ACCOUNT_REQUEST_TOO_LARGE');
          const account = createAccountRecord(body, { role: 'user', now });
          await accountStore.create(account);
          return sendJson(req, res, 201, { ok: true, account: publicAccount(account) }, allowedOrigin, { 'Cache-Control': 'no-store' });
        }
        if (accountUsername && req.method === 'DELETE') {
          const account = await accountStore.get(accountUsername);
          if (!account) throw new HttpError(404, 'ACCOUNT_NOT_FOUND');
          await accountStore.remove(accountUsername);
          return sendJson(req, res, 200, { ok: true, deletedUsername: accountUsername }, allowedOrigin, { 'Cache-Control': 'no-store' });
        }
        return sendJson(req, res, 404, { ok: false, error: 'NOT_FOUND' }, allowedOrigin);
      }

      if (url.pathname === DEEPSEEK_PATH) {
        if (req.method !== 'POST') {
          return sendJson(req, res, 404, { ok: false, error: 'NOT_FOUND' }, allowedOrigin);
        }
        await authorizeProfileRequest(req, profileToken, sessionSecret, now, accountStoreFactory);
        const body = await readJsonBody(req, maxDeepSeekBodyBytes, 'DEEPSEEK_REQUEST_TOO_LARGE');
        const input = validateDeepSeekRequest(body);
        const parsed = await deepSeekParser(input);
        return sendJson(req, res, 200, parsed, allowedOrigin, { 'Cache-Control': 'no-store' });
      }

      const assetRoute = parseAssetRoute(url.pathname);
      if (assetRoute) {
        const allowed = (assetRoute.action === 'list' && req.method === 'GET') ||
          (assetRoute.action === 'upload-ticket' && req.method === 'POST') ||
          (assetRoute.action === 'complete' && req.method === 'POST') ||
          (assetRoute.action === 'source' && req.method === 'GET') ||
          (assetRoute.action === 'item' && req.method === 'DELETE');
        if (!allowed) return sendJson(req, res, 404, { ok: false, error: 'NOT_FOUND' }, allowedOrigin);

        const auth = await authorizeProfileRequest(req, profileToken, sessionSecret, now, accountStoreFactory);
        if (assetRoute.action === 'item') requireAdmin(auth);
        if (typeof assetStoreFactory !== 'function') throw new HttpError(503, 'ASSET_STORE_NOT_CONFIGURED');
        const assetStore = await assetStoreFactory(req);

        if (assetRoute.action === 'list') {
          const assets = await assetStore.listMetadata();
          assets.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
          return sendJson(req, res, 200, { ok: true, schemaVersion: 'shine-asset-catalog-v2', assets }, allowedOrigin, { 'Cache-Control': 'no-store' });
        }

        if (assetRoute.action === 'upload-ticket') {
          const body = await readJsonBody(req, maxBodyBytes, 'ASSET_METADATA_TOO_LARGE');
          const input = validateUploadTicketInput(body, maxAssetBytes);
          const assetId = crypto.randomUUID();
          const expiresAt = now().getTime() + assetTicketSeconds * 1000;
          const signed = await assetStore.createUploadTicket(assetId, { mime: input.mime, expiresSeconds: assetTicketSeconds });
          const claim = { assetId, objectKey: signed.objectKey, fileName: input.fileName, size: input.size, mime: input.mime, expiresAt };
          return sendJson(req, res, 201, {
            ok: true,
            assetId,
            objectKey: signed.objectKey,
            uploadUrl: signed.uploadUrl,
            expiresAt: new Date(expiresAt).toISOString(),
            receipt: createAssetReceipt(claim, sessionSecret || profileToken)
          }, allowedOrigin, { 'Cache-Control': 'no-store' });
        }

        if (assetRoute.action === 'complete') {
          const body = await readJsonBody(req, maxBodyBytes, 'ASSET_METADATA_TOO_LARGE');
          const claim = readAssetReceipt(body.receipt, sessionSecret || profileToken, now);
          if (claim.assetId !== assetRoute.assetId) throw new HttpError(400, 'UPLOAD_RECEIPT_MISMATCH');
          const uploaded = await assetStore.headSource(assetRoute.assetId);
          if (!uploaded) throw new HttpError(409, 'ASSET_UPLOAD_MISSING');
          if (uploaded.objectKey !== claim.objectKey || (uploaded.size !== null && uploaded.size !== claim.size)) {
            throw new HttpError(409, 'ASSET_UPLOAD_MISMATCH');
          }
          const clean = validateAssetMetadataInput(body.asset, claim);
          const timestamp = now().toISOString();
          const metadata = {
            schemaVersion: 'shine-asset-v2',
            assetId: assetRoute.assetId,
            fileName: claim.fileName,
            byteSize: claim.size,
            contentType: claim.mime,
            sourceObjectKey: claim.objectKey,
            thumbnailObjectKey: null,
            colorMode: 'PRESERVE_ORIGINAL',
            defaultTransform: { x: 0, y: 0, scale: 1, rotation: 0, flipX: false, flipY: false },
            compatibleTemplateIds: [],
            version: 1,
            createdAt: timestamp,
            updatedAt: timestamp,
            ...clean
          };
          await assetStore.putMetadata(assetRoute.assetId, metadata);
          return sendJson(req, res, 201, { ok: true, asset: metadata }, allowedOrigin, { 'Cache-Control': 'no-store' });
        }

        if (assetRoute.action === 'source') {
          const ticket = await assetStore.createDownloadTicket(assetRoute.assetId, assetTicketSeconds);
          if (!ticket) throw new HttpError(404, 'ASSET_NOT_FOUND');
          return sendJson(req, res, 200, {
            ok: true,
            asset: ticket.metadata,
            downloadUrl: ticket.downloadUrl,
            expiresAt: new Date(now().getTime() + assetTicketSeconds * 1000).toISOString()
          }, allowedOrigin, { 'Cache-Control': 'no-store' });
        }

        const existing = await assetStore.getMetadata(assetRoute.assetId);
        if (!existing) throw new HttpError(404, 'ASSET_NOT_FOUND');
        await assetStore.remove(assetRoute.assetId);
        return sendJson(req, res, 200, { ok: true, deletedAssetId: assetRoute.assetId }, allowedOrigin, { 'Cache-Control': 'no-store' });
      }

      const signature = parseTemplateSignature(url.pathname);
      if (signature === null || !['GET', 'PUT'].includes(req.method)) {
        return sendJson(req, res, 404, { ok: false, error: 'NOT_FOUND' }, allowedOrigin);
      }

      const auth = await authorizeProfileRequest(req, profileToken, sessionSecret, now, accountStoreFactory);
      if (req.method === 'PUT') requireAdmin(auth);
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
        logger.error?.('Shine backend request failed', {
          method: req.method,
          path: req.url?.split('?')[0],
          code,
          ...(error?.ossCode ? { ossCode: error.ossCode } : {}),
          ...(error?.ossStatus ? { ossStatus: error.ossStatus } : {}),
          ...(error?.ossRequestId ? { ossRequestId: error.ossRequestId } : {})
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
