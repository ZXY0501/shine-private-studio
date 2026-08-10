const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');

test('keeps the v0.28 PSD parser entry unchanged', () => {
  assert.match(html, /async function parsePsd\(file\)\{\s+if\(!window\.agPsd\)throw new Error\('ag-psd 未加载，请联网刷新页面'\);\s+return window\.agPsd\.readPsd\(await file\.arrayBuffer\(\),\{skipThumbnail:true\}\);\s+\}/);
});

test('cloud profiles are opt-in and do not replace local save', () => {
  assert.match(html, /get\('cloudProfiles'\)===\s*'1'/);
  assert.match(html, /panel\.hidden=!CLOUD_PROFILE_ENABLED;\s+if\(!CLOUD_PROFILE_ENABLED\)return;/);
  assert.match(html, /\$\('#saveBindings'\)\.onclick=saveBindingsLocal;/);
  assert.match(html, /读取到云端版本后仍需人工确认才会应用/);
});

test('does not embed Alibaba Cloud access keys', () => {
  assert.doesNotMatch(html, /ALIBABA_CLOUD_ACCESS_KEY_(ID|SECRET)\s*[:=]\s*['"][^'"]+['"]/);
  assert.doesNotMatch(html, /LTAI[A-Za-z0-9]{12,}/);
});

test('new orders default to manual outfit colors and ear-anchored hats', () => {
  assert.match(html, /A:\{[^\n]+outfit:'__CUSTOM__'[^\n]+hat:'__DECOR_ANCHOR__'/);
  assert.match(html, /B:\{[^\n]+outfit:'__CUSTOM__'[^\n]+hat:'__DECOR_ANCHOR__'/);
  assert.match(html, /!o\.A\?\.outfit\?'__CUSTOM__'/);
  assert.match(html, /!o\.B\?\.hat\?'__DECOR_ANCHOR__'/);
});

test('heavy PSD color previews are debounced and final changes are flushed', () => {
  assert.match(html, /const LIVE_COLOR_PREVIEW_DELAY=110;/);
  assert.match(html, /clearTimeout\(S\.liveColorTimer\);\s*S\.liveColorTimer=setTimeout\(paintPendingLiveProductionColors,LIVE_COLOR_PREVIEW_DELAY\)/);
  assert.match(html, /color\.onchange=\(\)=>\{captureActiveOrder\(\);flushLiveProductionColors/);
  assert.match(html, /const QUICK_COLOR_PREVIEW_DELAY=110;/);
  assert.match(html, /setManualLayerOverride\(job\.path,job\.hex,\{persist:false\}\)/);
  assert.match(html, /setManualLayerOverride\(job\.path,job\.hex,\{persist:true\}\)/);
});
