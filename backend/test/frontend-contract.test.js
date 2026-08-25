const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');

test('keeps the v0.28 PSD parser entry unchanged', () => {
  assert.match(html, /async function parsePsd\(file\)\{\s+if\(!window\.agPsd\)throw new Error\('ag-psd 未加载，请联网刷新页面'\);\s+return window\.agPsd\.readPsd\(await file\.arrayBuffer\(\),\{skipThumbnail:true\}\);\s+\}/);
});

test('independent accounts expose shared cloud work without replacing local save', () => {
  assert.match(html, /const CLOUD_PROFILE_ENABLED=true/);
  assert.match(html, /id="accountUsername"/);
  assert.match(html, /id="accountPassword"/);
  assert.match(html, /id="accountAdminToken"/);
  assert.match(html, /accountRequest\('\/api\/auth\/login'/);
  assert.match(html, /accountRequest\('\/api\/auth\/me'/);
  assert.match(html, /accountRequest\('\/api\/accounts'/);
  assert.match(html, /S\.authAccount\?\.role!==\s*'admin'/);
  assert.match(html, /sessionStorage\.setItem\(CLOUD_PROFILE_TOKEN_KEY,token\)/);
  assert.match(html, /panel\.hidden=!CLOUD_PROFILE_ENABLED/);
  assert.match(html, /cloudAssetPanel'\)\)\$\('#cloudAssetPanel'\)\.hidden=!CLOUD_PROFILE_ENABLED/);
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
  assert.match(html, /if\(paletteEye\|\|d\.eyeHex&&\/\^#\[0-9a-f\]\{6\}\$\/i\.test\(d\.eyeHex\)\)\{o\[slot\]\.eye=paletteEye\|\|d\.eyeHex/);
  assert.match(html, /paletteHair=formAnchorHex\(field\(sec,\['发色'\]\),'hair'\)/);
  assert.match(html, /o\[slot\]\.hair=paletteHair\|\|d\.hairHex/);
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

test('ear assets never auto-equip on upload and stale blank-order trial ears are removed once', () => {
  const start = html.indexOf('function migrateBlankOrderAutoEarsV1(');
  const end = html.indexOf('\nfunction loadProductionState(', start);
  assert.ok(start >= 0 && end > start, 'blank-order ear migration should be extractable');
  const migrate = new Function(
    'S', 'localStorage', 'NO_AUTO_EAR_MIGRATION_KEY', 'ensureOrderAssetSelections', 'ensureOrderAutoTailSelections', 'persistOrders',
    `${html.slice(start, end)}\nreturn migrateBlankOrderAutoEarsV1;`
  );
  const blank = {
    customerName: '未命名顾客', formText: '',
    A: { decor: '趴狗耳', decorBase: '#FFFFFF', decorShade: '#EEEEEE' }, B: { decor: 'NONE' },
    assetSelections: { A: { EAR: 'EAR::趴狗耳', TAIL: 'TAIL::趴狗尾' }, B: {} },
    autoTailSelections: { A: 'TAIL::趴狗尾', B: null },
    rootStackOrder: ['asset:EAR:%E8%B6%B4%E7%8B%97%E8%80%B3:A', 'template:人物']
  };
  const filled = {
    customerName: '顾客', formText: 'A：\n耳朵类型：猫耳',
    A: { decor: '细猫' }, B: { decor: 'NONE' },
    assetSelections: { A: { EAR: 'EAR::细猫' }, B: {} }, autoTailSelections: { A: null, B: null }
  };
  const S = { orders: [blank, filled] }, storage = new Map();let saves = 0;
  migrate(
    S,
    { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    'migration-key',
    order => order.assetSelections,
    order => order.autoTailSelections,
    () => { saves += 1; }
  )();
  assert.equal(blank.A.decor, 'NONE');
  assert.equal(blank.assetSelections.A.EAR, null);
  assert.equal(blank.assetSelections.A.TAIL, null);
  assert.deepEqual(blank.rootStackOrder, ['template:人物']);
  assert.equal(filled.A.decor, '细猫', 'filled orders must keep read-form or manual ear choices');
  assert.equal(saves, 1);
  assert.equal(storage.get('migration-key'), 'done');

  const loadStart = html.indexOf('async function loadAssets(');
  const loadEnd = html.indexOf('\nfunction exportTree(', loadStart);
  const loadSource = html.slice(loadStart, loadEnd);
  assert.match(loadSource, /素材上传只加入素材库；耳朵必须由读表匹配或用户手动选择/);
  assert.doesNotMatch(loadSource, /freshBySlot|o\[slot\]\.decor=fresh\.variant/);
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
    'placeSelectedEarStacksAboveTemplate',
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
    (order, slot, record) => tailSyncs.push([slot, record.variant]),
    () => {}
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

  const names = ['parseCustomerName', 'characterSection', 'isUnfilledTemplateValue', 'field', 'splitEarAnswer', 'explicitFormHex', 'formPresetAnchor', 'hairAnchorPreset', 'formAnchorHex', 'apiReviewFields', 'normalizeHex'];
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
  assert.equal(helpers.formAnchorHex(helpers.field(inlineA, ['瞳色']), 'eye'), '#C3AC92');
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
  assert.equal(helpers.formAnchorHex(helpers.field(shortB, ['瞳色']), 'eye'), '#8FA0C7');
  assert.equal(helpers.formAnchorHex(helpers.field(shortA, ['发色']), 'hair'), '#C9AA76');
  assert.equal(helpers.formAnchorHex(helpers.field(shortB, ['发色']), 'hair'), '#D8BC82');
  assert.equal(helpers.formAnchorHex('金色', 'hair'), '#FAEFE7');
  assert.equal(helpers.formAnchorHex('银白', 'hair'), '#FCF9FB');
  assert.equal(helpers.formAnchorHex('银色', 'hair'), '#FCF9FB');
  assert.equal(helpers.formAnchorHex('黄色', 'decor'), '#FFF8EB');
  assert.equal(helpers.formAnchorHex('蓝色', 'decor'), '#E5F6FF');
  assert.equal(helpers.formAnchorHex('粉红', 'eye'), '#FFE5F3');
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
  assert.match(html, /color\.onchange=\(\)=>\{(?:activateHair\(text\.value\);)?captureActiveOrder\(\);flushLiveProductionColors/);
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
  assert.match(html, /renderMode:'overlay'[^;]+colorMode:'PRESERVE_ORIGINAL',colorModeExplicit:false/);
  assert.match(html, /const followsOrder=isHairCategory\(asset\.categoryId\)\?instanceState\.useGeneratedColor===true:\(asset\.colorModeExplicit===true&&asset\.colorMode==='FOLLOW_ORDER'\)/);
  assert.match(html, /if\(followsOrder\)\{/);
  assert.match(html, /data-ak="colorMode"[^>]+type="checkbox"/);
  assert.match(html, /跟随订单配色（默认关闭）/);
  assert.match(html, /a\.originalComposite=renderAssetOriginalComposite\(a\);a\.composite=a\.originalComposite/);
  assert.match(html, /a\.colorMode='PRESERVE_ORIGINAL';a\.colorModeExplicit=false/);
  assert.match(html, /所有新上传 PSD 都只解析图层并保留原画颜色/);
});

test('phase four library exposes reusable, session-only, and backdrop categories', () => {
  assert.match(html, /const ASSET_CATEGORY_KEY='shine:asset-categories:v2'/);
  assert.match(html, /id:'CLEAN_TEMPLATE',name:'纯净模板'/);
  assert.match(html, /id:'EAR',name:'耳朵'/);
  assert.match(html, /id:'MOUTH',name:'嘴巴表情'/);
  assert.match(html, /id:'BACKDROP',name:'衬底'/);
  assert.match(html, /id:'ORIGINAL_ASSET',name:'原创素材'/);
  assert.match(html, /id:'AUXILIARY_ASSET',name:'辅助素材'/);
  assert.match(html, /id:'REUSABLE_HAIR',name:'普适头发'/);
  assert.match(html, /id:'TEMP_HAIR',name:'临时头发'/);
  assert.match(html, /function persistAssetCategories\(\)/);
  assert.match(html, /data-ak="category"/);
});

test('backdrop assets are single-select, fixed below tails, and use component recoloring', () => {
  assert.match(html, /frameSelections:\[\]/);
  assert.match(html, /function frameStackIds\(placement,order=getActiveOrder\(\)\)/);
  assert.match(html, /data-ak="frame-check"/);
  assert.match(html, /list\.splice\(0,list\.length\);list\.push\(\{familyKey,placement:'BACK'/);
  assert.match(html, /if\(on\)\{order\.backgroundMode='COLOR';order\.backgroundBaseVisible=true;order\.backgroundLaceVisible=false;\}/);
  assert.match(html, /syncBackgroundQuickFromOrder\(order\);updateBackgroundRecommendationMeta\(order\);/);
  assert.match(html, /asset\.categoryId!=='ORIGINAL_ASSET'&&!isBackdropCategory\(asset\.categoryId\)/);
  assert.match(html, /COMPONENT_BASE:colors\.base/);
  assert.match(html, /data-component-color="base"/);
  assert.match(html, /addedAt:Number\(x\.addedAt\)/);
  assert.match(html, /if\(isBackdropCategory\(el\.value\)&&records\.length>1\)/);
  assert.match(html, /keep\.groupPath=null/);
  assert.match(html, /Object\.assign\(assetTransformForTemplate\(a\),initialAssetTransform\(a\)\)/);

  const start = html.indexOf('function initialAssetTransform(');
  const end = html.indexOf('\nfunction templateDefaultAssetTransform(', start);
  assert.ok(start >= 0 && end > start, 'backdrop fitting helpers should be extractable');
  const helpers = new Function(
    'S', 'isBackdropCategory',
    `${html.slice(start, end)}\nreturn {initialAssetTransform,upgradeUntouchedBackdropTransform};`
  )({ master: { width: 2000, height: 2000 } }, id => id === 'BACKDROP');
  const backdrop = { categoryId: 'BACKDROP', psd: { width: 1500, height: 1500 }, defaultTransform: { x: 0, y: 0, scale: 1, rotation: 0, flipX: false, flipY: false } };
  const fitted = helpers.initialAssetTransform(backdrop);
  assert.equal(fitted.x, 250);
  assert.equal(fitted.y, 250);
  assert.ok(Math.abs(fitted.scale - 4 / 3) < 1e-9);
  assert.deepEqual(helpers.upgradeUntouchedBackdropTransform(backdrop, { x: 0, y: 0, scale: 1, rotation: 0, flipX: false, flipY: false }), fitted);
  assert.deepEqual(
    helpers.upgradeUntouchedBackdropTransform(backdrop, { x: 20, y: 10, scale: 1.2, rotation: 0, flipX: false, flipY: false }),
    { x: 20, y: 10, scale: 1.2, rotation: 0, flipX: false, flipY: false },
    'manual transforms must not be overwritten'
  );
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
  assert.match(html, /if\(isDecorAsset&&\(explicitDecorBase\|\|explicitDecorShade\|\|inMatchedTeam\)\)/);
  assert.match(html, /function sharedDecorPalette\(slot,order\)/);
  assert.match(html, /function sharedDecorRoleColor\(role,slot,order\)/);
  assert.match(html, /const shade=explicitShade\|\|\(explicitBase\?decorShadeFromBase\(base\):\(originalShade\|\|decorShadeFromBase\(base\)\)\)/);
  assert.match(html, /role==='DECOR_BASE'\|\|role==='TAIL_BASE'\)return base/);
  assert.match(html, /role==='DECOR_SHADOW'\|\|role==='TAIL_SHADE'\)return shade/);
  assert.match(html, /if\(role==='DECOR_OUTLINE'\|\|role==='TAIL_OUTLINE'\)return outline/);
  assert.match(html, /asset\.categoryId==='TAIL'\&\&!\['TAIL_BASE','TAIL_SHADE','TAIL_OUTLINE'\]\.includes\(role\)/);
  assert.match(html, /TAIL_SHADE/);
  assert.match(html, /const explicitDecor=\(a\.categoryId==='EAR'\|\|a\.categoryId==='TAIL'\)/);
  assert.match(html, /a\.type==='TAIL'/);
  assert.match(html, /asset\.categoryId==='EAR'\|\|asset\.categoryId==='TAIL'/);
  assert.match(html, /asset\.categoryId==='TAIL'\&\&role==='TAIL_OUTLINE'/);
  assert.match(html, /a\.categoryId==='TAIL'\&\&Object\.values\(a\.bindings\|\|\{\}\)\.includes\('TAIL_OUTLINE'\)/);
  const start = html.indexOf('function sharedDecorRoleColor(');
  const end = html.indexOf('\nfunction ', start + 1);
  const sharedDecorRoleColor = new Function('sharedDecorPalette', `${html.slice(start, end)}\nreturn sharedDecorRoleColor;`)(slot => slot === 'A' ? {base:'#eeeeee',shade:'#aaaaaa',outline:'A-hat-outline'} : {base:'#dddddd',shade:'#bbbbbb',outline:'B-hat-outline'});
  assert.equal(sharedDecorRoleColor('DECOR_SHADOW', 'A', {}), '#aaaaaa');
  assert.equal(sharedDecorRoleColor('TAIL_SHADE', 'A', {}), '#aaaaaa');
  assert.equal(sharedDecorRoleColor('DECOR_SHADOW', 'B', {}), '#bbbbbb');
  assert.equal(sharedDecorRoleColor('DECOR_OUTLINE', 'A', {}), 'A-hat-outline');
  assert.equal(sharedDecorRoleColor('TAIL_OUTLINE', 'A', {}), 'A-hat-outline');
  assert.equal(sharedDecorRoleColor('DECOR_OUTLINE', 'B', {}), 'B-hat-outline');
  assert.equal(sharedDecorRoleColor('TAIL_OUTLINE', 'B', {}), 'B-hat-outline');
});

test('tails are pinned above backdrop and disabled legacy lace layers', () => {
  assert.match(html, /const allFrameIds=new Set\(S\.assets\.filter\(a=>isBackdropCategory\(a\.categoryId\)\)\.map\(assetStackId\)\)/);
  assert.match(html, /return \[\.\.\.watermarks,\.\.\.subjectBody,\.\.\.tails,\.\.\.frameStackIds\('BACK'\),\.\.\.\(lace\?\[lace\]:\[\]\),\.\.\.\(base\?\[base\]:\[\]\)/);
  assert.match(html, /const showLace=false/);
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

test('each uploaded PSD detects its own visual draw order during recoloring', () => {
  assert.match(html, /function assetPsdDrawOrder\(psd,cached=null\)/);
  assert.match(html, /cached\?\.source==='composite-match'/);
  assert.match(html, /const detected=detectLayerDrawOrder\(psd\)/);
  assert.match(html, /source:'composite-match'/);
  assert.match(html, /resolvedOrder=assetPsdDrawOrder\(psd,asset\.order\)/);
  assert.match(html, /asset\.order=resolvedOrder/);
  assert.match(html, /order:assetPsdDrawOrder\(psd,order\)/);
  assert.doesNotMatch(html, /asset\.order\?\.mode\|\|detectLayerDrawOrder/);
  assert.doesNotMatch(html, /function enforceDecorOutlineAboveFur/);

  const orderStart = html.indexOf('function orderChildren(');
  const orderEnd = html.indexOf('\nfunction ', orderStart + 1);
  const nativeStart = html.indexOf('function assetPsdDrawOrder(');
  const nativeEnd = html.indexOf('\nfunction ', nativeStart + 1);
  const helpers = new Function(
    'detectLayerDrawOrder',
    `${html.slice(orderStart, orderEnd)}\n${html.slice(nativeStart, nativeEnd)}\nreturn {orderChildren,assetPsdDrawOrder};`,
  )(psd => ({ mode: psd.detectedMode, confidence: 'high' }));
  const panelBottomToTop = ['底色', '重色', '高光', '线稿'];
  const direct = helpers.assetPsdDrawOrder({ children: panelBottomToTop, detectedMode: 'direct' });
  assert.equal(direct.source, 'composite-match');
  assert.equal(helpers.assetPsdDrawOrder({ detectedMode: 'reverse' }, direct), direct);
  assert.deepEqual(
    helpers.orderChildren(panelBottomToTop, direct.mode),
    ['底色', '重色', '高光', '线稿'],
  );
  const panelTopToBottom = ['线稿', '高光', '重色', '底色'];
  assert.deepEqual(
    helpers.orderChildren(panelTopToBottom, helpers.assetPsdDrawOrder({ children: panelTopToBottom, detectedMode: 'reverse' }).mode),
    ['底色', '重色', '高光', '线稿'],
  );
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

test('selected A and B ears are paired above template roots instead of inheriting stale bottom positions', () => {
  assert.match(html, /function placeSelectedEarStacksAboveTemplate\(order=getActiveOrder\(\)\)/);
  assert.match(html, /placeSelectedEarStacksAboveTemplate\(order\)/);
  const start = html.indexOf('function alignSelectedEarStackOrder(');
  const end = html.indexOf('\nfunction ', start + 1);
  const records = {
    A: { slot: 'A', id: 'asset:EAR:new:A' },
    B: { slot: 'B', id: 'asset:EAR:new:B' },
  };
  const alignSelectedEarStackOrder = new Function(
    'selectedEarStackIds',
    `${html.slice(start, end)}\nreturn alignSelectedEarStackOrder;`,
  )(() => [records.B.id, records.A.id]);
  const stale = [
    'asset:AUXILIARY_ASSET:top:GLOBAL',
    records.B.id,
    'layer:A宝宝',
    'layer:B宝宝',
    records.A.id,
    'layer:背景底色',
  ];
  assert.deepEqual(alignSelectedEarStackOrder({}, stale), [
    'asset:AUXILIARY_ASSET:top:GLOBAL',
    records.B.id,
    records.A.id,
    'layer:A宝宝',
    'layer:B宝宝',
    'layer:背景底色',
  ]);
});

test('asset free transform works from the whole preview area and stays independent per order', () => {
  assert.match(html, /function wirePreviewFreeTransform\(\)/);
  assert.match(html, /body\.addEventListener\('pointerdown'/);
  assert.match(html, /body\.addEventListener\('pointermove'/);
  assert.match(html, /shine:asset-transform:/);
  assert.match(html, /assetTransforms:\{\}/);
  assert.match(html, /order\.assetTransforms\[id\]/);
  assert.match(html, /order\.assetTransforms\[assetTransformKey\(a\)\]=\{\.\.\.assetTransformForTemplate\(a\)\}/);
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
  assert.match(html, /function applyPendingTransformDrag\(\)/);
  assert.match(html, /getCoalescedEvents\?\.\(\)\.at\?\.\(-1\)/);
  assert.match(html, /scheduleAssetTransformRender\(\);e\.preventDefault\(\)/);
  assert.match(html, /if\(dst\.width!==src\.width\|\|dst\.height!==src\.height\)\{dst\.width=src\.width;dst\.height=src\.height;\}/);
  const dragStart = html.indexOf('function wirePreviewFreeTransform(');
  const dragEnd = html.indexOf('\nfunction ', dragStart + 1);
  const dragSource = html.slice(dragStart, dragEnd);
  const pointerMove = dragSource.match(/body\.addEventListener\('pointermove',[\s\S]*?\);/)[0];
  assert.doesNotMatch(pointerMove, /syncTransformControlValues|reconstruct|getBoundingClientRect/);
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
  assert.match(html, /records\.forEach\(asset=>\{asset\.enabled=true;upsertAssetRecord\(asset\)\}\)/);
  assert.match(html, /const hairSelections=ensureOrderAssetSelections\(active\)\[slot\];delete hairSelections\.REUSABLE_HAIR;delete hairSelections\.TEMP_HAIR;hairSelections\[categoryId\]=assetFamilyKey\(asset\)/);
  assert.match(html, /queuePersistAssetFamilyLocal\(assetFamilyKey\(asset\),40\)/);
  assert.match(html, /if\(isHairCategory\(a\.categoryId\)\)return `\$\{a\.categoryId\}::\$\{a\.assetId\}`/);
  assert.match(html, /const idx=S\.assets\.findIndex\(a=>a\.assetId===rec\.assetId&&a\.slot===rec\.slot&&\(a\.groupPath\|\|null\)===\(rec\.groupPath\|\|null\)\)/);
  assert.doesNotMatch(hairLoader, /previous|sameVariant/);
  assert.doesNotMatch(html, /S\.assets=S\.assets\.filter\(a=>!\(a\.type==='HAIR'&&a\.slot===slot\)\)/);
});

test('hair A/B position is inferred from filename or PSD layers and never silently defaults to A', () => {
  const start = html.indexOf('function explicitAssetSlotFromText(');
  const end = html.indexOf('\nfunction explicitHairPlacement(', start);
  assert.ok(start >= 0 && end > start, 'hair slot helpers should be extractable');
  const flatten = children => children.flatMap((layer, index) => {
    const name = layer.name || `Layer ${index}`, own = { name, path: name };
    return [own, ...((layer.children || []).map(child => ({ name: child.name, path: `${name}/${child.name}` })) )];
  });
  const guessSlot = (path, name) => {
    for (const value of [path, name]) {
      const first = String(value || '').split('/')[0];
      if (/^A(?:位|头发|[_\-\s]|$)/i.test(first)) return 'A';
      if (/^B(?:位|头发|[_\-\s]|$)/i.test(first)) return 'B';
    }
    return 'NONE';
  };
  const helpers = new Function('flatten', 'guessSlot', `${html.slice(start, end)}\nreturn {explicitAssetSlotFromText,inferHairAssetSlot};`)(flatten, guessSlot);
  assert.equal(helpers.explicitAssetSlotFromText('头发_B_短发.psd'), 'B');
  assert.equal(helpers.explicitAssetSlotFromText('B头发_短发.psd'), 'B');
  assert.equal(helpers.explicitAssetSlotFromText('头发_A_长发.psd'), 'A');
  assert.equal(helpers.inferHairAssetSlot({ name: '头发_短发.psd' }, { children: [{ name: 'B头发', children: [{ name: 'B底色' }] }] }), 'B');
  assert.equal(helpers.inferHairAssetSlot({ name: '头发_女齐刘海长发(2).psd' }, { children: [{ name: '背景' }, { name: 'B底色' }, { name: 'B重色' }, { name: 'B高光' }, { name: 'B线稿' }] }), 'B');
  assert.equal(helpers.inferHairAssetSlot({ name: '头发_长发.psd' }, { children: [{ name: 'A头发' }, { name: 'B头发' }] }), null);
  assert.match(html, /if\(!slot\)throw new Error\('头发 PSD 没有识别到 A\/B 位置/);
  assert.match(html, /const hairSlots=isHairCategory\(el\.value\)\?records\.map\(a=>inferHairAssetSlot\(a\.file,a\.psd,a\.groupPath\)/);
  assert.match(html, /if\(isHairCategory\(el\.value\)\)\{a\.slot=hairSlots\[index\];a\.defaultSlot=hairSlots\[index\];a\.characterCompatibility=hairSlots\[index\]\}/);
});

test('front and back hair folders split into one shared-color package and sandwich clothing', () => {
  assert.match(html, /function explicitHairPlacement\(value\)/);
  assert.match(html, /后头发\|后发\|后置头发/);
  assert.match(html, /前头发\|前发\|前置头发\|刘海/);
  assert.match(html, /function hairPackageComponentGroups\(psd,order=assetPsdDrawOrder\(psd\)\)/);
  assert.match(html, /n\.isGroup&&n\.depth<=1/);
  assert.match(html, /function makeHairPackageRecords\(file,psd,order,slot,variant,metadata=\{\}\)/);
  assert.match(html, /packageName:variant,componentName:placement==='BACK'\?'后头发':'前头发'/);
  assert.match(html, /function hairStackId\(slot,placement='FRONT'\)/);
  assert.match(html, /const frontHairs=availableHairStackIds\('FRONT'\)/);
  assert.match(html, /ids\.splice\(hairBottom>=0\?hairBottom\+1:0,0,\.\.\.clothes\)/);
  assert.match(html, /const backHairs=availableHairStackIds\('BACK'\)/);
  assert.match(html, /function assetTransformKey\(a\).*legacyHairStackId\(a\.slot\)/);
  assert.match(html, /hairPlacement:isHairCategory\(a\.categoryId\)\?hairPlacementForAsset\(a\):null/);
});

test('eyelashes are independent A/B components and never inherit the eye scheme', () => {
  assert.match(html, /\{id:'EYE_LASH',name:'睫毛',builtin:true\}/);
  assert.match(html, /EYE_LASH:\['NONE','COMPONENT_BASE','COMPONENT_SHADOW','COMPONENT_LINEART','COMPONENT_HIGHLIGHT'\]/);
  assert.match(html, /if\(type==='EYE_LASH'\)\{/);
  assert.match(html, /眼皮\|eyelid[\s\S]{0,120}\^\(\?:高光\|highlight\)\$[\s\S]{0,50}return 'NONE'/);
  assert.match(html, /底色\|base[\s\S]{0,40}return 'COMPONENT_BASE'/);
  assert.match(html, /safeLashLayers=asset\.type!=='EYE_LASH'\|\|Object\.values\(asset\.bindings\|\|\{\}\)\.includes\('COMPONENT_BASE'\)/);
  assert.match(html, /asset\.type==='CLOTHING'\|\|asset\.type==='BACKDROP'\|\|asset\.type==='ORIGINAL_ASSET'\|\|asset\.type==='EYE_LASH'/);
  assert.match(html, /未识别到明确的“睫毛底色”层/);
  assert.match(html, /categoryId='EYE_LASH'/);
  assert.match(html, /EYE_LASH:'EYE_LASH'/);
  assert.match(html, /function enabledEyeLashForSlot\(slot\)/);
  assert.match(html, /function templateLashReplacementSlot\(path,name\)/);
  assert.match(html, /'EYE_PUPIL_HIGHLIGHT','PUPIL_HIGHLIGHT_FIXED'/);
  assert.match(html, /\/睫毛\|lash\|眼皮\|eyelid\/i/);
  assert.match(html, /useOverrides&&psd===S\.master&&\(templateLashReplacementSlot\(path,name\)\|\|templateBodyReplacementSlot\(path,name\)\)\)return/);
});

test('asset selection yields before rendering and avoids full library and disabled-asset recomposition', () => {
  assert.match(html, /function syncAssetLibrarySelectionUi\(order=getActiveOrder\(\)\)/);
  assert.match(html, /await new Promise\(resolve=>setTimeout\(resolve,0\)\)/);
  assert.match(html, /if\(a\.enabled&&\(a\.type==='HAT_DECOR'\|\|a\.type==='HAIR'\|\|a\.type==='EYE'\|\|a\.type==='EYE_LASH'\|\|a\.type==='TAIL'\|\|a\.type==='CLOTHING'\|\|a\.type==='BACKDROP'\|\|a\.type==='ORIGINAL_ASSET'\)\)prepareAssetCompositeForOrder/);
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
  assert.match(branch, /return legacyHatOutlineFromBase\(hat\)/);
  assert.match(html, /if\(isNearWhite\(hat\)\)return shiftColor\(hat,-0\.17,0\.72\)/);
});

test('single-layer adjustment only lists enabled A or B asset instances', () => {
  assert.match(html, /\(S\.assets\|\|\[\]\)\.filter\(a=>a\.enabled\)\.forEach\(a=>\{/);
  assert.match(html, /const prefix=`\[\$\{a\.slot\} \$\{categoryLabel\(a\.type\)\}\] `/);
});

test('selecting a tail or other asset refreshes single-layer adjustment immediately', () => {
  assert.match(html, /S\.selectedTransformStackId=assetStackId\(record\);renderHairInsertionControls\(\);renderFlexibleComponentPanels\(\);reconstruct\(\);renderAssetRuntimeStatus\(\);renderEditableLayerSelectors\(\)/);
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
  assert.match(html, /restoreOrderTemplateState\(getActiveOrder\(\),S\.templateSignature\);mergeTemplateFlexibleSchema\(getActiveOrder\(\),S\.templateSignature\);persistOrders\(\)/);
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

test('original PSD watermarks are global, topmost, and controlled by preview or delivery mode', () => {
  assert.match(html, /function isWatermarkName\(value\)/);
  assert.match(html, /function isWatermarkAsset\(asset\)/);
  assert.match(html, /function activeWatermarkAsset\(\)/);
  assert.match(html, /function watermarkAssetStackIds\(\)/);
  assert.match(html, /return \[\.\.\.watermarkAssetStackIds\(\),\.\.\.frameStackIds\('FRONT'\)/);
  assert.match(html, /isWatermarkAsset\(asset\)\?S\.watermarkPreviewVisible:asset\.enabled/);
  assert.match(html, /S\.watermarkPreviewVisible=!!show/);
  assert.match(html, /S\.watermarkPreviewVisible=currentWatermark;reconstruct\(\)/);
  assert.match(html, /if\(isWatermarkName\(stem\)\)\{categoryId='ORIGINAL_ASSET';slot='GLOBAL';\}/);
  assert.match(html, /watermarkUpload=categoryId==='ORIGINAL_ASSET'&&isWatermarkName/);
  assert.match(html, /已接入水印开关/);
  assert.match(html, /!isWatermarkAsset\(a\)&&\['EAR','TAIL','CLOTHING'/);

  const sourceOf = name => {
    const start = html.indexOf(`function ${name}(`), end = html.indexOf('\nfunction ', start + 1);
    assert.ok(start >= 0 && end > start, `${name} should be extractable`);
    return html.slice(start, end);
  };
  const isWatermarkName = new Function(`${sourceOf('isWatermarkName')}\nreturn isWatermarkName;`)();
  const isWatermarkAsset = new Function('isWatermarkName', `${sourceOf('isWatermarkAsset')}\nreturn isWatermarkAsset;`)(isWatermarkName);
  const S = { assets: [
    { assetId: 'old', categoryId: 'ORIGINAL_ASSET', variant: '水印_旧版', updatedAt: '2026-08-25T00:00:00Z' },
    { assetId: 'new', categoryId: 'ORIGINAL_ASSET', file: { name: 'watermark_shop.psd' }, updatedAt: '2026-08-26T00:00:00Z' },
    { assetId: 'prop', categoryId: 'ORIGINAL_ASSET', variant: '礼物盒', updatedAt: '2026-08-27T00:00:00Z' },
  ] };
  const activeWatermarkAsset = new Function('S','isWatermarkAsset', `${sourceOf('activeWatermarkAsset')}\nreturn activeWatermarkAsset;`)(S, isWatermarkAsset);
  assert.equal(isWatermarkName('水印_画师.psd'), true);
  assert.equal(isWatermarkAsset(S.assets[2]), false);
  assert.equal(activeWatermarkAsset().assetId, 'new', 'the most recently updated watermark becomes the default');
});

test('standardized Chinese asset names are inferred without changing the PSD parser', () => {
  assert.match(html, /\^\(\?:衬底\|BACKDROP\)\[_\\-\\s\]/);
  assert.match(html, /\^\(\?:衣服\|服装\|CLOTHING\)\[_\\-\\s\]/);
  assert.match(html, /\^\(\?:姿势\|身体姿势\|BODY_POSE\|POSE\)\[_\\-\\s\]/);
  assert.match(html, /n\.includes\('HAIR'\)\|\|n\.includes\('头发'\)/);
  assert.match(html, /n\.includes\('MOUTH'\)\|\|n\.includes\('嘴'\)\|\|n\.includes\('表情'\)/);
  assert.match(html, /\^\(\?:原创素材\|ORIGINAL_ASSET\)\[_\\-\\s\]/);
  assert.match(html, /isPngAssetFile\(file\)\?'AUXILIARY_ASSET':'EAR'/);
});

test('clothing PSDs are packages whose root folders become independent flexible components', () => {
  assert.match(html, /\{id:'CLOTHING',name:'衣服素材包',builtin:true\}/);
  assert.match(html, /function assetPackageComponentGroups\(psd,categoryId,order=assetPsdDrawOrder\(psd\)\)/);
  assert.match(html, /function assetGroupAlphaCenter\(psd,groupPath\)/);
  assert.match(html, /const alphaCenter=assetGroupAlphaCenter\(psd,groupPath\)/);
  assert.match(html, /const components=assetPackageComponentGroups\(psd,categoryId,order\)/);
  assert.match(html, /displayName=components\.length===1\?variant:`\$\{variant\} · \$\{componentName/);
  assert.match(html, /packageName:variant,componentName,componentOrder:component\.componentOrder/);
  assert.match(html, /function assetPackageRecordsForFamily\(familyKey\)/);
  assert.match(html, /records=assetPackageRecordsForFamily\(familyKey\)\.filter/);
  assert.match(html, /function clothingStackIds\(\)/);
  assert.match(html, /ids\.splice\(hairBottom>=0\?hairBottom\+1:0,0,\.\.\.clothes\)/);
  assert.match(html, /const cleaned=out\.filter\(id=>validLayers\.has\(id\)\|\|validAssets\.has\(id\)\|\|hairIds\.includes\(id\)\)/);
  assert.match(html, /isClothingCategory\(asset\.categoryId\)\|\|asset\.categoryId==='ORIGINAL_ASSET'/);

  const sourceOf = name => {
    const start = html.indexOf(`function ${name}(`);
    const end = html.indexOf('\nfunction ', start + 1);
    assert.ok(start >= 0 && end > start, `${name} should be extractable`);
    return html.slice(start, end);
  };
  const groupSource = sourceOf('assetPackageComponentGroups');
  const componentGroups = new Function(
    'isClothingCategory','assetPsdDrawOrder','shouldExclude','flatten','inferAssetLayerRole','orderChildren',
    `${groupSource}\nreturn assetPackageComponentGroups;`,
  )(
    id => id === 'CLOTHING', () => ({ mode: 'reverse' }), name => /背景/.test(name),
    (children, _depth, parentPath) => children.map(layer => ({
      isGroup: false, layer, name: layer.name, path: `${parentPath}/${layer.name}`,
    })),
    path => /底色|重色|线稿/.test(path) ? 'COMPONENT_BASE' : 'NONE',
    (children, mode) => mode === 'reverse' ? [...children].reverse() : [...children],
  );
  const psd = { children: [
    { name: '背景', children: [{ name: '背景图', canvas: {} }] },
    { name: '衣服', children: [{ name: '衣服底色', canvas: {} }] },
    { name: '领带', children: [{ name: '领带重色', canvas: {} }] },
    { name: '领带夹', children: [{ name: '领带夹线稿', canvas: {} }] },
  ] };
  assert.deepEqual(componentGroups(psd, 'CLOTHING', { mode: 'reverse' }).map(x => x.name), ['衣服', '领带', '领带夹']);
});

test('clothing library shows one collapsible PSD package with compact component colors', () => {
  assert.match(html, /function clothingPackageGroups\(\)/);
  assert.match(html, /function renderClothingPackageCards\(details,order,packages\)/);
  assert.match(html, /className='clothingPackageCard'/);
  assert.match(html, /整个 PSD 预览/);
  assert.match(html, /clothingComponentList/);
  assert.match(html, /category\.id==='CLOTHING'\?clothingPackages\.length:category\.id==='BODY_POSE'\?bodyPosePackages\.length:groups\.length/);
  assert.match(html, /compactComponentColors/);
  assert.match(html, /底色 <input type="color" data-component-color="base"/);
  assert.match(html, /重色 <input type="color" data-component-color="shadow"/);
  assert.match(html, /S\.clothingPackageOpen\[pkg\.key\]=card\.open/);
});

test('body poses are packaged by pose with independent A/B male and female choices', () => {
  assert.match(html, /\{id:'BODY_POSE',name:'身体姿势',builtin:true\}/);
  assert.match(html, /function bodyPoseGender\(value\)/);
  assert.match(html, /function bodyPosePackageComponentGroups\(psd,order=assetPsdDrawOrder\(psd\),fallbackSlot='A'\)/);
  assert.match(html, /身体姿势 PSD 中没有找到 A男 \/ A女 \/ B男 \/ B女/);
  assert.match(html, /packageName:variant,componentName:genderLabel/);
  assert.match(html, /function bodyPosePackageGroups\(\)/);
  assert.match(html, /function renderBodyPosePackageCards\(details,order,packages\)/);
  assert.match(html, /data-ak=\"body-pose-choice\"/);
  assert.match(html, /A\/B 各自选择男、女或关闭/);
  assert.match(html, /function bodyPoseStackIds\(\)/);
  assert.match(html, /function enabledBodyPoseForSlot\(slot\)/);
  assert.match(html, /templateBodyReplacementSlot\(path,name\)/);
  assert.match(html, /bodyReplacementSlot&&enabledBodyPoseForSlot\(bodyReplacementSlot\)\)return/);
  assert.match(html, /保持 PSD 原色 · 衣服下方 \/ 后发上方/);

  const sourceOf = name => {
    const start = html.indexOf(`function ${name}(`);
    const end = html.indexOf('\nfunction ', start + 1);
    assert.ok(start >= 0 && end > start, `${name} should be extractable`);
    return html.slice(start, end);
  };
  const bodyTemplatePart = new Function(`${sourceOf('bodyTemplatePart')}\nreturn bodyTemplatePart;`)();
  const primaryBodyTemplatePart = new Function(`${sourceOf('primaryBodyTemplatePart')}\nreturn primaryBodyTemplatePart;`)();
  const faceTemplatePart = new Function(`${sourceOf('faceTemplatePart')}\nreturn faceTemplatePart;`)();
  const fixedFrontTemplatePart = new Function(`${sourceOf('fixedFrontTemplatePart')}\nreturn fixedFrontTemplatePart;`)();
  const bodyReplacementSlot = new Function(
    'faceTemplatePart','fixedFrontTemplatePart','bodyTemplatePart','guessSlot','enabledBodyPoseForSlot',
    `${sourceOf('templateBodyReplacementSlot')}\nreturn templateBodyReplacementSlot;`,
  )(faceTemplatePart, fixedFrontTemplatePart, bodyTemplatePart, path => /^A/.test(path) ? 'A' : /^B/.test(path) ? 'B' : 'NONE', () => ({}));
  const namedRootSlot = new Function(
    'guessSlot', `${sourceOf('namedRootSlot')}\nreturn namedRootSlot;`,
  )(value => /^A/.test(value) ? 'A' : /^B/.test(value) ? 'B' : 'NONE');
  const rootBodySlot = new Function(
    'primaryBodyTemplatePart','faceTemplatePart','namedRootSlot',
    `${sourceOf('rootBodyLayerSlot')}\nreturn rootBodyLayerSlot;`,
  )(primaryBodyTemplatePart, faceTemplatePart, namedRootSlot);
  assert.equal(bodyReplacementSlot('A脸部手部/面部底色', '面部底色'), null, 'combined face/hand folders must remain visible');
  assert.equal(bodyReplacementSlot('A身体/A身体女', 'A身体女'), 'A');
  assert.equal(bodyReplacementSlot('A手部前置/手部底色', '手部底色'), null, 'fixed foreground hands must remain visible with every pose');
  assert.equal(bodyReplacementSlot('A前置项/装饰', '装饰'), null, 'the future foreground naming convention must remain visible');
  assert.equal(rootBodySlot({ name: 'A脸部手部' }, 'layer:A脸部手部'), null);
  assert.equal(rootBodySlot({ name: 'A手部前置' }, 'layer:A手部前置'), null);
  assert.equal(rootBodySlot({ name: 'A身体' }, 'layer:A身体'), 'A');

  const flattenTree = (children, depth = 0, parentPath = '') => (children || []).flatMap((layer, index) => {
    const name = layer.name || `Layer ${index}`, path = parentPath ? `${parentPath}/${name}` : name;
    const node = { layer, name, path, depth, isGroup: !!(layer.children && layer.children.length) };
    return [node, ...(node.isGroup ? flattenTree(layer.children, depth + 1, path) : [])];
  });
  const bodyPoseGenderFn = new Function(`${sourceOf('bodyPoseGender')}\nreturn bodyPoseGender;`)();
  const bodyGroups = new Function(
    'assetPsdDrawOrder','flatten','shouldExclude','bodyPoseGender','guessSlot','inferAssetGroupSlot','orderChildren',
    `${sourceOf('bodyPosePackageComponentGroups')}\nreturn bodyPosePackageComponentGroups;`,
  )(
    () => ({ mode: 'direct' }), flattenTree, () => false, bodyPoseGenderFn,
    path => /^A(?:\/|男|女)/.test(path) ? 'A' : /^B(?:\/|男|女)/.test(path) ? 'B' : 'NONE',
    (_psd, _path, _name, fallback) => fallback,
    children => [...children],
  );
  const pixel = name => ({ name, canvas: {} });
  const psd = { children: [
    { name: 'A', children: [{ name: '男', children: [pixel('身体')] }, { name: '女', children: [pixel('身体')] }] },
    { name: 'B男', children: [{ name: '男身体', children: [pixel('底色')] }, pixel('线稿')] },
    { name: 'B女', children: [pixel('身体')] },
  ] };
  const detected = Object.fromEntries(bodyGroups(psd, { mode: 'direct' }).map(x => [x.path, `${x.slot}:${x.gender}`]));
  assert.deepEqual(detected, { 'A/男': 'A:MALE', 'A/女': 'A:FEMALE', B男: 'B:MALE', B女: 'B:FEMALE' });
});

test('phase four accepts transparent PNG assets without PSD parsing', () => {
  assert.match(html, /accept="\.psd,\.png,image\/vnd\.adobe\.photoshop,image\/png"/);
  assert.match(html, /function isPngAssetFile\(file\)/);
  assert.match(html, /async function loadPngCanvas\(file\)/);
  assert.match(html, /function makeRasterAssetRecord\(file,canvas,slot,type,variant,metadata=\{\}\)/);
  assert.match(html, /sourceFormat:'PNG'/);
  assert.match(html, /originalComposite:canvas/);
  assert.match(html, /a\.psd\|\|a\.composite/);
  assert.match(html, /records=assetPackageRecordsForFamily\(familyKey\)\.filter\(a=>a\.psd\|\|a\.composite\)/);
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
  assert.match(html, /const STACKABLE_ASSET_CATEGORIES=new Set\(\['CLOTHING','ORIGINAL_ASSET','AUXILIARY_ASSET'\]\)/);
  assert.match(html, /function ensureOrderMultiAssetSelections\(order\)/);
  assert.match(html, /function selectedAssetFamilies\(order,slot,categoryId\)/);
  assert.match(html, /if\(isStackableAssetCategory\(a\.categoryId\)\)\{a\.enabled=isAssetFamilySelected/);
  assert.match(html, /if\(on&&!list\.includes\(familyKey\)\)list\.push\(familyKey\)/);
  assert.match(html, /可多选叠加/);
});

test('phase four eye-state PSDs follow the selected A or B eye scheme', () => {
  assert.match(html, /id:'EYE',name:'眼睛状态'/);
  assert.match(html, /EYE:\['NONE','EYE_PUPIL','EYE_IRIS_BASE'/);
  assert.match(html, /if\(type==='EYE'\)\{/);
  assert.match(html, /asset\.type==='HAT_DECOR'\|\|asset\.type==='HAIR'\|\|asset\.type==='EYE'/);
  assert.match(html, /category\.id==='EYE'\?'跟随当前眼睛方案'/);
  assert.match(html, /assetSelections:\{A:\{\},B:\{\}\}/);
  assert.match(html, /function enabledEyeStateForSlot\(slot\)/);
  assert.match(html, /function rootEyeLayerSlot\(layer,id\)/);
  assert.match(html, /eyeReplacementSlot&&enabledEyeStateForSlot\(eyeReplacementSlot\)\)return/);
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
  assert.match(html, /if\(aProfile\)o\.A\.eyeSchemeId=aProfile\.id;else if\(ae\)\{o\.A\.eye=ae;o\.A\.eyeSchemeId='AUTO_V3'/);
  assert.match(html, /if\(bProfile\)o\.B\.eyeSchemeId=bProfile\.id;else if\(be\)\{o\.B\.eye=be;o\.B\.eyeSchemeId='AUTO_V3'/);
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

test('phase four cleanup removes legacy templates, hair, borders, and small items while protecting ears and tails', () => {
  assert.match(html, /const LEGACY_PURGE_CATEGORIES=new Set\(\['HAIR','FRAME','PROP','ACCESSORY'\]\)/);
  assert.match(html, /async function purgePhase4LegacyLocalLibrary\(\)/);
  assert.match(html, /for\(const meta of templates\)\{await Promise\.all\(\[localDelete\('templateCatalog'/);
  assert.match(html, /if\(afterProtected!==beforeProtected\)throw new Error\('清理保护检查失败：耳朵或尾巴数量发生变化/);
  assert.match(html, /isSessionOnlyAssetCategory\(sample\.categoryId\)\)return/);
});

test('flexible form binds template or asset components and derives four HSL channels from base color', () => {
  assert.match(html, /function flexibleComponentCandidates\(slot\)/);
  assert.match(html, /sourceType:'TEMPLATE'/);
  assert.match(html, /\['EAR','TAIL','CLOTHING','REUSABLE_HAIR','TEMP_HAIR','ORIGINAL_ASSET'\]\.includes\(a\.categoryId\)/);
  assert.match(html, /function applyFlexibleTemplateColors\(order\)/);
  assert.match(html, /PHASE4_COLOR\.deriveBasicComponent\(base,\{overrides:shadow\?\{shadow\}:\{\}\}\)/);
  assert.match(html, /公共灵活组件/);
  assert.match(html, /data-flex-preset/);
  assert.match(html, /phase4CompatHidden/);
  assert.match(html, /syncParsedFlexibleComponents\(o,'A'\);syncParsedFlexibleComponents\(o,'B'\)/);
});

test('slotless template decorations such as gift boxes and balloons appear in a shared flexible form', () => {
  const start = html.indexOf('function flexibleComponentCandidates(');
  const end = html.indexOf('\nfunction flexibleDefaultBase(', start);
  assert.ok(start >= 0 && end > start);
  const S = { master: {}, assets: [], flat: [
    { isGroup: true, depth: 0, name: '礼物盒', path: '礼物盒' },
    { isGroup: false, depth: 1, name: '礼物盒底色', path: '礼物盒/礼物盒底色' },
    { isGroup: true, depth: 0, name: '气球', path: '气球' },
    { isGroup: false, depth: 1, name: '圆形气球', path: '气球/圆形气球' },
    { isGroup: true, depth: 0, name: '影子', path: '影子' },
    { isGroup: false, depth: 1, name: '影子', path: '影子/影子' },
    { isGroup: true, depth: 0, name: '眉毛组', path: '眉毛组' },
    { isGroup: false, depth: 1, name: 'A眉毛', path: '眉毛组/A眉毛' },
    { isGroup: true, depth: 0, name: 'A衣服', path: 'A衣服' },
    { isGroup: false, depth: 1, name: 'A衣服底色', path: 'A衣服/A衣服底色' },
  ] };
  const guessSlot = path => /^A(?:位|衣服)/.test(String(path || '')) ? 'A' : /^B(?:位|衣服)/.test(String(path || '')) ? 'B' : 'NONE';
  const candidates = new Function('S','guessSlot','isFixedBodyComponentName', `${html.slice(start, end)}\nreturn flexibleComponentCandidates;`)(S, guessSlot, () => false);
  assert.deepEqual(candidates('GLOBAL').map(x => x.name), ['礼物盒', '气球']);
  assert.deepEqual(candidates('A').map(x => x.name), ['A衣服']);
  assert.match(html, /flexibleComponents:\{A:\[\],B:\[\],GLOBAL:\[\]\}/);
  assert.match(html, /\['A','B','GLOBAL'\]\.forEach\(slot=>/);
  assert.match(html, /makeFlexibleComponentPanel\('GLOBAL'\)/);
  assert.match(html, /renderEditableLayerSelectors\(\);renderHairInsertionControls\(\);renderFlexibleComponentPanels\(\);syncProductionPreview\(\)/);
  assert.match(html, /气球\(\?:底色\)\?\$\/\.test\(text\)\)return 'base'/);
});

test('flexible base and shadow controls keep generated colors active and refresh automatic shadow', () => {
  assert.match(html, /explicitShade\|\|\(explicitBase\?decorShadeFromBase\(base\):\(originalShade\|\|decorShadeFromBase\(base\)\)\)/);
  assert.match(html, /setLinkedColor\(prefix\+'DecorBase',base,true\)/);
  assert.match(html, /setLinkedColor\(prefix\+'DecorShade',shadow,true\)/);
  assert.match(html, /setLinkedColor\(slot\.toLowerCase\(\)\+'Hair',base\)/);
  assert.match(html, /if\(channel==='base'\)updateFlexibleAutoShadowControl\(row,entry,slot,order\)/);

  const sourceOf = name => {
    const start = html.indexOf(`function ${name}(`);
    const end = html.indexOf('\nfunction ', start + 1);
    return html.slice(start, end);
  };
  const normalizeHex = value => /^#[0-9A-F]{6}$/i.test(String(value || '')) ? String(value).toUpperCase() : '';

  const sharedDecorPalette = new Function(
    'matchedDecorTeam','normalizeHex','assetOriginalRoleColor','activeDecorBaseColor','decorShadeFromBase','hatOutlineColor',
    `${sourceOf('sharedDecorPalette')}\nreturn sharedDecorPalette;`,
  )(
    () => ({ ear: {}, tail: {} }), normalizeHex,
    (_asset, role) => role === 'DECOR_BASE' ? '#AAAAAA' : role === 'DECOR_SHADOW' ? '#777777' : null,
    () => '#AAAAAA', () => '#B4C1E0', () => '#554455',
  );
  assert.equal(sharedDecorPalette('A', { A: { decorBase: '#D6E2FF', decorShade: '' } }).shade, '#B4C1E0');
  assert.equal(sharedDecorPalette('A', { A: { decorBase: '#D6E2FF', decorShade: '#123456' } }).shade, '#123456');
  assert.equal(sharedDecorPalette('A', { A: { decorBase: '', decorShade: '' } }).shade, '#777777');

  const ear = { categoryId: 'EAR', slot: 'A' };
  const hair = { categoryId: 'REUSABLE_HAIR', slot: 'B' };
  const linked = [];
  const syncFlexibleAssetColor = new Function(
    'flexibleAssetForEntry','normalizeHex','flexibleDefaultBase','isHairCategory','setLinkedColor',
    `${sourceOf('syncFlexibleAssetColor')}\nreturn syncFlexibleAssetColor;`,
  )(
    entry => entry.sourceKey === 'ear' ? ear : hair, normalizeHex, () => '#FFE5F3',
    category => category === 'REUSABLE_HAIR' || category === 'TEMP_HAIR',
    (prefix, value, allowBlank) => linked.push({ prefix, value, allowBlank }),
  );
  const order = { A: {}, B: { hair: '#111111' }, componentColors: { A: {}, B: {} }, assetComponentColors: {} };
  syncFlexibleAssetColor({ sourceKey: 'ear', base: '#D6E2FF', shadow: '' }, 'A', order);
  assert.deepEqual({ base: order.A.decorBase, shadow: order.A.decorShade }, { base: '#D6E2FF', shadow: '' });
  assert.deepEqual(linked.slice(0, 2), [
    { prefix: 'aDecorBase', value: '#D6E2FF', allowBlank: true },
    { prefix: 'aDecorShade', value: '', allowBlank: true },
  ]);
  syncFlexibleAssetColor({ sourceKey: 'hair', base: '#B597AE', shadow: '#76516D' }, 'B', order);
  assert.equal(order.B.hair, '#B597AE');
  assert.deepEqual(order.componentColors.B.HAIR.overrides, { shadow: '#76516D' });
  assert.deepEqual(order.assetComponentColors['hair::B'], { base: '#B597AE', shadow: '#76516D', useGeneratedColor: true });
  assert.deepEqual(linked[2], { prefix: 'bHair', value: '#B597AE', allowBlank: undefined });

  const updateFlexibleAutoShadowControl = new Function(
    'normalizeHex','flexibleDefaultBase','flexibleAssetForEntry','isHairCategory','PHASE4_COLOR',
    `${sourceOf('updateFlexibleAutoShadowControl')}\nreturn updateFlexibleAutoShadowControl;`,
  )(
    normalizeHex, () => '#FFE5F3', () => null, () => false,
    { deriveBasicComponent: () => ({ shadow: '#AABBCC' }), deriveHairComponent: () => ({ shadow: '#CCDDEE' }) },
  );
  const shadowHex = {}, shadowColor = {};
  const row = { querySelector: selector => selector.includes('hex') ? shadowHex : shadowColor };
  assert.equal(updateFlexibleAutoShadowControl(row, { base: '#D6E2FF', shadow: '' }, 'A', order), '#AABBCC');
  assert.equal(shadowHex.placeholder, '自动 #AABBCC');
  assert.equal(shadowColor.value, '#aabbcc');

  const updateHairAutoShadow = new Function(
    'normalizeHex','flexibleDefaultBase','flexibleAssetForEntry','isHairCategory','PHASE4_COLOR',
    `${sourceOf('updateFlexibleAutoShadowControl')}\nreturn updateFlexibleAutoShadowControl;`,
  )(
    normalizeHex, () => '#FFE5F3', () => hair, category => category === 'REUSABLE_HAIR',
    { deriveBasicComponent: () => ({ shadow: '#AABBCC' }), deriveHairComponent: () => ({ shadow: '#CCDDEE' }) },
  );
  assert.equal(updateHairAutoShadow(row, { sourceType: 'ASSET', base: '#FCF9FB', shadow: '' }, 'B', order), '#CCDDEE');
  assert.equal(shadowHex.placeholder, '自动 #CCDDEE');
  assert.equal(shadowColor.value, '#ccddee');
});

test('hair preserves PSD color until an order explicitly enables generated colors', () => {
  assert.match(html, /rec\.hairPlacement=placement;rec\.colorMode='PRESERVE_ORIGINAL'/);
  assert.match(html, /isHairCategory\(asset\.categoryId\)\?instanceState\.useGeneratedColor===true/);
  assert.match(html, /useGeneratedColor:true/);
  assert.match(html, /当前保持 PSD 原色；选择或手调颜色后才会生色/);
  assert.match(html, /恢复原色/);
  assert.match(html, /\^\(\?:肤色\|skin/);
  assert.match(html, /hairSlot=prefix==='aHair'\?'A':prefix==='bHair'\?'B':null/);
  assert.match(html, /enableSelectedHairGeneratedColor\('B',bf,o\)/);
  assert.match(html, /enableSelectedHairGeneratedColor\(slot,o\[slot\]\.hair,o\)/);
  assert.match(html, /if\(kind==='HAIR'\)return PHASE4_COLOR\.deriveHairComponent\(base,\{overrides\}\)/);
  assert.match(html, /function hairColorPresets\(\)/);
  assert.match(html, /\{name:'金色',hex:'#FAEFE7'\},\{name:'银白',hex:'#FCF9FB'\}/);
  assert.match(html, /当前已启用头发专用生色/);
  assert.match(html, /function syncSelectedHairFlexibleComponent\(order,slot,asset=selectedHairAssetForSlot\(slot,order\),on=!!asset\)/);
  assert.match(html, /if\(isHairCategory\(categoryId\)\)syncSelectedHairFlexibleComponent\(order,slot,record,on\)/);
  assert.match(html, /generatedHair=isHairCategory\(a\.categoryId\)&&order\?\.assetComponentColors\?\.\[instanceKey\]\?\.useGeneratedColor===true/);
  assert.match(html, /const generatedComponent=a\.colorModeExplicit===true&&a\.colorMode==='FOLLOW_ORDER'/);
  assert.match(html, /if\(!generatedComponent&&!generatedHair/);

  const names = ['selectedHairAssetForSlot', 'enableSelectedHairGeneratedColor'];
  const sources = names.map(name => {
    const start = html.indexOf(`function ${name}(`);
    const end = html.indexOf('\nfunction ', start + 1);
    return html.slice(start, end);
  }).join('\n');
  const hair = { categoryId: 'REUSABLE_HAIR', slot: 'B', variant: '头发_测试' };
  const order = {
    A: { hair: '#AAAAAA' }, B: { hair: '#B597AE' },
    assetSelections: { A: {}, B: { REUSABLE_HAIR: 'REUSABLE_HAIR::hair-b' } },
    assetComponentColors: {},
  };
  const helpers = new Function(
    'S','getActiveOrder','ensureOrderAssetSelections','assetRecordForFamilySlot','isHairCategory','assetFamilyKey','normalizeHex','hairPlacementForAsset',
    `${sources}\nreturn {${names.join(',')}};`,
  )(
    { assets: [hair] },
    () => order,
    current => current.assetSelections,
    (key, slot) => key === 'REUSABLE_HAIR::hair-b' && slot === 'B' ? hair : null,
    categoryId => categoryId === 'REUSABLE_HAIR' || categoryId === 'TEMP_HAIR',
    () => 'REUSABLE_HAIR::hair-b',
    value => /^#[0-9A-F]{6}$/i.test(String(value || '')) ? String(value).toUpperCase() : '',
    () => 'FRONT',
  );
  assert.equal(helpers.enableSelectedHairGeneratedColor('B', '#8FA0C7', order), hair);
  assert.deepEqual(order.assetComponentColors['REUSABLE_HAIR::hair-b::B'], {
    base: '#8FA0C7', useGeneratedColor: true,
  });
  assert.equal(order.assetComponentColors['REUSABLE_HAIR::hair-b::A'], undefined);

  const syncSource = (() => {
    const start = html.indexOf('function syncSelectedHairFlexibleComponent(');
    const end = html.indexOf('\nfunction ', start + 1);
    assert.ok(start >= 0 && end > start, 'hair flexible-anchor helper should be extractable');
    return html.slice(start, end);
  })();
  const hairA = { categoryId: 'REUSABLE_HAIR', slot: 'A', variant: '旧头发' };
  const hairB = { categoryId: 'REUSABLE_HAIR', slot: 'B', variant: '女齐刘海长发' };
  const syncOrder = {
    flexibleComponents: { A: [], B: [{ id: 'old', sourceType: 'ASSET', sourceKey: 'REUSABLE_HAIR::old', name: '旧头发', base: '', shadow: '' }] },
    assetComponentColors: { 'REUSABLE_HAIR::hair-b::B': { base: '#D6E2FF', shadow: '#AABBCC', useGeneratedColor: true } },
  };
  const syncSelectedHairFlexibleComponent = new Function(
    'selectedHairAssetForSlot','ensureFlexibleComponents','isHairCategory','assetFamilyKey','flexibleAssetForEntry','assetSourceName','normalizeHex',
    `${syncSource}\nreturn syncSelectedHairFlexibleComponent;`,
  )(
    () => hairB,
    (current, slot) => current.flexibleComponents[slot],
    categoryId => categoryId === 'REUSABLE_HAIR' || categoryId === 'TEMP_HAIR',
    asset => asset === hairB ? 'REUSABLE_HAIR::hair-b' : 'REUSABLE_HAIR::old',
    entry => entry.sourceKey === 'REUSABLE_HAIR::old' ? hairA : entry.sourceKey === 'REUSABLE_HAIR::hair-b' ? hairB : null,
    asset => asset.variant,
    value => /^#[0-9A-F]{6}$/i.test(String(value || '')) ? String(value).toUpperCase() : '',
  );
  const anchored = syncSelectedHairFlexibleComponent(syncOrder, 'B', hairB, true);
  assert.equal(anchored.changed, true);
  assert.deepEqual(syncOrder.flexibleComponents.B.map(x => ({ sourceKey: x.sourceKey, base: x.base, shadow: x.shadow })), [
    { sourceKey: 'REUSABLE_HAIR::hair-b', base: '#D6E2FF', shadow: '#AABBCC' },
  ]);
});

test('global backdrop rendering never enters A/B ear-tail matching', () => {
  assert.match(html, /const isDecorAsset=asset\.categoryId==='EAR'\|\|asset\.categoryId==='TAIL'/);
  assert.match(html, /team=isDecorAsset\?matchedDecorTeam\(asset\.slot,order\):null/);
});

test('template flexible fields persist by template while body groups stay fixed', () => {
  assert.match(html, /TEMPLATE_FLEX_SCHEMA_PREFIX='shine:template-flex-schema:v1:'/);
  assert.match(html, /function mergeTemplateFlexibleSchema\(order,signature=S\.templateSignature\)/);
  assert.match(html, /function saveTemplateFlexibleSchema\(order,signature=S\.templateSignature\)/);
  assert.match(html, /模板夹子随模板复用；素材选择随订单/);
  assert.match(html, /function isFixedBodyComponentName\(value\)/);
  for (const name of ['脸部','手部','腿部','颈部']) assert.match(html, new RegExp(name));
  assert.match(html, /\(\?:固定\)\?前置/);
});

test('outfit and matched animal outlines use the legacy low-chroma recipes', () => {
  assert.match(html, /function legacyHatOutlineFromBase\(hat\)/);
  assert.match(html, /function legacyOutfitLineFromBase\(outfit,scheme=null\)/);
  assert.match(html, /if\(kind==='OUTFIT'.*legacyOutfitLineFromBase/s);
  assert.match(html, /function matchedDecorTeam\(slot,order\)/);
  assert.match(html, /return \{team,base,shade,outline:hatOutlineColor\(slot,order\)\}/);
  assert.match(html, /不再为一次灵活组件选择重绘整个素材库/);
});

test('background supports approved presets, three output modes, and a single recolorable backdrop', () => {
  for (const hex of ['#FFF0DF','#FFEBF1','#F6EBFF','#EBF2FF','#E8E8E8','#FFEEE3']) assert.match(html, new RegExp(hex));
  assert.match(html, /backgroundMode:'COLOR'/);
  assert.match(html, /\['COLOR','WHITE','TRANSPARENT'\]/);
  assert.match(html, /id="bgBackdropQuick"/);
  assert.match(html, /id="envLightEnabledQuick"/);
  assert.match(html, /if\(envToggle\)setOrderEnvironmentLightEnabled/);
  assert.match(html, /const showBackdrop=\(order\.backgroundMode\|\|'COLOR'\)==='COLOR'/);
  assert.match(html, /const showLace=false/);
});

test('eye profiles match character aliases before color anchors and single-layer editing uses four-level navigation', () => {
  assert.match(html, /function eyeProfileForCharacter\(name,slot\)/);
  assert.match(html, /characterAliases/);
  assert.match(html, /if\(aProfile\)o\.A\.eyeSchemeId=aProfile\.id/);
  assert.match(html, /id="eyeSchemeAliases"/);
  assert.match(html, /component\.id='quickComponent'/);
  assert.match(html, /大 PSD → 大夹子 → 小图层 → HEX/);
});

test('the main inline browser program parses as JavaScript', () => {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1])
    .filter(source => source.trim());
  assert.ok(scripts.length > 0);
  assert.doesNotThrow(() => new Function(scripts.at(-1)));
});
