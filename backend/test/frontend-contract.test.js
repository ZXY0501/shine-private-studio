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
  assert.match(html, /const localUnresolved=localParseForm\(\{announce:false\}\)/);
  assert.match(html, /\.\.\.apiReviewFields\(text\)/);
  assert.match(html, /strategy:'local-first-flash0731-pro0813'/);
  assert.match(html, /if\(!unresolvedFields\.length\).*没有可交给 DeepSeek 复核的表单字段/);
  assert.match(html, /data\.parseMeta\?\.tier==='pro0813'/);
  assert.match(html, /decorCatalog:earDecorCatalog\(\)/);
  assert.match(html, /bestUploadedEarVariant\(original,slot,o\[slot\]\.decor\)\|\|bestUploadedEarVariant\(d\.decor,slot,o\[slot\]\.decor\)/);
  assert.match(html, /paletteEye=formAnchorHex\(field\(sec,\['瞳色'\]\),'eye'\)/);
  assert.match(html, /if\(paletteEye\)o\[slot\]\.eye=paletteEye;else if\(d\.eyeHex/);
  assert.match(html, /const PRODUCTION_BACKEND_ENDPOINT='https:\/\/shine-backend-uxgyzdvkcv\.cn-hangzhou\.fcapp\.run'/);
  assert.match(html, /PRODUCTION_DEEPSEEK_ENDPOINT=PRODUCTION_BACKEND_ENDPOINT\+'\/api\/deepseek\/parse'/);
  assert.match(html, /localStorage\.getItem\(CLOUD_PROFILE_ENDPOINT_KEY\)\|\|PRODUCTION_BACKEND_ENDPOINT/);
  assert.doesNotMatch(html, /DEEPSEEK_API_KEY\s*[:=]/);
});

test('form ear descriptions select the closest uploaded animal and pose variant', () => {
  const names = ['normalizeVariantName', 'earIntentSignature', 'uploadedEarVariants', 'earCandidateVariants', 'bestUploadedEarVariant', 'earDecorCatalog', 'matchDecor'];
  const sources = names.map(name => {
    const start = html.indexOf(`function ${name}(`);
    const end = html.indexOf('\nfunction ', start + 1);
    assert.ok(start >= 0 && end > start, `${name} should be extractable`);
    return html.slice(start, end);
  }).join('\n');
  const S = { assets: [
    { categoryId: 'EAR', variant: '趴狗耳', slot: 'A' },
    { categoryId: 'EAR', variant: '立狗耳', slot: 'A' },
    { categoryId: 'EAR', variant: '立猫耳', slot: 'B' },
    { categoryId: 'EAR', variant: '细猫', slot: 'B' },
    { categoryId: 'TAIL', variant: '趴狗尾' }
  ] };
  const helpers = new Function('S', `${sources}\nreturn {${names.join(',')}};`)(S);
  assert.equal(helpers.matchDecor('小狗耳  趴着的', 'A'), '趴狗耳');
  assert.equal(helpers.matchDecor('猫耳  立着的', 'B'), '立猫耳');
  assert.equal(helpers.bestUploadedEarVariant('狗耳', 'A'), '趴狗耳', 'generic animal should use the first compatible uploaded variant');
  assert.equal(helpers.bestUploadedEarVariant('猫', 'B'), '立猫耳', 'generic cat should resolve to the first B-compatible cat asset');
  assert.equal(helpers.bestUploadedEarVariant('猫', 'B', '细猫'), '细猫', 'generic cat should keep the current compatible variant');
  assert.equal(helpers.bestUploadedEarVariant('趴狗耳', 'B'), null, 'slot without that uploaded ear should not be selected');
  assert.deepEqual(helpers.earCandidateVariants('狗耳', 'A'), ['趴狗耳', '立狗耳']);
  assert.deepEqual(helpers.earDecorCatalog().slice(0, 5), ['NONE', '趴狗耳', '立狗耳', '立猫耳', '细猫']);
});

