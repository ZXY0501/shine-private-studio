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

test('DeepSeek parsing is authenticated, gray-tested, and falls back locally', () => {
  assert.match(html, /id="deepSeekSettings"/);
  assert.match(html, /apiButton\.hidden=!CLOUD_PROFILE_ENABLED/);
  assert.match(html, /automatic=cloud\.endpoint\?cloud\.endpoint\+'\/api\/deepseek\/parse':''/);
  assert.match(html, /headers\.Authorization=`Bearer \$\{proxy\.token\}`/);
  assert.match(html, /DEEPSEEK_NOT_CONFIGURED:'后端还没有配置 DeepSeek API Key。'/);
  assert.match(html, /const unresolvedFields=localParseForm\(\{announce:false\}\)/);
  assert.match(html, /strategy:'local-first-flash0731-pro0813'/);
  assert.match(html, /if\(!unresolvedFields\.length\).*没有调用 DeepSeek/);
  assert.match(html, /data\.parseMeta\?\.tier==='pro0813'/);
  assert.doesNotMatch(html, /DEEPSEEK_API_KEY\s*[:=]/);
});

test('customer form template residue is not parsed as a customer answer', () => {
  assert.match(html, /约稿人微信id：/);
  assert.match(html, /function characterSection\(text,slot\)/);
  assert.match(html, /function isUnfilledTemplateValue\(name,value\)/);
  assert.ok(html.includes("new RegExp(n+'[ \\\\t]*[：:][ \\\\t]*([^\\\\r\\\\n]*)')"));
  assert.match(html, /请发例图给我/);
  assert.match(html, /保持\\s\*\[\\\/／\]\\s\*更换已有表情/);
  assert.match(html, /field\(a,\['帽子颜色','代表色'\]\)/);
  assert.match(html, /field\(a,\['耳朵类型','帽饰'\]\)/);

  const names = ['parseCustomerName', 'characterSection', 'isUnfilledTemplateValue', 'field'];
  const sources = names.map(name => {
    const start = html.indexOf(`function ${name}(`);
    const end = html.indexOf('\nfunction ', start + 1);
    assert.ok(start >= 0 && end > start, `${name} should be extractable`);
    return html.slice(start, end);
  }).join('\n');
  const helpers = new Function(`${sources}\nreturn {${names.join(',')}};`)();
  const blank = `约稿人微信id：
A：
瞳色：
（如果是国乙男主直接报名字）
衣服颜色：
帽子颜色：
耳朵类型：
（换耳朵➕1r/角色，需填写具体类型）
发型：请发例图给我
表情：保持/更换已有表情/开发新表情
B：
瞳色：`;
  const blankA = helpers.characterSection(blank, 'A');
  assert.equal(helpers.parseCustomerName(blank), '');
  assert.equal(helpers.field(blankA, ['瞳色']), '');
  assert.equal(helpers.field(blankA, ['耳朵类型']), '');
  assert.equal(helpers.field(blankA, ['发型']), '');
  assert.equal(helpers.field(blankA, ['表情']), '');

  const filled = `约稿人微信id：wx_123\nA：\n衣服颜色：红色\n帽子颜色：粉紫\n耳朵类型：狐狸耳\nB：\n衣服颜色：蓝色`;
  const filledA = helpers.characterSection(filled, 'A');
  assert.equal(helpers.parseCustomerName(filled), 'wx_123');
  assert.equal(helpers.field(filledA, ['衣服颜色']), '红色');
  assert.equal(helpers.field(filledA, ['帽子颜色']), '粉紫');
  assert.equal(helpers.field(filledA, ['耳朵类型']), '狐狸耳');
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

test('official hat and outfit palettes are independent and support random purple variants', () => {
  assert.match(html, /const STYLE_SCHEME_KEY='shine:styleSchemes:v0\.14'/);
  assert.match(html, /const OFFICIAL_COLOR_SCHEMES=\{/);
  assert.match(html, /'红色':\{aliases:\['正红','大红','红色'\],hat:\{base:'#B01111',outline:'#610000',trim:'#C47D73'\},outfit:\{base:'#CF5959',line:'#8B5555'\}\}/);
  assert.match(html, /'蓝紫':\{aliases:\['蓝紫'\],hat:\{base:'#E0E2FF',outline:'#B0B3D8',trim:'#CFC1F0'\},outfit:\{base:'#F0E5FF',line:'#B4B1CD'\}\}/);
  assert.match(html, /'粉紫':\{aliases:\['粉紫'\],hat:\{base:'#FFE0FE',outline:'#CDB8D1',trim:'#F0C1EA'\},outfit:\{base:'#FBE5FF',line:'#CDB1CB'\}\}/);
  assert.match(html, /function officialStyleSchemes\(\)/);
  assert.match(html, /if\(\/紫色\/.test\(text\)\&\&!\/\(蓝紫\|粉紫\)\/.test\(text\)\)/);
  assert.match(html, /Math\.floor\(Math\.random\(\)\*candidates\.length\)/);
  assert.match(html, /outfitPresetPalette:styleSchemePalette\('outfit'\)/);
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
  assert.match(html, /a\.enabled=!!chosen&&chosen===assetFamilyKey\(a\)/);
  assert.match(html, /if\(on&&previous&&previous!==familyKey\)clearEarColorAnchors\(slot,order\)/);
});

test('ear selections auto-pair matching tails by animal and A/B slot', () => {
  assert.match(html, /autoTailSelections:\{A:null,B:null\}/);
  assert.match(html, /function assetAnimalKey\(value\)/);
  assert.match(html, /function matchingTailForEar\(earRecord,slot\)/);
  assert.match(html, /function syncTailForEarSelection\(order,slot,earRecord\)/);
  assert.match(html, /if\(current&&auto\[slot\]!==current\)return false/);
  assert.match(html, /if\(on\)syncTailForEarSelection\(order,slot,record\);else clearAutoTailForSlot\(order,slot\)/);
  assert.match(html, /else if\(categoryId==='TAIL'\)\{\s*autoTail\[slot\]=null/);
  assert.match(html, /if\(chosen\)syncTailForEarSelection\(order,slot,chosen\);else clearAutoTailForSlot\(order,slot\)/);
});

test('ear base color anchors the paired tail base without recoloring other tail layers', () => {
  assert.match(html, /\(asset\.categoryId==='EAR'\|\|asset\.categoryId==='TAIL'\)\&\&\(explicitDecorBase\|\|explicitDecorShade\)/);
  assert.match(html, /function sharedDecorRoleColor\(role,slot,order\)/);
  assert.match(html, /role==='DECOR_BASE'\|\|role==='TAIL_BASE'\)return base/);
  assert.match(html, /role==='DECOR_SHADOW'\|\|role==='TAIL_SHADE'\)return shade/);
  assert.match(html, /role==='DECOR_OUTLINE'\|\|role==='TAIL_OUTLINE'\)/);
  assert.match(html, /asset\.categoryId==='TAIL'\&\&!\['TAIL_BASE','TAIL_SHADE','TAIL_OUTLINE'\]\.includes\(role\)/);
  assert.match(html, /TAIL_SHADE/);
  assert.match(html, /const explicitDecor=\(a\.categoryId==='EAR'\|\|a\.categoryId==='TAIL'\)/);
  assert.match(html, /a\.type==='TAIL'/);
});

test('ear fur line remains fixed while the main ear outline links to the hat outline', () => {
  assert.match(html, /绒毛\.\*线稿\|线稿\.\*绒毛\|绒毛线\|fur\.\*line\|line\.\*fur/);
  assert.match(html, /if\(asset\.categoryId==='TAIL'\&\&!\['TAIL_BASE','TAIL_SHADE','TAIL_OUTLINE'\]\.includes\(role\)\)continue/);
  assert.match(html, /if\(!role\|\|role==='NONE'\|\|role==='DECOR_FUR'\)continue/);
  assert.match(html, /if\(role==='DECOR_OUTLINE'\|\|role==='TAIL_OUTLINE'\)\{/);
  assert.match(html, /const linked=decorOutlineColor\(slot,order\);if\(linked\)return linked/);
  assert.match(html, /有耳朵时帽子线稿与耳朵线稿强制联动/);
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
  assert.match(html, /asset\.categoryId==='EAR'\|\|asset\.categoryId==='TAIL'/);
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

test('asset free transform works from the whole preview area and stays independent per order', () => {
  assert.match(html, /function wirePreviewFreeTransform\(\)/);
  assert.match(html, /body\.addEventListener\('pointerdown'/);
  assert.match(html, /body\.addEventListener\('pointermove'/);
  assert.match(html, /shine:asset-transform:/);
  assert.match(html, /assetTransforms:\{\}/);
  assert.match(html, /order\.assetTransforms\[id\]/);
  assert.match(html, /order\.assetTransforms\[assetStackId\(a\)\]=\{\.\.\.assetTransformForTemplate\(a\)\}/);
  assert.match(html, /assetPlacements:Object\.fromEntries/);
  assert.match(html, /function drawAssetTransformed\(ctx,a\)/);
  assert.match(html, /id="assetTransformScale"/);
  assert.match(html, /id="assetTransformRotation"/);
  assert.match(html, /id="assetTransformFlip"/);
  assert.match(html, /id="assetTransformFlipY"/);
  assert.match(html, /class="libraryTransformTitle">整体调整素材/);
  assert.match(html, /assetSourceName\(a\)\+' · '\+a\.slot\+' 位/);
  assert.match(html, /Math\.max\(\.05,Math\.min\(5/);
  assert.match(html, /\(t\.flipY\?-1:1\)\*scale/);
  assert.match(html, /function beginAssetTransformPreview\(a\)/);
  assert.match(html, /renderMasterWithRootStack\(assetStackId\(a\)\)/);
  assert.match(html, /function renderFastAssetTransformPreview\(\)/);
  assert.match(html, /function finishAssetTransformPreview\(\)/);
});

test('phase two automatically keeps templates and assets in IndexedDB with lazy restore', () => {
  assert.match(html, /const LOCAL_LIBRARY_DB='shine-phase2-library'/);
  assert.match(html, /indexedDB\.open\(LOCAL_LIBRARY_DB,LOCAL_LIBRARY_DB_VERSION\)/);
  assert.match(html, /createObjectStore\('assetSources'/);
  assert.match(html, /createObjectStore\('assetCatalog'/);
  assert.match(html, /createObjectStore\('templateSources'/);
  assert.match(html, /createObjectStore\('templateCatalog'/);
  assert.match(html, /async function persistAssetFamilyLocal\(familyKey\)/);
  assert.match(html, /async function hydrateLocalAsset\(record\)/);
  assert.match(html, /function assetRelevantLeaves\(asset\)\{\s*if\(!asset\?\.psd\)return \[\]/);
  assert.match(html, /localOnly:true/);
  assert.match(html, /async function persistMasterLocal\(file,psd,signature\)/);
  assert.match(html, /async function restoreLocalTemplate\(signature\)/);
  assert.match(html, /initLocalPersistence\(\);/);
  assert.match(html, /保存当前纯净模板到云端/);
});

test('dedicated hair uploads stay reusable and isolated even when two orders use the same filename', () => {
  const hairLoader = html.match(/async function loadHairAsset\(file,slot\)[\s\S]+?\/\/ ===== v0\.16/)?.[0] || '';
  assert.match(html, /async function loadHairAsset\(file,slot\)/);
  assert.match(html, /upsertAssetRecord\(asset\)/);
  assert.match(html, /ensureOrderAssetSelections\(active\)\[slot\]\.HAIR=assetFamilyKey\(asset\)/);
  assert.match(html, /queuePersistAssetFamilyLocal\(assetFamilyKey\(asset\),40\)/);
  assert.match(html, /function assetFamilyKey\(a\)\{ensureAssetRecordV2\(a\);return a\.categoryId==='HAIR'\?`HAIR::\$\{a\.assetId\}`/);
  assert.match(html, /const idx=S\.assets\.findIndex\(a=>a\.assetId===rec\.assetId&&a\.slot===rec\.slot\)/);
  assert.doesNotMatch(hairLoader, /previous|sameVariant/);
  assert.doesNotMatch(html, /S\.assets=S\.assets\.filter\(a=>!\(a\.type==='HAIR'&&a\.slot===slot\)\)/);
});

test('asset selection yields before rendering and avoids full library and disabled-asset recomposition', () => {
  assert.match(html, /function syncAssetLibrarySelectionUi\(order=getActiveOrder\(\)\)/);
  assert.match(html, /await new Promise\(resolve=>setTimeout\(resolve,0\)\)/);
  assert.match(html, /if\(a\.enabled&&\(a\.type==='HAT_DECOR'\|\|a\.type==='HAIR'\|\|a\.type==='TAIL'\|\|a\.type==='FRAME'\)\)prepareAssetCompositeForOrder/);
  assert.match(html, /requestIdleCallback\(save,\{timeout:1800\}\)/);
  assert.match(html, /已切换素材 · \$\{Math\.max\(1,Math\.round\(performance\.now\(\)-started\)\)\} ms/);
});

test('hat presets default to manual color while retaining optional ear anchoring', () => {
  assert.match(html, /hat:'__CUSTOM__',hatManual:'#C85B5B'/);
  assert.match(html, /kind==='hat'\)html\+='[^']*__CUSTOM__[^']*__DECOR_ANCHOR__/);
  assert.match(html, /hatCustom\?order\[slot\]\?\.hatManual/);
  assert.match(html, /class="presetColorInline"/);
  assert.match(html, /if\(wrap\)wrap\.style\.display='grid'/);
});

test('form cleaning keeps A and B cards side by side on the desktop workspace', () => {
  assert.match(html, /className='formBabyPair'/);
  assert.match(html, /\.formBabyPair\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(html, /minmax\(0,\.82fr\) 92px minmax\(0,1\.18fr\)/);
});

test('selected local assets warm in the background with immediate loading feedback', () => {
  assert.match(html, /setTimeout\(warmCurrentOrderAssets,30\)/);
  assert.match(html, /function warmCurrentOrderAssets\(\)/);
  assert.match(html, /record\._loading=true;renderAssetLibrary\(\);renderTransformControls\(\)/);
  assert.match(html, /正在打开 PSD/);
});

test('pale white and pink hats use a darker low-chroma outline', () => {
  assert.match(html, /function isPalePinkOrWhiteHat\(base\)/);
  assert.match(html, /function paleHatOutlineColor\(base\)/);
  assert.match(html, /if\(isPalePinkOrWhiteHat\(hat\)\)return paleHatOutlineColor\(hat\)/);
  assert.match(html, /Math\.min\(\.038,o\.C\*\.34\)/);
});

test('hat outline never derives from eye color', () => {
  const start = html.indexOf("if(role==='HAT_OUTLINE')");
  const end = html.indexOf("if(role==='HAT_TRIM_EDGE')", start);
  assert.ok(start >= 0 && end > start, 'hat outline branch should exist');
  const branch = html.slice(start, end);
  assert.doesNotMatch(branch, /shiftColor\(eye/);
  assert.match(branch, /isNearWhite\(hat\)\)return shiftColor\(hat,-0\.17,0\.72\)/);
});

test('single-layer adjustment only lists enabled A or B asset instances', () => {
  assert.match(html, /\(S\.assets\|\|\[\]\)\.filter\(a=>a\.enabled\)\.forEach\(a=>\{/);
  assert.match(html, /const prefix=`\[\$\{a\.slot\} \$\{categoryLabel\(a\.type\)\}\] `/);
});

test('selecting a tail or other asset refreshes single-layer adjustment immediately', () => {
  assert.match(html, /S\.selectedTransformStackId=assetStackId\(record\);renderHairInsertionControls\(\);reconstruct\(\);renderAssetRuntimeStatus\(\);renderEditableLayerSelectors\(\)/);
});

test('root layer stack order is isolated per order', () => {
  assert.match(html, /active&&Object\.prototype\.hasOwnProperty\.call\(active,'rootStackOrder'\)/);
  assert.match(html, /active\.rootStackOrder=clone\(S\.rootStackOrder\);persistOrders\(\)/);
  assert.match(html, /loadRootStackOrder\(\);syncAssetEnabledFromOrder\(o\)/);
});

test('switching orders reapplies the selected order color scheme', () => {
  const start = html.indexOf('function selectOrder(id)');
  const end = html.indexOf('function captureActiveOrder()', start);
  assert.ok(start >= 0 && end > start, 'selectOrder should exist');
  const branch = html.slice(start, end);
  assert.match(branch, /S\.liveColorPending=null/);
  assert.match(branch, /if\(S\.master\)applyOrderColors\(\{live:true,persist:false\}\)/);
});

test('completed orders can be deleted without deleting library assets', () => {
  assert.match(html, /id="deleteOrder"/);
  assert.match(html, /function deleteActiveOrder\(\)/);
  assert.match(html, /S\.exportHistory=S\.exportHistory\.filter\(x=>x\.orderId!==order\.id\)/);
  assert.match(html, /S\.orders=S\.orders\.filter\(x=>x\.id!==order\.id\)/);
  assert.match(html, /不会删除素材库素材/);
  assert.match(html, /#deleteOrder'\)\.onclick=deleteActiveOrder/);
});

test('template fingerprints separate same-structure PSD revisions', () => {
  assert.match(html, /async function templateSigForFile\(file\)/);
  assert.match(html, /crypto\.subtle\.digest\('SHA-256',raw\)/);
  assert.match(html, /S\.templateSignature=await templateSigForFile\(file\)/);
  assert.match(html, /templateSources',\{signature,file\}/);
  assert.match(html, /order\?\.templateSignature===signature/);
  assert.match(html, /order\.layerOverrides=\{\};order\.rootStackOrder=\[\];order\.assetTransforms=\{\}/);
  assert.match(html, /restoreOrderTemplateState\(getActiveOrder\(\),S\.templateSignature\);persistOrders\(\)/);
  assert.match(html, /await loadMaster\(file\);try\{localStorage\.setItem\(LOCAL_LAST_TEMPLATE_KEY,S\.templateSignature\|\|signature\)/);
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
