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
  assert.match(html, /panel\.hidden=!CLOUD_PROFILE_ENABLED/);
  assert.match(html, /cloudAssetPanel'\)\)\$\('#cloudAssetPanel'\)\.hidden=!CLOUD_PROFILE_ENABLED/);
  assert.match(html, /if\(!CLOUD_PROFILE_ENABLED\)return;/);
  assert.match(html, /\$\('#saveBindings'\)\.onclick=saveBindingsLocal;/);
  assert.match(html, /读取到云端版本后仍需人工确认才会应用/);
});

test('cloud assets use authenticated short-lived upload tickets and lazy source downloads', () => {
  assert.match(html, /cloudAssetRequest\('\/api\/assets\/upload-ticket',\{method:'POST'/);
  assert.match(html, /fetch\(ticket\.uploadUrl,\{method:'PUT'/);
  assert.match(html, /cloudAssetRequest\(`\/api\/assets\/\$\{encodeURIComponent\(ticket\.assetId\)\}\/complete`/);
  assert.match(html, /cloudAssetRequest\(`\/api\/assets\/\$\{encodeURIComponent\(record\.assetId\)\}\/source`\)/);
  assert.match(html, /colorMode:'PRESERVE_ORIGINAL'/);
  assert.match(html, /cloudOnly:true/);
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

test('advanced horizontal controls stay disabled until a template can scroll', () => {
  assert.match(html, /id="treeHScroll"[^>]+disabled/);
  assert.match(html, /id="builderHScroll"[^>]+disabled/);
  assert.match(html, /const m=maxNow\(\),ready=!!S\.master&&m>1/);
  assert.match(html, /scroller\.scrollLeft=m\*\(pct\/100\)/);
  assert.match(html, /请先上传纯净模板；当前没有图层内容可以横向查看/);
});

test('newly uploaded assets preserve their PSD colors by default', () => {
  assert.match(html, /schemaVersion:'shine-asset-v2'/);
  assert.match(html, /renderMode:'overlay'[^;]+colorMode:'PRESERVE_ORIGINAL'/);
  assert.match(html, /if\(asset\.colorMode==='FOLLOW_ORDER'\)\{/);
  assert.match(html, /data-ak="colorMode"[^>]+type="checkbox"/);
  assert.match(html, /跟随订单配色（默认关闭）/);
  assert.match(html, /asset\.originalComposite=renderAssetComposite[^;]+;asset\.composite=asset\.originalComposite/);
});

test('phase two library exposes reusable categories and custom groups', () => {
  assert.match(html, /const ASSET_CATEGORY_KEY='shine:asset-categories:v2'/);
  assert.match(html, /id:'CLEAN_TEMPLATE',name:'纯净模板'/);
  assert.match(html, /id:'EAR',name:'耳朵'/);
  assert.match(html, /id:'MOUTH',name:'嘴巴表情'/);
  assert.match(html, /id:'ACCESSORY',name:'配饰'/);
  assert.match(html, /function persistAssetCategories\(\)/);
  assert.match(html, /data-ak="category"/);
});

test('asset families can be selected independently for A and B', () => {
  assert.match(html, /assetSelections:\{A:\{\},B:\{\}\}/);
  assert.match(html, /data-ak="slot-check"/);
  assert.match(html, /function setAssetFamilySelection\(familyKey,slot,on\)/);
  assert.match(html, /characterCompatibility/);
});

test('phase two uses manual virtual slots instead of PSD slot markers', () => {
  assert.match(html, /模板插槽 \/ 大夹子顺序 · 可直接拖动/);
  assert.match(html, /无需在 PSD 里写插槽提示/);
  assert.match(html, /function assetStackId\(a\)/);
  assert.match(html, /function assetIsInternallyInserted\(asset\)/);
  assert.match(html, /const asset=assetFromStackId\(id\)/);
  assert.doesNotMatch(html, /@SLOT/);
});

test('asset free transform works from the whole preview area and persists per template', () => {
  assert.match(html, /function wirePreviewFreeTransform\(\)/);
  assert.match(html, /body\.addEventListener\('pointerdown'/);
  assert.match(html, /body\.addEventListener\('pointermove'/);
  assert.match(html, /shine:asset-transform:/);
  assert.match(html, /assetPlacements:Object\.fromEntries/);
  assert.match(html, /function drawAssetTransformed\(ctx,a\)/);
  assert.match(html, /id="assetTransformScale"/);
  assert.match(html, /id="assetTransformRotation"/);
});

test('hat presets keep ear anchoring and allow a manual color', () => {
  assert.match(html, /hat:'__DECOR_ANCHOR__',hatManual:'#C85B5B'/);
  assert.match(html, /kind==='hat'\)html\+='[^']*__DECOR_ANCHOR__[^']*__CUSTOM__/);
  assert.match(html, /hatCustom\?order\[slot\]\?\.hatManual/);
});

test('session export history stays in tab memory and records every PNG or JPEG output', () => {
  assert.match(html, /exportHistory:\[\]/);
  assert.match(html, /function recordSessionExport\(order,blob,format,showWatermark,fileName\)/);
  assert.match(html, /while\(mine\.length>8\)/);
  assert.match(html, /recordSessionExport\(o,requested,format,showWatermark,fileName\)/);
  assert.match(html, /recordSessionExport\(order,blob,'png'/);
  assert.match(html, /recordSessionExport\(order,blob,'jpeg'/);
  assert.match(html, /beforeunload[^\n]+S\.exportHistory\.forEach\(releaseSessionExport\)/);
  assert.doesNotMatch(html, /localStorage\.setItem\([^\n]*exportHistory/);
});

test('Eye Scheme v2 uses two anchors, complete field modes, and protects fixed highlights', () => {
  assert.match(html, /schemaVersion:'shine-eye-scheme-v2'/);
  assert.match(html, /\['irisBase','虹膜主色'\]/);
  assert.match(html, /\['pupil','瞳孔点缀'\]/);
  assert.match(html, /\['pupilDark','瞳孔暗部'\]/);
  assert.match(html, /\['lashHighlight','睫毛高光'\]/);
  assert.match(html, /\['DERIVED','FIXED','INDEPENDENT'\]/);
  assert.match(html, /pupilAccent:'#E6F9FF'/);
  assert.match(html, /pupilAccent:'#FFD6A6'/);
  assert.match(html, /space:'HSL'/);
  assert.match(html, /saturationMultiplier:left\?0\.38:0\.52/);
  assert.match(html, /b\.role==='EYE_PUPIL_HIGHLIGHT'\|\|b\.role==='PUPIL_HIGHLIGHT_FIXED'\)\{b\.locked=true;b\.source='FIXED'/);
});

test('the main inline browser program parses as JavaScript', () => {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1])
    .filter(source => source.trim());
  assert.ok(scripts.length > 0);
  assert.doesNotThrow(() => new Function(scripts.at(-1)));
});