test('ear switching is atomic per slot and keeps the previous selection when unavailable', () => {
  const names = ['earAssetRecordForSlot', 'setOrderEarVariant'];
  const sources = names.map(name => {
    const start = html.indexOf(`function ${name}(`);
    const end = html.indexOf('\nfunction ', start + 1);
    assert.ok(start >= 0 && end > start, `${name} should be extractable`);
    return html.slice(start, end);
  }).join('\n');
  const fluffyA = { categoryId: 'EAR', slot: 'A', variant: '蓬松猫' };
  const records = new Map([['EAR::蓬松猫|A', fluffyA]]);
  const tailSyncs = [];
  const S = { assets: [fluffyA], autoDecorSlots: { A: null, B: null } };
  const helpers = new Function(
    'S','normalizeVariantName','assetRecordForFamilySlot','sameVariant','ensureOrderAssetSelections',
    'clearEarColorAnchors','clearAutoTailForSlot','assetFamilyKey','syncTailForEarSelection',
    `${sources}\nreturn {${names.join(',')}};`
  )(
    S,
    value => String(value || '').trim(),
    (key, slot) => records.get(`${key}|${slot}`) || null,
    (a, b) => a === b,
    order => order.assetSelections,
    () => {},
    () => {},
    record => `EAR::${record.variant}`,
    (order, slot, record) => tailSyncs.push([slot, record.variant])
  );
  const order = {
    A: { decor: '趴狗耳' }, B: { decor: '细猫' },
    assetSelections: { A: { EAR: 'EAR::趴狗耳' }, B: { EAR: 'EAR::细猫' } }
  };
  const selected = helpers.setOrderEarVariant(order, 'A', '蓬松猫', { source: 'manual' });
  assert.equal(selected.ok, true);
  assert.equal(order.A.decor, '蓬松猫');
  assert.equal(order.assetSelections.A.EAR, 'EAR::蓬松猫');
  assert.deepEqual(tailSyncs, [['A', '蓬松猫']]);

  const before = structuredClone(order.B);
  const beforeFamily = order.assetSelections.B.EAR;
  const unavailable = helpers.setOrderEarVariant(order, 'B', '蓬松猫', { source: 'manual' });
  assert.equal(unavailable.ok, false);
  assert.deepEqual(order.B, before);
  assert.equal(order.assetSelections.B.EAR, beforeFamily);
});

