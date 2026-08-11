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

test('new orders default to manual outfit and hat colors', () => {
  assert.match(html, /A:\{[^\n]+outfit:'__CUSTOM__'[^\n]+hat:'__CUSTOM__'/);
  assert.match(html, /B:\{[^\n]+outfit:'__CUSTOM__'[^\n]+hat:'__CUSTOM__'/);
  assert.match(html, /!o\.A\?\.outfit\?'__CUSTOM__'/);
  assert.match(html, /!o\.A\?\.hat\?'__CUSTOM__'/);
  assert.match(html, /!o\.B\?\.hat\?'__CUSTOM__'/);
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
  assert.match(html, /id:'FRAME',name:'边框'/);
  assert.match(html, /id:'ACCESSORY',name:'配饰'/);
  assert.match(html, /function persistAssetCategories\(\)/);
  assert.match(html, /data-ak="category"/);
});

test('frame assets can stack, move front or back, and sample four colors from the preview', () => {
  assert.match(html, /frameSelections:\[\]/);
  assert.match(html, /function frameStackIds\(placement,order=getActiveOrder\(\)\)/);
  assert.match(html, /data-ak="frame-check"/);
  assert.match(html, /data-ak="frame-placement"/);
  assert.match(html, /FRAME_RIBBON_A/);
  assert.match(html, /FRAME_RIBBON_B/);
  assert.match(html, /FRAME_FLOWER_BASE/);
  assert.match(html, /FRAME_FLOWER_SHADE/);
  assert.match(html, /function armPreviewEyedrop\(familyKey,field\)/);
  assert.match(html, /function sampleCanvasMedianColor\(canvas,clientX,clientY,radius=3\)/);
  assert.match(html, /addedAt:Number\(x\.addedAt\)/);
  assert.match(html, /if\(el\.value==='FRAME'&&records\.length>1\)/);
  assert.match(html, /keep\.groupPath=null/);
});

test('asset families can be selected independently for A and B', () => {
  assert.match(html, /assetSelections:\{A:\{\},B:\{\}\}/);
  assert.match(html, /data-ak="slot-check"/);
  assert.match(html, /function setAssetFamilySelection\(familyKey,slot,on\)/);
  assert.match(html, /characterCompatibility/);
});

test('uploaded asset PSD layers can be shown or hidden without mutating the source PSD', () => {
  assert.match(html, /function assetLayerVisible\(asset,layer,path\)/);
  assert.match(html, /data-avpath=/);
  assert.match(html, /恢复 PSD 显隐/);
  assert.match(html, /a\.layerVisibility\[el\.dataset\.avpath\]=el\.checked/);
  assert.match(html, /renderAssetSiblingStack\(asset,psd,ctx/);
  assert.match(html, /familyLayerVisibility=Object\.assign\(\{\},\.\.\.records\.map\(a=>a\.layerVisibility\|\|\{\}\)\)/);
  assert.match(html, /function assetLayerEffectivelyVisible\(asset,node\)/);
  assert.doesNotMatch(html, /\.layer\.hidden\s*=/);
});

test('ear assets keep original colors until an explicit form color anchors the ear and hat', () => {
  assert.match(html, /耳朵底色（空=原色）/);
  assert.match(html, /function fillDecorFallbackBindings\(asset\)/);
  assert.match(html, /asset\.bindings\[base\.n\.path\]='DECOR_BASE'/);
  assert.match(html, /asset\.categoryId==='EAR'&&\(explicitDecorBase\|\|explicitDecorShade\)/);
  assert.match(html, /function syncEarColorAnchorUi\(slot,order=getActiveOrder\(\)\)/);
  assert.match(html, /hatAnchor=order\[slot\]\?\.hat==='__DECOR_ANCHOR__'/);
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
  assert.match(html, /data-at-action="flipX"/);
  assert.match(html, /data-at-action="flipY"/);
  assert.match(html, /data-ak="transform"/);
  assert.match(html, /Math\.max\(\.05,Math\.min\(5/);
  assert.match(html, /\(t\.flipY\?-1:1\)\*scale/);
  assert.match(html, /function beginAssetTransformPreview\(a\)/);
  assert.match(html, /renderMasterWithRootStack\(assetStackId\(a\)\)/);
  assert.match(html, /function renderFastAssetTransformPreview\(\)/);
  assert.match(html, /function finishAssetTransformPreview\(\)/);
});

test('hat presets default to manual color while retaining optional ear anchoring', () => {
  assert.match(html, /hat:'__CUSTOM__',hatManual:'#C85B5B'/);
  assert.match(html, /kind==='hat'\)html\+='[^']*__CUSTOM__[^']*__DECOR_ANCHOR__/);
  assert.match(html, /hatCustom\?order\[slot\]\?\.hatManual/);
});

test('pale white and pink hats use a darker low-chroma outline', () => {
  assert.match(html, /function isPalePinkOrWhiteHat\(base\)/);
  assert.match(html, /function paleHatOutlineColor\(base\)/);
  assert.match(html, /if\(isPalePinkOrWhiteHat\(hat\)\)return paleHatOutlineColor\(hat\)/);
  assert.match(html, /Math\.min\(\.038,o\.C\*\.34\)/);
});

test('single-layer adjustment only lists enabled A or B asset instances', () => {
  assert.match(html, /\(S\.assets\|\|\[\]\)\.filter\(a=>a\.enabled\)\.forEach\(a=>\{/);
  assert.match(html, /const prefix=`\[\$\{a\.slot\} \$\{categoryLabel\(a\.type\)\}\] `/);
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
  assert.match(html, /if\(!S\.master\|\|S\.exportBusy\)return;S\.exportBusy=true/);
  assert.match(html, /format==='png'\?requestedPromise:canvasBlob\(c,'image\/png'\)/);
  assert.match(html, /copyCanvasImageToClipboard\(c,clipboardPng\)/);
});

test('standardized Chinese asset names are inferred without changing the PSD parser', () => {
  assert.match(html, /n\.includes\('FRAME'\)\|\|n\.includes\('边框'\)/);
  assert.match(html, /n\.includes\('HAIR'\)\|\|n\.includes\('头发'\)/);
  assert.match(html, /n\.includes\('MOUTH'\)\|\|n\.includes\('嘴'\)\|\|n\.includes\('表情'\)/);
  assert.match(html, /\(\?:模板\|耳朵\|头发\|帽饰\|嘴巴\|表情\|尾巴\|小物\|配饰\|边框/);
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

test('Eye Scheme keeps the phase-one one-color pupil workflow as a built-in option', () => {
  assert.match(html, /value="LEGACY_AUTO">一期傻瓜模式（瞳孔跟随主色）/);
  assert.match(html, /function legacyEyeRoleColor\(role,slot,order\)/);
  assert.match(html, /shiftColor\(eye,g\.eyePupilL,g\.eyePupilC\)/);
  assert.match(html, /eyeSchemeId==='LEGACY_AUTO'/);
  assert.match(html, /advanced\.hidden=legacy/);
  assert.match(html, /syncEyeSchemeModeUi\('A'\)/);
  assert.match(html, /syncEyeSchemeModeUi\('B'\)/);
});

test('the main inline browser program parses as JavaScript', () => {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1])
    .filter(source => source.trim());
  assert.ok(scripts.length > 0);
  assert.doesNotThrow(() => new Function(scripts.at(-1)));
});
