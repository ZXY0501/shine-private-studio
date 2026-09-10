(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.ShineInboxClient = api; if (root.document) api.mount(root.document, root); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DEFAULT_ENDPOINT = 'https://shine-backend-uxgyzdvkcv.cn-hangzhou.fcapp.run';
  const MAX_BYTES = 200 * 1024 * 1024;
  const SESSION_KEY = 'shine:inbox-mobile:session:v1';
  const JOBS_KEY = 'shine:inbox-mobile:jobs:v1';
  const DEVICE_TOKEN = /^shine-inbox-device-v1\.[a-f0-9]{64}\.[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/;
  const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const REQUEST_ID = /^[A-Za-z0-9_.:-]{8,128}$/;
  const COMPLETE_STATES = new Set(['READY', 'RECEIVED']);
  const TEXT = {
    INVALID_ENDPOINT: '请填写不含路径、账号、查询参数的 HTTPS 后端地址。HTTP 仅限本机测试。',
    ENDPOINT_NOT_CONFIRMED: '请先确认这是你信任的 SHINE 后端地址。',
    INVALID_DEVICE_TOKEN: '这里仅接受 shine-inbox-device-v1 开头的设备上传令牌，不接受管理员口令或 API Key。',
    INVALID_CREDENTIALS: '用户名或密码不正确。请使用电脑工作台创建的独立账户。',
    UNAUTHORIZED: '登录已失效，请重新连接；原文件和电脑作品不会改变。',
    INVALID_SESSION: '登录已失效，请重新连接。',
    INVALID_USERNAME: '请检查用户名格式。',
    INVALID_INBOX_DEVICE: '设备令牌格式或签名无效，请重新从电脑获取。',
    INBOX_DEVICE_REVOKED_OR_EXPIRED: '设备令牌已过期或被撤销，请从电脑重新创建。',
    INBOX_DEVICE_ITEM_MISMATCH: '这条收件记录来自另一设备令牌；请用原令牌继续。',
    INBOX_UPLOAD_ONLY: '仅上传令牌不能浏览账户资料或其他文件。',
    NOT_FOUND: '这个后端还没有部署收件功能，或地址不正确。请先完成后端部署。',
    INBOX_STORE_NOT_CONFIGURED: '后端尚未配置收件存储，请在电脑完成部署配置。',
    ACCOUNT_STORE_NOT_CONFIGURED: '后端尚未配置独立账户，请在电脑完成配置。',
    PROFILE_AUTH_NOT_CONFIGURED: '后端尚未配置登录签名，请在电脑完成配置。',
    INVALID_INBOX_FILE_NAME: '文件名需以 .psd 或 .png 结尾，不能含路径或特殊控制字符。',
    INVALID_INBOX_SIZE: '文件不完整或大小无效，请从 Procreate 重新导出。',
    INBOX_TOO_LARGE: '单个文件不能超过 200 MB，请拆分素材后发送。',
    INVALID_INBOX_CONTENT_TYPE: '仅支持 PSD 和 PNG 文件。',
    INBOX_FILE_SIGNATURE_MISMATCH: '实际文件内容不是有效的 PSD / PNG，不能只改后缀。请重新导出。',
    INBOX_REQUEST_ID_CONFLICT: '重试编号对应了不同的文件，请移出本页记录后重新选择。',
    INBOX_QUOTA_EXCEEDED: '临时收件箱已满（最多 30 条、合计 1 GB），请在电脑清理后重试。',
    INBOX_EXPIRED: '这条收件记录已超过 48 小时。移出本页记录后重新选择文件，可开启一次新发送。',
    INBOX_DELETED: '这条收件记录已被删除。需要再发时，请移出本页记录后重新选择。',
    INBOX_UPLOAD_RECEIPT_EXPIRED: '临时上传凭证已过期，重试会重新申请，不会更换收件编号。',
    INBOX_UPLOAD_MISSING: '云端尚未收到完整文件，请保持页面在前台后重试。',
    INBOX_UPLOAD_MISMATCH: '云端文件大小或类型不匹配，请重试；不要在发送中修改源文件。',
    INBOX_UPLOAD_CHANGED: '上传期间文件发生变化，请移出本页记录后重新选择。',
    NETWORK_ERROR: '网络连接中断。请检查网络后点重试；会沿用原收件编号。',
    REQUEST_TIMEOUT: '等待服务响应超时。请重试，不要重复新建发送。',
    UPLOAD_FAILED: '文件未能完成上传。请检查网络；若持续失败，需检查云存储的上传权限和跨域配置。',
    REQUEST_CANCELLED: '已暂停。部分文件可能已到达云端，重试会先确认原记录。',
    INVALID_RESPONSE: '后端返回了无法识别的结果，请检查部署版本后重试。',
    FILE_REQUIRED: '请重新选择同一个文件，再继续此条发送。',
    SECURE_CONTEXT_REQUIRED: '此页面需要 HTTPS（或电脑本机地址）才能安全生成发送编号。',
    SESSION_STORAGE_UNAVAILABLE: '浏览器不允许会话存储；连接只保留在内存里，刷新后需要重新登录。',
    UNKNOWN_ERROR: '本次发送未完成，请稍后重试。'
  };
  function problem(code, status) { return Object.assign(new Error(TEXT[code] || TEXT.UNKNOWN_ERROR), { code, status }); }
  function message(error) { return TEXT[error?.code] || (error?.status === 401 ? TEXT.UNAUTHORIZED : error?.status === 413 ? TEXT.INBOX_TOO_LARGE : error?.status === 429 ? TEXT.INBOX_QUOTA_EXCEEDED : TEXT.UNKNOWN_ERROR); }
  function normalizeEndpoint(value) {
    let url; try { url = new URL(String(value || '').trim()); } catch { throw problem('INVALID_ENDPOINT'); }
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) throw problem('INVALID_ENDPOINT');
    return url.origin;
  }
  function endpointHint(href) {
    const url = new URL(href), params = new URLSearchParams(url.hash.slice(1));
    // Never read credentials from a URL. Unknown parameters are rejected and removed by mount.
    if (url.search || [...params.keys()].some(key => key !== 'endpoint') || params.getAll('endpoint').length > 1) return { invalid: true, endpoint: '' };
    if (!params.has('endpoint')) return { invalid: false, endpoint: '' };
    try { return { invalid: false, endpoint: normalizeEndpoint(params.get('endpoint')) }; } catch { return { invalid: true, endpoint: '' }; }
  }
  function normalizeDeviceToken(value) {
    const token = String(value || '').trim(); if (!DEVICE_TOKEN.test(token) || !UUID.test(token.split('.')[2])) throw problem('INVALID_DEVICE_TOKEN'); return token;
  }
  function fileMetadata(file) {
    const fileName = typeof file?.name === 'string' ? file.name.trim() : '';
    if (!fileName || fileName.length > 255 || /[\\/\x00-\x1f]/.test(fileName) || !/\.(psd|png)$/i.test(fileName)) throw problem('INVALID_INBOX_FILE_NAME');
    if (!Number.isSafeInteger(file.size) || file.size < 8) throw problem('INVALID_INBOX_SIZE');
    if (file.size > MAX_BYTES) throw problem('INBOX_TOO_LARGE');
    return { fileName, size: file.size, contentType: /\.png$/i.test(fileName) ? 'image/png' : 'image/vnd.adobe.photoshop' };
  }
  function validSignature(bytes, contentType) {
    const expected = contentType === 'image/png' ? [137, 80, 78, 71, 13, 10, 26, 10] : [56, 66, 80, 83, 0, 1];
    return expected.every((value, index) => bytes[index] === value);
  }
  async function selectionKey(file, cryptoApi) {
    const meta = fileMetadata(file);
    if (!cryptoApi?.subtle) throw problem('SECURE_CONTEXT_REQUIRED');
    const first = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
    if (!validSignature(first, meta.contentType)) throw problem('INBOX_FILE_SIGNATURE_MISMATCH');
    const last = file.size > 65536 ? new Uint8Array(await file.slice(Math.max(65536, file.size - 65536)).arrayBuffer()) : new Uint8Array();
    const metadata = new TextEncoder().encode(JSON.stringify([meta.fileName, meta.size, Number(file.lastModified) || 0]));
    const sample = new Uint8Array(metadata.length + first.length + last.length); sample.set(metadata); sample.set(first, metadata.length); sample.set(last, metadata.length + first.length);
    // A bounded selection fingerprint, not an integrity hash of the full PSD. Avoids decoding 200 MB on iPad.
    return [...new Uint8Array(await cryptoApi.subtle.digest('SHA-256', sample))].map(value => value.toString(16).padStart(2, '0')).join('');
  }
  function newRequestId(cryptoApi) {
    if (!cryptoApi?.getRandomValues) throw problem('SECURE_CONTEXT_REQUIRED');
    return 'ipad-' + [...cryptoApi.getRandomValues(new Uint8Array(16))].map(value => value.toString(16).padStart(2, '0')).join('');
  }
  function ticketInput(job) {
    if (!REQUEST_ID.test(job.clientRequestId || '')) throw problem('INVALID_RESPONSE');
    return { ...fileMetadata({ name: job.fileName, size: job.size }), clientRequestId: job.clientRequestId };
  }
  function uploadTarget(ticket, meta, endpoint) {
    if (!UUID.test(ticket?.id || '') || typeof ticket.receipt !== 'string' || !ticket.receipt || ticket.receipt.length > 12000) throw problem('INVALID_RESPONSE');
    let url; try { url = new URL(ticket.uploadUrl); } catch { throw problem('INVALID_RESPONSE'); }
    const local = new URL(endpoint).protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))) throw problem('INVALID_RESPONSE');
    if (ticket.uploadHeaders?.['Content-Type'] !== meta.contentType || Object.keys(ticket.uploadHeaders || {}).some(key => key.toLowerCase() !== 'content-type')) throw problem('INVALID_RESPONSE');
    // Only signed content headers reach OSS; the SHINE bearer credential must never be forwarded.
    return { url: url.href, headers: { 'Content-Type': meta.contentType } };
  }
  function checkedItem(item, expectedId) {
    if (!item || !UUID.test(item.id || '') || (expectedId && item.id !== expectedId) || !['READY', 'RECEIVED', 'UPLOADING', 'EXPIRED', 'DELETED'].includes(item.status) || !Number.isFinite(Date.parse(item.expiresAt))) throw problem('INVALID_RESPONSE');
    return item;
  }
  async function requestJson(fetcher, endpoint, path, { method = 'GET', token = '', body, signal, timeoutMs = 30000 } = {}) {
    const controller = new AbortController(); let timedOut = false;
    const abort = () => controller.abort();
    if (signal?.aborted) throw problem('REQUEST_CANCELLED');
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      const response = await fetcher(normalizeEndpoint(endpoint) + path, { method, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      let data; try { data = await response.json(); } catch { throw problem(response.status === 404 ? 'NOT_FOUND' : 'INVALID_RESPONSE', response.status); }
      if (!response.ok || !data?.ok) throw problem(typeof data?.error === 'string' ? data.error : 'INVALID_RESPONSE', response.status);
      return data;
    } catch (error) {
      if (error.code) throw error;
      if (timedOut) throw problem('REQUEST_TIMEOUT');
      if (signal?.aborted) throw problem('REQUEST_CANCELLED');
      throw problem('NETWORK_ERROR');
    } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
  }
  function xhrPut(url, headers, file, { signal, onProgress = () => {}, xhrFactory = () => new XMLHttpRequest() } = {}) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(problem('REQUEST_CANCELLED')); return; }
      const xhr = xhrFactory(); let finished = false;
      const settle = error => { if (finished) return; finished = true; signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(); };
      const abort = () => xhr.abort();
      xhr.open('PUT', url, true); xhr.timeout = 14 * 60 * 1000; xhr.withCredentials = false;
      for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value);
      xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(event.loaded / event.total); };
      xhr.onload = () => settle(xhr.status >= 200 && xhr.status < 300 ? null : problem('UPLOAD_FAILED', xhr.status));
      xhr.onerror = () => settle(problem('UPLOAD_FAILED')); xhr.ontimeout = () => settle(problem('REQUEST_TIMEOUT')); xhr.onabort = () => settle(problem('REQUEST_CANCELLED'));
      signal?.addEventListener('abort', abort, { once: true });
      try { xhr.send(file); } catch { settle(problem('UPLOAD_FAILED')); }
    });
  }
  function createUploadClient({ endpoint, token, fetcher = globalThis.fetch.bind(globalThis), put = xhrPut }) {
    endpoint = normalizeEndpoint(endpoint);
    const request = (path, options = {}) => requestJson(fetcher, endpoint, '/api/inbox' + path, { ...options, token });
    async function complete(job, signal) {
      const result = await request('/' + job.id + '/complete', { method: 'POST', body: { receipt: job.receipt }, signal });
      const item = checkedItem(result.item, job.id); if (!COMPLETE_STATES.has(item.status)) throw problem('INVALID_RESPONSE'); return item;
    }
    return {
      async upload(job, { signal, onStage = () => {}, onProgress } = {}) {
        if (job.inFlight) throw problem('UPLOAD_FAILED');
        if (!job.file) throw problem('FILE_REQUIRED');
        job.inFlight = true;
        try {
          // Lost PUT/complete responses are ambiguous: confirm first, rather than resend a large PSD blindly.
          if (job.id && job.receipt) {
            onStage('CONFIRMING');
            try { return await complete(job, signal); }
            catch (error) { if (!['INBOX_UPLOAD_MISSING', 'INBOX_UPLOAD_RECEIPT_EXPIRED'].includes(error.code)) throw error; job.receipt = ''; }
          }
          onStage('TICKET');
          const meta = ticketInput(job), ticket = await request('/upload-ticket', { method: 'POST', body: meta, signal });
          if (!UUID.test(ticket.id || '')) throw problem('INVALID_RESPONSE');
          job.id = ticket.id;
          const item = checkedItem(ticket.item, ticket.id);
          if (COMPLETE_STATES.has(item.status)) return item;
          const target = uploadTarget(ticket, meta, endpoint); job.receipt = ticket.receipt;
          onStage('UPLOADING'); await put(target.url, target.headers, job.file, { signal, onProgress });
          onStage('CONFIRMING'); return await complete(job, signal);
        } finally { job.inFlight = false; }
      },
      async list({ signal } = {}) { const data = await request('', { signal }); if (!Array.isArray(data.items)) throw problem('INVALID_RESPONSE'); return data.items.map(item => checkedItem(item)); },
      async check(job, { signal } = {}) {
        // Upload-only devices cannot list; reusing a completed ticket safely returns that device's item status.
        const data = await request('/upload-ticket', { method: 'POST', body: ticketInput(job), signal });
        return checkedItem(data.item, job.id);
      }
    };
  }
  function persistedJobs(jobs) {
    return jobs.slice(0, 30).map(job => ({ key: job.key, fileName: job.fileName, size: job.size, clientRequestId: job.clientRequestId, id: job.id || '', status: COMPLETE_STATES.has(job.status) ? job.status : 'WAITING_FILE', expiresAt: job.expiresAt || '', receivedAt: job.receivedAt || '' }));
  }
  function restoreJobs(records) {
    if (!Array.isArray(records)) return [];
    return records.slice(0, 30).flatMap(record => {
      try {
        const meta = fileMetadata({ name: record.fileName, size: record.size });
        if (!/^[a-f0-9]{64}$/.test(record.key) || !REQUEST_ID.test(record.clientRequestId) || (record.id && !UUID.test(record.id))) return [];
        return [{ ...meta, key: record.key, clientRequestId: record.clientRequestId, id: record.id || '', status: COMPLETE_STATES.has(record.status) ? record.status : 'WAITING_FILE', expiresAt: Number.isFinite(Date.parse(record.expiresAt)) ? record.expiresAt : '', receivedAt: Number.isFinite(Date.parse(record.receivedAt)) ? record.receivedAt : '', file: null, detail: '' }];
      } catch { return []; }
    });
  }
  function mount(doc, win) {
    const $ = id => doc.getElementById(id);
    if (!$('account-form')) return;
    let session = null, client = null, jobs = [], busy = false, selecting = false, authenticating = false, controller = null, stopped = false, mode = 'account';
    const states = { QUEUED: '等待发送', WAITING_FILE: '需重新选择文件', TICKET: '申请地址', UPLOADING: '上传文件', CONFIRMING: '确认完整性', READY: '已送达收件箱', RECEIVED: '电脑已接收', ERROR: '未完成', EXPIRED: '已过期', DELETED: '已删除' };
    const note = (element, value, kind = '') => { element.textContent = value; element.className = 'notice' + (kind ? ' ' + kind : ''); };
    const store = (key, value) => { try { if (value === null) win.sessionStorage.removeItem(key); else win.sessionStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } };
    const read = key => { try { return JSON.parse(win.sessionStorage.getItem(key)); } catch { return null; } };
    const saveJobs = () => { if (session) store(JOBS_KEY, { owner: session.owner, endpoint: session.endpoint, records: persistedJobs(jobs) }); };
    const time = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    function controls() {
      $('connect-controls').hidden = !!session; $('connected-controls').hidden = !session;
      $('files').disabled = !session || !$('transfer-consent').checked || busy || selecting;
      $('send').disabled = !session || !$('transfer-consent').checked || busy || selecting || !jobs.some(job => job.file && ['QUEUED', 'ERROR'].includes(job.status));
      $('refresh').disabled = !session || busy || selecting || !jobs.some(job => COMPLETE_STATES.has(job.status));
      $('pause').hidden = !busy; $('disconnect').disabled = busy || selecting;
      $('transfer-consent').disabled = busy;
      for (const node of $('connect-controls').querySelectorAll('input,button')) node.disabled = authenticating;
      $('connection-badge').textContent = session ? session.mode === 'device' ? '仅上传设备' : '已连接' : '未连接';
    }
    function render() {
      $('queue').replaceChildren();
      for (const job of jobs) {
        const li = doc.createElement('li'); li.className = 'queue-item';
        const head = doc.createElement('div'); head.className = 'file-head';
        const name = doc.createElement('span'); name.className = 'file-name'; name.textContent = job.fileName;
        const status = doc.createElement('span'); status.className = 'file-state'; status.textContent = states[job.status] || job.status; head.append(name, status);
        const meta = doc.createElement('div'); meta.className = 'file-meta'; meta.textContent = `${(job.size / 1024 / 1024).toFixed(2)} MB${job.id ? ' · 编号 ' + job.id.slice(0, 8) : ''}${job.expiresAt ? ' · 有效至 ' + time(job.expiresAt) : ''}`;
        li.append(head, meta);
        if (['TICKET', 'UPLOADING', 'CONFIRMING'].includes(job.status)) { const progress = doc.createElement('progress'); progress.max = 1; progress.setAttribute('aria-label', job.fileName + ' 上传进度'); if (job.status === 'UPLOADING' && Number.isFinite(job.progress)) progress.value = job.progress; li.append(progress); }
        const detail = doc.createElement('div'); detail.className = 'file-detail' + (job.status === 'ERROR' ? ' bad' : COMPLETE_STATES.has(job.status) ? ' good' : '');
        detail.textContent = job.detail || (job.status === 'READY' ? '文件已到云端。请在电脑收件箱确认订单和 A / B；当前作品尚未改变。' : job.status === 'RECEIVED' ? '电脑已确认接收此文件。' : job.status === 'WAITING_FILE' ? '文件内容不会存到浏览器缓存。请选择同一文件继续，原发送编号会保留。' : ''); li.append(detail);
        if (['ERROR', 'QUEUED', 'WAITING_FILE', 'EXPIRED', 'DELETED'].includes(job.status)) {
          const actions = doc.createElement('div'); actions.className = 'file-actions';
          if (job.file && ['ERROR', 'QUEUED'].includes(job.status)) { const retry = doc.createElement('button'); retry.type = 'button'; retry.textContent = job.status === 'ERROR' ? '重试这一条' : '发送这一条'; retry.disabled = busy || selecting || !$('transfer-consent').checked; retry.onclick = () => sendJobs([job]); actions.append(retry); }
          const remove = doc.createElement('button'); remove.type = 'button'; remove.textContent = '移出本页记录'; remove.disabled = busy || selecting; remove.onclick = () => { if (job.id && !win.confirm('仅移出本页记录，不会删除云端文件。再次选择会创建新的发送；原记录可在电脑收件箱删除。继续？')) return; jobs = jobs.filter(item => item !== job); saveJobs(); render(); }; actions.append(remove); li.append(actions);
        }
        $('queue').append(li);
      }
      controls();
    }
    function acceptItem(job, item) {
      job.status = item.status; job.id = item.id; job.expiresAt = item.expiresAt; job.receivedAt = item.receivedAt || ''; job.detail = ''; job.receipt = ''; job.progress = null;
      if (COMPLETE_STATES.has(item.status)) job.file = null;
    }
    function disconnect() {
      session = null; client = null; jobs = []; store(SESSION_KEY, null); store(JOBS_KEY, null);
      $('password').value = ''; $('device-token').value = ''; $('files').value = ''; $('transfer-consent').checked = false;
      note($('connection-status'), '已退出连接，本标签页凭据和发送记录已清除。云端文件没有被删除。'); note($('transfer-status'), '还没有选择文件。'); render();
    }
    function connect(value, restore = false) {
      session = value; client = createUploadClient({ endpoint: value.endpoint, token: value.token, fetcher: win.fetch.bind(win), put: (url, headers, file, options) => xhrPut(url, headers, file, { ...options, xhrFactory: () => new win.XMLHttpRequest() }) });
      $('endpoint').value = value.endpoint; $('endpoint-consent').checked = true;
      $('connected-as').textContent = value.mode === 'device' ? '已暂存本设备的仅上传令牌，发送时验证有效性。' : `已连接：${value.displayName || value.owner}`;
      $('connected-endpoint').textContent = value.endpoint + (value.expiresAt ? ' · 登录有效至 ' + time(value.expiresAt) : '');
      const record = restore ? read(JOBS_KEY) : null; jobs = record?.owner === value.owner && record?.endpoint === value.endpoint ? restoreJobs(record.records) : [];
      const saved = store(SESSION_KEY, value); saveJobs();
      note($('connection-status'), saved ? value.mode === 'device' ? '可选择文件。设备令牌不能浏览其他素材，且不是管理员口令。' : '账户已连接。可以选择文件发送。' : TEXT.SESSION_STORAGE_UNAVAILABLE, saved ? 'good' : ''); render();
    }
    function getEndpoint() { if (!$('endpoint-consent').checked) throw problem('ENDPOINT_NOT_CONFIRMED'); return normalizeEndpoint($('endpoint').value); }
    function switchMode(next) { mode = next; $('account-form').hidden = mode !== 'account'; $('device-form').hidden = mode !== 'device'; for (const type of ['account', 'device']) { $(type + '-mode').classList.toggle('selected', mode === type); $(type + '-mode').setAttribute('aria-pressed', String(mode === type)); } $('password').value = ''; $('device-token').value = ''; }
    $('account-mode').onclick = () => switchMode('account'); $('device-mode').onclick = () => switchMode('device');
    $('endpoint').oninput = () => { $('endpoint-consent').checked = false; };
    $('disconnect').onclick = () => { if (jobs.length && !win.confirm('退出会清除本页重试记录；已送达云端的文件仍在电脑收件箱。确定退出？')) return; disconnect(); };
    $('account-form').onsubmit = async event => {
      event.preventDefault(); if (authenticating) return;
      authenticating = true; controls(); note($('connection-status'), '正在连接…');
      try {
        const endpoint = getEndpoint(), data = await requestJson(win.fetch.bind(win), endpoint, '/api/auth/login', { method: 'POST', body: { username: $('username').value.trim(), password: $('password').value } });
        if (!data.token || typeof data.token !== 'string' || !data.account?.accountId || data.account.legacy) throw problem('INVALID_RESPONSE');
        connect({ mode: 'account', endpoint, token: data.token, owner: data.account.accountId, displayName: data.account.displayName || data.account.username, expiresAt: data.expiresAt });
      } catch (error) { note($('connection-status'), message(error), 'bad'); }
      finally { $('password').value = ''; authenticating = false; controls(); }
    };
    $('device-form').onsubmit = event => {
      event.preventDefault();
      try { const endpoint = getEndpoint(), token = normalizeDeviceToken($('device-token').value); connect({ mode: 'device', endpoint, token, owner: 'device:' + token.split('.')[2], displayName: '仅上传设备' }); }
      catch (error) { note($('connection-status'), message(error), 'bad'); }
      finally { $('device-token').value = ''; }
    };
    $('transfer-consent').onchange = render;
    $('files').onchange = async () => {
      if (!session || busy || selecting || !$('transfer-consent').checked) return;
      selecting = true; controls(); const selected = Array.from($('files').files || []); let added = 0, reused = 0; const errors = [];
      note($('transfer-status'), '正在检查文件类型，不会解析 PSD 或修改颜色…');
      for (const file of selected) {
        try {
          const meta = fileMetadata(file), key = await selectionKey(file, win.crypto), existing = jobs.find(job => job.key === key);
          if (existing) { reused++; if (!COMPLETE_STATES.has(existing.status)) { existing.file = file; existing.status = 'QUEUED'; existing.detail = ''; } continue; }
          if (jobs.length >= 30) throw problem('INBOX_QUOTA_EXCEEDED');
          jobs.push({ ...meta, key, clientRequestId: newRequestId(win.crypto), file, status: 'QUEUED', detail: '' }); added++;
        } catch (error) { errors.push(file.name + '：' + message(error)); }
      }
      $('files').value = ''; selecting = false; saveJobs(); render();
      note($('transfer-status'), [`新增 ${added} 个文件。`, reused ? `${reused} 个文件沿用本页已有记录，不重复建立发送。` : '', ...errors].filter(Boolean).join(' '), errors.length ? 'bad' : '');
    };
    async function sendJobs(selected) {
      if (busy || !session || !$('transfer-consent').checked) return;
      busy = true; stopped = false; controller = new AbortController(); render(); let success = 0, failed = 0;
      for (const job of selected) {
        if (stopped) break;
        try {
          const item = await client.upload(job, { signal: controller.signal, onStage: stage => { job.status = stage; job.detail = ''; render(); }, onProgress: progress => { job.progress = progress; const index = jobs.indexOf(job), bar = $('queue').children[index]?.querySelector('progress'); if (bar) bar.value = progress; } });
          acceptItem(job, item); success++;
        } catch (error) { job.status = ['INBOX_EXPIRED', 'INBOX_DELETED'].includes(error.code) ? error.code === 'INBOX_EXPIRED' ? 'EXPIRED' : 'DELETED' : 'ERROR'; job.detail = message(error); failed++; if (error.status === 401 || error.code === 'REQUEST_CANCELLED') stopped = true; }
        saveJobs(); render();
      }
      busy = false; controller = null; render();
      note($('transfer-status'), stopped ? `已停止本轮发送。${success} 个已完成；未完成项可沿用原编号重试。` : `${success} 个已送达收件箱${failed ? `，${failed} 个未完成，可单独重试` : ''}。请在电脑确认接收，作品不会自动替换。`, failed ? 'bad' : 'good');
    }
    $('send').onclick = () => sendJobs(jobs.filter(job => job.file && ['QUEUED', 'ERROR'].includes(job.status)));
    $('pause').onclick = () => { stopped = true; controller?.abort(); };
    $('refresh').onclick = async () => {
      if (busy || !session) return; busy = true; controller = new AbortController(); render();
      try {
        if (session.mode === 'account') {
          const rows = await client.list({ signal: controller.signal });
          for (const job of jobs) { const row = rows.find(item => item.id === job.id); if (row) acceptItem(job, row); }
        } else {
          for (const job of jobs.filter(row => COMPLETE_STATES.has(row.status))) {
            try { acceptItem(job, await client.check(job, { signal: controller.signal })); }
            catch (error) { if (['INBOX_EXPIRED', 'INBOX_DELETED'].includes(error.code)) { job.status = error.code === 'INBOX_EXPIRED' ? 'EXPIRED' : 'DELETED'; job.detail = message(error); } else throw error; }
          }
        }
        saveJobs(); note($('transfer-status'), '状态已检查：“已送达收件箱”仍需电脑确认，“电脑已接收”才表示电脑已经确认。', 'good');
      } catch (error) { note($('transfer-status'), message(error), 'bad'); }
      finally { busy = false; controller = null; render(); }
    };
    win.addEventListener('beforeunload', event => { if (busy || selecting) { event.preventDefault(); event.returnValue = ''; } });
    const hint = endpointHint(win.location.href);
    // Erase URL parameters before any authentication request; no secret ever goes into a link or referrer.
    if (win.location.search || win.location.hash) win.history.replaceState(null, '', win.location.pathname);
    if (hint.invalid) { $('url-warning').hidden = false; $('url-warning').textContent = '链接参数无效，已忽略并清除。不要通过网址传递令牌或密码；请在下方手动确认地址。'; }
    $('endpoint').value = hint.endpoint || DEFAULT_ENDPOINT; controls();
    (async () => {
      const saved = read(SESSION_KEY); if (!saved || hint.invalid || (hint.endpoint && hint.endpoint !== saved.endpoint)) return;
      try {
        const endpoint = normalizeEndpoint(saved.endpoint); authenticating = true; controls();
        if (saved.mode === 'device') { const token = normalizeDeviceToken(saved.token); connect({ mode: 'device', endpoint, token, owner: 'device:' + token.split('.')[2], displayName: '仅上传设备' }, true); }
        else {
          if (saved.mode !== 'account' || typeof saved.token !== 'string' || !saved.token) throw problem('INVALID_SESSION');
          const data = await requestJson(win.fetch.bind(win), endpoint, '/api/auth/me', { token: saved.token });
          if (!data.account?.accountId || data.account.legacy || data.account.accountId !== saved.owner) throw problem('INVALID_SESSION');
          connect({ mode: 'account', endpoint, token: saved.token, owner: data.account.accountId, displayName: data.account.displayName || data.account.username, expiresAt: saved.expiresAt }, true);
        }
      } catch (error) { store(SESSION_KEY, null); note($('connection-status'), message(error) + ' 请重新连接。', 'bad'); }
      finally { authenticating = false; controls(); }
    })();
  }
  return { DEFAULT_ENDPOINT, MAX_BYTES, normalizeEndpoint, endpointHint, normalizeDeviceToken, fileMetadata, validSignature, selectionKey, newRequestId, ticketInput, uploadTarget, checkedItem, requestJson, xhrPut, createUploadClient, persistedJobs, restoreJobs, message, mount };
});