test('customer form template residue is not parsed as a customer answer', () => {
  assert.match(html, /约稿人微信id：/);
  assert.match(html, /function characterSection\(text,slot\)/);
  assert.match(html, /function isUnfilledTemplateValue\(name,value\)/);
  assert.ok(html.includes("new RegExp(n+'[ \\\\t]*[：:][ \\\\t]*([^\\\\r\\\\n]*)')"));
  assert.match(html, /请发例图给我/);
  assert.match(html, /保持\\s\*\[\\\/／\]\\s\*更换已有表情/);
  assert.match(html, /field\(a,\['帽子颜色','代表色','帽子'\]\)/);
  assert.match(html, /field\(a,\['耳朵类型','帽饰','耳朵'\]\)/);

  const names = ['parseCustomerName', 'characterSection', 'isUnfilledTemplateValue', 'field', 'splitEarAnswer', 'explicitFormHex', 'formPresetAnchor', 'formAnchorHex', 'apiReviewFields', 'normalizeHex'];
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

  const inlineNames = `约稿人微信id：她的虎牙很可爱
A：王橹杰
瞳色：棕色
（如果是国乙男主直接报名字）
衣服颜色：蓝色
帽子颜色：浅粉色
耳朵类型：小狗耳  趴着的
耳朵颜色：白色
发色：黑色
发型：请发例图给我
表情：丹凤眼  有点呆

B：穆祉丞
瞳色：棕色
衣服颜色：粉色
帽子颜色：浅蓝色
耳朵类型：猫耳  立着的
耳朵颜色：白色
发色：黑色
发型：请发例图给我
表情：圆眼  比较可爱`;
  const inlineA = helpers.characterSection(inlineNames, 'A');
  const inlineB = helpers.characterSection(inlineNames, 'B');
  assert.equal(helpers.parseCustomerName(inlineNames), '她的虎牙很可爱');
  assert.equal(helpers.field(inlineA, ['名字']), '王橹杰');
  assert.equal(helpers.field(inlineB, ['名字']), '穆祉丞');
  assert.equal(helpers.field(inlineA, ['衣服颜色']), '蓝色');
  assert.equal(helpers.field(inlineB, ['帽子颜色']), '浅蓝色');
  assert.equal(helpers.formAnchorHex(helpers.field(inlineA, ['瞳色']), 'eye'), '#8B6249');
  assert.equal(helpers.formAnchorHex(helpers.field(inlineB, ['发色']), 'hair'), '#2B2830');
  assert.equal(helpers.formAnchorHex(helpers.field(inlineA, ['耳朵颜色']), 'decor'), '#FFFFFF');
  assert.equal(helpers.formAnchorHex('浅黄色', 'eye'), '#A47A2F');
  assert.deepEqual(helpers.apiReviewFields(inlineNames), [
    'customerName','A.name','A.eyeHex','A.hairHex','A.outfitPreset','A.hatPreset','A.decor',
    'B.name','B.eyeHex','B.hairHex','B.outfitPreset','B.hatPreset','B.decor','backgroundPreset'
  ]);

  const shortForm = `A
瞳色:深黄
衣服:黄色
帽子:黄色
耳朵:小狗耳，黄色
发色:奶金色
表情:保持
B
瞳色:深蓝
衣服:蓝色
帽子:蓝色
耳朵:小猫耳
发色:浅金色
表情:保持`;
  const shortA = helpers.characterSection(shortForm, 'A'), shortB = helpers.characterSection(shortForm, 'B');
  assert.equal(helpers.field(shortA, ['衣服颜色','衣服']), '黄色');
  assert.equal(helpers.field(shortB, ['帽子颜色','代表色','帽子']), '蓝色');
  assert.deepEqual(helpers.splitEarAnswer(helpers.field(shortA, ['耳朵类型','帽饰','耳朵'])), { type: '小狗耳', color: '黄色' });
  assert.deepEqual(helpers.splitEarAnswer(helpers.field(shortB, ['耳朵类型','帽饰','耳朵'])), { type: '小猫耳', color: '' });
  assert.equal(helpers.formAnchorHex(helpers.field(shortA, ['瞳色']), 'eye'), '#86611F');
  assert.equal(helpers.formAnchorHex(helpers.field(shortB, ['瞳色']), 'eye'), '#3E608D');
  assert.equal(helpers.formAnchorHex(helpers.field(shortA, ['发色']), 'hair'), '#C9AA76');
  assert.equal(helpers.formAnchorHex(helpers.field(shortB, ['发色']), 'hair'), '#D8BC82');
  assert.equal(helpers.formAnchorHex('黄色', 'decor'), '#FFF8EB');
  assert.equal(helpers.formAnchorHex('蓝色', 'decor'), '#E5F6FF');
  assert.equal(helpers.formAnchorHex('粉红', 'eye'), '#AA7890');
  assert.equal(helpers.formAnchorHex('薄荷绿', 'decor'), '#EBFFFA');
  assert.ok(helpers.apiReviewFields(shortForm).includes('A.hatPreset'));
  assert.ok(helpers.apiReviewFields(shortForm).includes('B.decor'));
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

test('single-character pink answers resolve B hat and outfit without stealing pink-purple', () => {
  const names = ['characterSection', 'isUnfilledTemplateValue', 'field', 'matchPreset'];
  const sources = names.map(name => {
    const start = html.indexOf(`function ${name}(`);
    const end = html.indexOf('\nfunction ', start + 1);
    assert.ok(start >= 0 && end > start, `${name} should be extractable`);
    return html.slice(start, end);
  }).join('\n');
  const helpers = new Function('S', `${sources}\nreturn {${names.join(',')}};`)({
    styleSchemes: {
      hat: [
        { id: 'pink-purple-hat', name: '粉紫', aliases: ['粉紫'] },
        { id: 'pink-hat', name: '粉色', aliases: ['浅粉色', '粉色'] }
      ],
      outfit: [
        { id: 'pink-purple-outfit', name: '粉紫', aliases: ['粉紫'] },
        { id: 'pink-outfit', name: '粉色', aliases: ['浅粉色', '粉色'] }
      ]
    },
    presets: {}
  });
  const form = `约稿人微信id：乖令、
A：
帽子颜色：灰
耳朵类型：兔双立
B：
衣服颜色：粉
帽子颜色：粉
耳朵类型：猫`;
  const b = helpers.characterSection(form, 'B');
  assert.equal(helpers.field(b, ['帽子颜色']), '粉');
  assert.equal(helpers.matchPreset(helpers.field(b, ['帽子颜色']), 'hat'), 'pink-hat');
  assert.equal(helpers.matchPreset(helpers.field(b, ['衣服颜色']), 'outfit'), 'pink-outfit');
  assert.equal(helpers.matchPreset('浅粉', 'hat'), 'pink-hat');
  assert.equal(helpers.matchPreset('粉紫', 'hat'), 'pink-purple-hat');
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
  assert.match(html, /function setOrderEarVariant\(order,slot,variant,\{source='auto'\}=\{\}\)/);
  assert.match(html, /order\[slot\]\.decor=record\.variant;selections\[slot\]\.EAR=assetFamilyKey\(record\)/);
  assert.match(html, /syncTailForEarSelection\(order,slot,record\)/);
  assert.match(html, /setOrderEarVariant\(o,slot,hit,\{source:'local'\}\)/);
  assert.match(html, /setOrderEarVariant\(o,slot,requested,\{source:'api'\}\)/);
  assert.match(html, /const families=uploadedEarVariants\(slot\)/);
  assert.match(html, /已保留原来的耳朵和尾巴/);
});

test('ear colors anchor the paired tail while both outlines share the A/B hat outline', () => {
  assert.match(html, /\(asset\.categoryId==='EAR'\|\|asset\.categoryId==='TAIL'\)\&\&\(explicitDecorBase\|\|explicitDecorShade\)/);
  assert.match(html, /function sharedDecorRoleColor\(role,slot,order\)/);
  assert.match(html, /normalizeHex\(order\?\.\[slot\]\?\.decorShade\|\|''\)\|\|decorShadeFromBase\(base\)/);
  assert.match(html, /role==='DECOR_BASE'\|\|role==='TAIL_BASE'\)return base/);
  assert.match(html, /role==='DECOR_SHADOW'\|\|role==='TAIL_SHADE'\)return shade/);
  assert.match(html, /if\(role==='DECOR_OUTLINE'\|\|role==='TAIL_OUTLINE'\)return hatOutlineColor\(slot,order\)/);
  assert.match(html, /asset\.categoryId==='TAIL'\&\&!\['TAIL_BASE','TAIL_SHADE','TAIL_OUTLINE'\]\.includes\(role\)/);
  assert.match(html, /TAIL_SHADE/);
  assert.match(html, /const explicitDecor=\(a\.categoryId==='EAR'\|\|a\.categoryId==='TAIL'\)/);
  assert.match(html, /a\.type==='TAIL'/);
  assert.match(html, /asset\.categoryId==='EAR'\|\|asset\.categoryId==='TAIL'/);
  assert.match(html, /asset\.categoryId==='TAIL'\&\&role==='TAIL_OUTLINE'/);
  assert.match(html, /a\.categoryId==='TAIL'\&\&Object\.values\(a\.bindings\|\|\{\}\)\.includes\('TAIL_OUTLINE'\)/);
  const start = html.indexOf('function sharedDecorRoleColor(');
  const end = html.indexOf('\nfunction ', start + 1);
  const sharedDecorRoleColor = new Function(
    'normalizeHex', 'hatOutlineColor', 'decorShadeFromBase',
    `${html.slice(start, end)}\nreturn sharedDecorRoleColor;`
  )(value => value || '', slot => `${slot}-hat-outline`, base => base ? `${base}-shade` : null);
  const order = { A: { decorBase: '#eeeeee', decorShade: '' }, B: { decorBase: '#dddddd', decorShade: '#bbbbbb' } };
  assert.equal(sharedDecorRoleColor('DECOR_SHADOW', 'A', order), '#eeeeee-shade');
  assert.equal(sharedDecorRoleColor('TAIL_SHADE', 'A', order), '#eeeeee-shade');
  assert.equal(sharedDecorRoleColor('DECOR_SHADOW', 'B', order), '#bbbbbb');
  assert.equal(sharedDecorRoleColor('DECOR_OUTLINE', 'A', order), 'A-hat-outline');
  assert.equal(sharedDecorRoleColor('TAIL_OUTLINE', 'A', order), 'A-hat-outline');
  assert.equal(sharedDecorRoleColor('DECOR_OUTLINE', 'B', order), 'B-hat-outline');
  assert.equal(sharedDecorRoleColor('TAIL_OUTLINE', 'B', order), 'B-hat-outline');
});

test('tails are pinned directly above the lace and below every other root layer', () => {
  assert.match(html, /function pinTailStackAboveLace\(panelIds,tailIds,lace,base,legacy\)/);
  assert.match(html, /return pinTailStackAboveLace\(\[\.\.\.frameStackIds\('FRONT'\),\.\.\.rest,\.\.\.frameStackIds\('BACK'\)\],tailIds,lace,base,legacy\)/);
  const start = html.indexOf('function pinTailStackAboveLace(');
  const end = html.indexOf('\nfunction ', start + 1);
  const pinTailStackAboveLace = new Function(`${html.slice(start, end)}\nreturn pinTailStackAboveLace;`)();
  const panel = ['front-frame', 'tail:B', 'person', 'tail:A', 'back-frame', 'lace', 'base', 'legacy'];
  assert.deepEqual(
    pinTailStackAboveLace(panel, new Set(['tail:A', 'tail:B']), 'lace', 'base', 'legacy'),
    ['front-frame', 'person', 'back-frame', 'tail:B', 'tail:A', 'lace', 'base', 'legacy']
  );
});

test('ear and tail fur lines remain fixed while their main outlines share the hat outline', () => {
  assert.match(html, /绒毛\.\*线稿\|线稿\.\*绒毛\|绒毛线\|fur\.\*line\|line\.\*fur/);
  assert.match(html, /return 'TAIL_FUR'/);
  assert.match(html, /oldFurOutline=.*TAIL_OUTLINE.*TAIL_FUR/);
  assert.match(html, /if\(asset\.categoryId==='TAIL'\&\&!\['TAIL_BASE','TAIL_SHADE','TAIL_OUTLINE'\]\.includes\(role\)\)continue/);
  assert.match(html, /role==='DECOR_FUR'\|\|role==='TAIL_FUR'/);
  assert.match(html, /function hatOutlineColor\(slot,order\)/);
  assert.match(html, /if\(role==='HAT_OUTLINE'\)return hatOutlineColor\(slot,order\)/);
  assert.match(html, /if\(role==='DECOR_OUTLINE'\)return hatOutlineColor\(slot,order\)/);
  assert.match(html, /if\(linkedOutline\)map\[path\]=hatOutlineColor\(asset\.slot,order\)/);
  assert.match(html, /命名为“绒毛线稿”的层保持素材原色/);
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

test('animal assets keep base and fur colors until an explicit form color while linked outlines follow the hat', () => {
  assert.match(html, /耳朵底色（空=原色）/);
  assert.match(html, /function fillDecorFallbackBindings\(asset\)/);
  assert.match(html, /asset\.bindings\[base\.n\.path\]='DECOR_BASE'/);
  assert.match(html, /asset\.categoryId==='EAR'\|\|asset\.categoryId==='TAIL'/);
  assert.match(html, /function syncEarColorAnchorUi\(slot,order=getActiveOrder\(\)\)/);
  assert.match(html, /hatAnchor=order\[slot\]\?\.hat==='__DECOR_ANCHOR__'/);
  assert.match(html, /const linkedAnimalOutline=/);
  assert.match(html, /__preserveOriginal:true/);
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
  assert.match(html, /a\.slot==='GLOBAL'\?'公共装饰':a\.slot\+' 位'/);
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
  assert.match(html, /if\(a\.enabled&&\(a\.type==='HAT_DECOR'\|\|a\.type==='HAIR'\|\|a\.type==='EYE'\|\|a\.type==='TAIL'\|\|a\.type==='FRAME'\)\)prepareAssetCompositeForOrder/);
  assert.match(html, /requestIdleCallback\(save,\{timeout:1800\}\)/);
  assert.match(html, /已加入素材/);
  assert.match(html, /已切换素材/);
  assert.match(html, /Math\.max\(1,Math\.round\(performance\.now\(\)-started\)\)/);
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
  assert.match(html, /setTimeout\(\(\)=>warmCurrentOrderAssets\(\),0\)/);
  assert.match(html, /function warmCurrentOrderAssets\(\)/);
  assert.match(html, /record\._loading=true;renderAssetLibrary\(\);renderTransformControls\(\)/);
  assert.match(html, /正在打开 \$\{sourceFormat\}/);
});

test('pale white and pink hats use a darker low-chroma outline', () => {
  assert.match(html, /function isPalePinkOrWhiteHat\(base\)/);
  assert.match(html, /function paleHatOutlineColor\(base\)/);
  assert.match(html, /if\(isPalePinkOrWhiteHat\(hat\)\)return paleHatOutlineColor\(hat\)/);
  assert.match(html, /Math\.min\(\.038,o\.C\*\.34\)/);
});

test('hat outline never derives from eye color', () => {
  const start = html.indexOf('function hatOutlineColor(slot,order)');
  const end = html.indexOf('function deriveRoleColor', start);
  assert.ok(start >= 0 && end > start, 'hat outline helper should exist');
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
  assert.match(html, /\(\?:模板\|耳朵\|头发\|帽饰\|嘴巴\|表情\|眼睛\|眼睛状态\|尾巴\|小物\|配饰\|边框/);
});

test('phase four accepts transparent PNG assets without PSD parsing', () => {
  assert.match(html, /accept="\.psd,\.png,image\/vnd\.adobe\.photoshop,image\/png"/);
  assert.match(html, /function isPngAssetFile\(file\)/);
  assert.match(html, /async function loadPngCanvas\(file\)/);
  assert.match(html, /function makeRasterAssetRecord\(file,canvas,slot,type,variant,metadata=\{\}\)/);
  assert.match(html, /sourceFormat:'PNG'/);
  assert.match(html, /originalComposite:canvas/);
  assert.match(html, /a\.psd\|\|a\.composite/);
  assert.match(html, /records=S\.assets\.filter\(a=>assetFamilyKey\(a\)===familyKey&&\(a\.psd\|\|a\.composite\)\)/);
  assert.match(html, /forcedSlot==='AUTO'&&!hasExplicitAssetSlot\(file\)/);
  assert.match(html, /PNG 原图 \/ 透明通道保留/);
});

test('phase four keeps public PNG decorations independent per order', () => {
  assert.match(html, /globalAssetSelections:\[\]/);
  assert.match(html, /function ensureOrderGlobalAssetSelections\(order\)/);
  assert.match(html, /function setGlobalAssetFamilyEnabled\(familyKey,on\)/);
  assert.match(html, /function setGlobalAssetPlacement\(familyKey,placement\)/);
  assert.match(html, /data-ak="global-check"/);
  assert.match(html, /data-ak="global-placement"/);
  assert.match(html, /globalAssetStackIds\('FRONT'\)/);
  assert.match(html, /globalAssetStackIds\('BACK'\)/);
  assert.match(html, /a\.slot==='GLOBAL'\)\{a\.enabled=globals\.has\(assetFamilyKey\(a\)\)/);
});

test('phase four allows multiple small items per A or B slot', () => {
  assert.match(html, /assetMultiSelections:\{A:\{\},B:\{\}\}/);
  assert.match(html, /const STACKABLE_ASSET_CATEGORIES=new Set\(\['PROP'\]\)/);
  assert.match(html, /function ensureOrderMultiAssetSelections\(order\)/);
  assert.match(html, /function selectedAssetFamilies\(order,slot,categoryId\)/);
  assert.match(html, /if\(isStackableAssetCategory\(a\.categoryId\)\)\{a\.enabled=isAssetFamilySelected/);
  assert.match(html, /if\(on&&!list\.includes\(familyKey\)\)list\.push\(familyKey\)/);
  assert.match(html, /可多选叠加/);
});

test('phase four eye-state PSDs follow the selected A or B eye scheme', () => {
  assert.match(html, /id:'EYE',name:'眼睛状态'/);
  assert.match(html, /EYE:\['NONE','EYE_IRIS_BASE'/);
  assert.match(html, /if\(type==='EYE'\)\{/);
  assert.match(html, /categoryId==='EYE'\?'FOLLOW_ORDER':'PRESERVE_ORIGINAL'/);
  assert.match(html, /asset\.type==='HAT_DECOR'\|\|asset\.type==='HAIR'\|\|asset\.type==='EYE'/);
  assert.match(html, /跟随当前眼睛方案（推荐）/);
  assert.match(html, /assetSelections:\{A:\{\},B:\{\}\}/);
  assert.match(html, /function enabledEyeStateForSlot\(slot\)/);
  assert.match(html, /function rootEyeLayerSlot\(layer,id\)/);
  assert.match(html, /replacementSlot&&enabledEyeStateForSlot\(replacementSlot\)\)return/);
});

test('Eye Scheme keeps AUTO intact and adds a serializable optional-anchor AUTO_V3', () => {
  assert.match(html, /schemaVersion:'shine-eye-scheme-v2'/);
  assert.match(html, /\['irisBase','虹膜主色'\]/);
  assert.match(html, /\['pupil','瞳孔点缀'\]/);
  assert.match(html, /\['pupilDark','瞳孔暗部'\]/);
  assert.match(html, /\['lashHighlight','睫毛高光'\]/);
  assert.match(html, /\['DERIVED','FIXED','INDEPENDENT'\]/);
  assert.match(html, /id:'AUTO',name:'双锚点自动方案'/);
  assert.match(html, /irisDark:eyeFieldSpec\('DERIVED'.*space:'HSL',saturationMultiplier:left\?0\.38:0\.52/);
  assert.match(html, /irisHighlight:eyeFieldSpec\('FIXED'/);
  assert.match(html, /pupil:eyeFieldSpec\('INDEPENDENT'/);
  assert.match(html, /id:'AUTO_V3',name:'可选锚点自适应方案'/);
  assert.match(html, /adaptiveKind:'irisDark'/);
  assert.match(html, /adaptiveKind:'irisHighlight'/);
  assert.match(html, /adaptiveKind:'pupil'/);
  assert.match(html, /optionalAnchor:'pupilAccent',defaultAccent/);
  assert.match(html, /if\(id==='AUTO_V3'\)return autoEyeSchemeV3\(slot\)/);
  assert.match(html, /value="AUTO_V3">可选锚点自适应方案/);
  assert.match(html, /schemeId==='AUTO_V3'\?'自定义瞳孔点缀色（可选）'/);
  assert.match(html, /derive\.space==='OKLCH'\?deriveEyeOklch\(source,derive\):deriveEyeHsl\(source,derive\)/);
  assert.match(html, /rawDerive\.mode==='adaptive'&&adaptiveKind/);
  assert.match(html, /b\.role==='EYE_PUPIL_HIGHLIGHT'\|\|b\.role==='PUPIL_HIGHLIGHT_FIXED'\)\{b\.locked=true;b\.source='FIXED'/);
  const start = html.indexOf('function normalizeEyeDerive(');
  const end = html.indexOf('\nfunction ', start + 1);
  const normalizeEyeDerive = new Function('normalizeHex', `${html.slice(start, end)}\nreturn normalizeEyeDerive;`)(value => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value).toUpperCase() : '');
  assert.deepEqual(
    JSON.parse(JSON.stringify(normalizeEyeDerive({ source: 'irisBase', space: 'OKLCH', mode: 'adaptive', adaptiveKind: 'irisDark', fn() {} }))),
    { source: 'irisBase', space: 'OKLCH', mode: 'adaptive', adaptiveKind: 'irisDark' }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(normalizeEyeDerive({ source: 'irisBase', space: 'OKLCH', mode: 'adaptive', adaptiveKind: 'pupil', optionalAnchor: 'pupilAccent', defaultAccent: '#e6f9ff', fn() {} }))),
    { source: 'irisBase', space: 'OKLCH', mode: 'adaptive', adaptiveKind: 'pupil', optionalAnchor: 'pupilAccent', defaultAccent: '#E6F9FF' }
  );

  const optionalStart = html.indexOf('function optionalPupilAccentColor(');
  const optionalEnd = html.indexOf('\nfunction ', optionalStart + 1);
  const optionalPupilAccentColor = new Function('normalizeHex', `${html.slice(optionalStart, optionalEnd)}\nreturn optionalPupilAccentColor;`)(value => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value).toUpperCase() : '');
  assert.equal(optionalPupilAccentColor('A', { A: { pupilAccent: '#E6F9FF' } }, '#E6F9FF'), null);
  assert.equal(optionalPupilAccentColor('B', { B: { pupilAccent: '#FFD6A6' } }, '#FFD6A6'), null);
  assert.equal(optionalPupilAccentColor('A', { A: { pupilAccent: '#F4C542' } }, '#E6F9FF'), '#F4C542');
  assert.equal(optionalPupilAccentColor('B', { B: { pupilAccent: '' } }, '#FFD6A6'), null);
  const fieldStart = html.indexOf('function eyeSchemeFieldColor(');
  const fieldEnd = html.indexOf('\nfunction ', fieldStart + 1);
  const eyeSchemeFieldColor = new Function(
    'safeHex', 'optionalPupilAccentColor', 'deriveEyeOklch', 'deriveEyeHsl',
    `${html.slice(fieldStart, fieldEnd)}\nreturn eyeSchemeFieldColor;`
  )((value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value).toUpperCase() : fallback, optionalPupilAccentColor, source => `derived:${source}`, source => source);
  const optionalScheme = { fields: {
    irisBase: { mode: 'INDEPENDENT', value: '#918DCB' },
    pupil: { mode: 'DERIVED', value: '#E6F9FF', derive: { source: 'irisBase', space: 'OKLCH', mode: 'adaptive', adaptiveKind: 'pupil', optionalAnchor: 'pupilAccent', defaultAccent: '#E6F9FF' } }
  } };
  assert.equal(eyeSchemeFieldColor(optionalScheme, 'pupil', 'A', { A: { eye: '#244A88', pupilAccent: '#E6F9FF' } }), 'derived:#244A88');
  assert.equal(eyeSchemeFieldColor(optionalScheme, 'pupil', 'A', { A: { eye: '#244A88', pupilAccent: '#F4C542' } }), '#F4C542');
  assert.match(html, /EYE_IRIS_HIGHLIGHT:'irisHighlight'/);
  assert.match(html, /虹膜高光\|虹膜亮\|iris\.\*highlight/);
});

test('OKLCH gamut fitting uses unclipped linear RGB and adaptive eyes match the seven reference colors', () => {
  assert.match(html, /function oklchToLinearRgb\(\{L,C,h\}\)/);
  assert.match(html, /function linearRgbInGamut\(rgb\)/);
  assert.match(html, /for\(let i=0;i<200;i\+\+\)/);
  assert.match(html, /chroma=Math\.max\(0,chroma-\.001\)/);
  assert.match(html, /linearRgbToHex\(oklchToLinearRgb\(\{L:lightness,C:0,h:hue\}\)\)/);

  const colorStart = html.indexOf('function hexToRgb(');
  const colorEnd = html.indexOf('function isNearWhite', colorStart);
  const colorApi = new Function(
    'normalizeHex',
    `${html.slice(colorStart, colorEnd)}\nreturn {rgbToOklch,gamutHex,clamp,wrapHue,shortestHueDelta,oklchToLinearRgb};`
  )(value => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value).toUpperCase() : '#000000');

  const adaptiveStart = html.indexOf('function derivePupil(');
  const adaptiveEnd = html.indexOf('\nfunction eyeFieldSpec', adaptiveStart);
  const adaptiveApi = new Function(
    'rgbToOklch', 'gamutHex', 'clamp', 'wrapHue', 'shortestHueDelta',
    `${html.slice(adaptiveStart, adaptiveEnd)}\nreturn {deriveEyeOklch};`
  )(colorApi.rgbToOklch, colorApi.gamutHex, colorApi.clamp, colorApi.wrapHue, colorApi.shortestHueDelta);

  const expected = {
    '#7EC8F5': { pupil: '#C4E8FF', irisDark: '#319AD0', irisHighlight: '#CFE9FF' },
    '#F29A55': { pupil: '#FFC8A1', irisDark: '#C46803', irisHighlight: '#FFCCB1' },
    '#F29ABD': { pupil: '#FFCCDF', irisDark: '#CB628F', irisHighlight: '#FFD2DC' },
    '#244A88': { pupil: '#708CBA', irisDark: '#002C70', irisHighlight: '#7A8FC7' },
    '#F3D97A': { pupil: '#FFEFB4', irisDark: '#C1A105', irisHighlight: '#FFF4DD' },
    '#9A9A9A': { pupil: '#D0D0D0', irisDark: '#6D6D6D', irisHighlight: '#DECFCA' },
    '#1A1A2E': { pupil: '#525363', irisDark: '#13122D', irisHighlight: '#5A586A' }
  };
  const params = {
    pupil: { mode: 'adaptive', adaptiveKind: 'pupil' },
    irisDark: { mode: 'adaptive', adaptiveKind: 'irisDark' },
    irisHighlight: { mode: 'adaptive', adaptiveKind: 'irisHighlight' }
  };
  for (const [hex, result] of Object.entries(expected)) {
    assert.deepEqual(Object.fromEntries(Object.entries(params).map(([key, spec]) => [key, adaptiveApi.deriveEyeOklch(hex, spec)])), result);
  }
});

test('Eye Scheme keeps the phase-one one-color pupil workflow as a built-in option', () => {
  assert.match(html, /value="LEGACY_AUTO">一期傻瓜模式（瞳孔跟随主色）/);
  assert.match(html, /function legacyEyeRoleColor\(role,slot,order\)/);
  assert.match(html, /shiftColor\(eye,g\.eyePupilL,g\.eyePupilC\)/);
  assert.match(html, /eyeSchemeId==='LEGACY_AUTO'/);
  assert.match(html, /advanced\.hidden=!usesPupilAnchor/);
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
