const assert = require('node:assert/strict');
const test = require('node:test');
const L = require('../../studio-color-link');

const recipe = () => ({ id: 'hair-gold', name: '金色', anchorHex: '#FAEFE7', layers: { base: '#FAEFE7', shadow: '#E9CEC4', lineart: '#DBB8AB', highlight: '#FFFDFB' } });
const identity = () => ['asset', 'template-v1', 'asset-001', '1', 'B', 'B/头发', 'HAIR'];
const driver = () => ({ base: '#FAEFE7', shadow: '', enabled: true });
const nodes = () => [
  { path: 'B/头发/底色', channel: 'base', key: 'base' },
  { path: 'B/头发/重色', channel: 'shadow', key: 'shadow' },
  { path: 'B/头发/线稿', channel: 'lineart', key: 'lineart' },
  { path: 'B/头发/高光', channel: 'highlight', key: 'highlight' },
  { path: 'B/头发/肤色', channel: 'base', key: 'skin', protected: true },
];

test('component identity is stable and distinguishes template, asset version, slot, and folder', () => {
  const parts = identity();
  assert.equal(L.stableId(parts), L.stableId(JSON.parse(JSON.stringify(parts))));
  const changes = { 0: 'template', 1: 'template-v2', 2: 'asset-002', 3: '2', 4: 'A', 5: 'B/后头发', 6: 'CLOTHING' };
  const ids = [L.stableId(parts)];
  for (const [index, value] of Object.entries(changes)) {
    const other = parts.slice(); other[index] = value; ids.push(L.stableId(other));
  }
  assert.equal(new Set(ids).size, ids.length, 'same display name cannot cause A/B or version cross-application');
});

test('frozen order colors survive later handbook, identity, and driver edits', () => {
  const r = recipe(), id = identity(), d = driver(), book = { version: 2 };
  const frozen = L.freeze(r, book, id, d);
  r.layers.base = '#000000'; r.anchorHex = '#111111'; id[4] = 'A'; d.base = '#222222'; book.version = 3;
  assert.equal(frozen.layers.base, '#FAEFE7');
  assert.equal(frozen.anchorHex, '#FAEFE7');
  assert.equal(frozen.identity[4], 'B');
  assert.equal(frozen.driver.base, '#FAEFE7');
  assert.equal(frozen.bookVersion, 2);
  assert.equal(frozen.recipeId, 'hair-gold');
  assert.equal(L.applicable(JSON.parse(JSON.stringify(frozen)), identity(), driver()), true, 'order reload keeps its frozen palette');
});

test('no selection and every changed color driver return no recipe override', () => {
  const frozen = L.freeze(recipe(), { version: 1 }, identity(), driver());
  assert.deepEqual(L.palette(null, identity(), driver(), nodes()), {});
  for (const d of [{ ...driver(), base: '#123456' }, { ...driver(), shadow: '#987654' }, { ...driver(), enabled: false }]) {
    assert.equal(L.applicable(frozen, identity(), d), false);
    assert.deepEqual(L.palette(frozen, identity(), d, nodes()), {}, 'manual base/shadow/original mode must not be overwritten by the frozen recipe');
  }
  const changedIdentity = identity(); changedIdentity[4] = 'A';
  assert.deepEqual(L.palette(frozen, changedIdentity, driver(), nodes()), {});
  assert.deepEqual(L.palette({ ...frozen, schemaVersion: 999 }, identity(), driver(), nodes()), {});
});

test('eye scheme and optional pupil anchor changes invalidate stale eye recipe drivers', () => {
  const id = ['template', 'template-v1', 'B', 'B/眼睛', 'EYE'];
  const d = { base: '#244A88', scheme: 'AUTO_V3', accent: '' };
  const frozen = L.freeze({ ...recipe(), id: 'eye-blue' }, { version: 1 }, id, d);
  assert.equal(L.applicable(frozen, id, { ...d, scheme: 'PHASE4_HIDDEN' }), false);
  assert.equal(L.applicable(frozen, id, { ...d, accent: '#F4C542' }), false);
});

test('palette uses exact recipe channels while protected skin stays untouched', () => {
  const frozen = L.freeze(recipe(), { version: 1 }, identity(), driver());
  assert.deepEqual(L.palette(frozen, identity(), driver(), nodes()), {
    'B/头发/底色': '#FAEFE7', 'B/头发/重色': '#E9CEC4', 'B/头发/线稿': '#DBB8AB', 'B/头发/高光': '#FFFDFB',
  });
  assert.equal(L.palette(frozen, identity(), driver(), nodes(), { 'B/头发/肤色': '#111111' })['B/头发/肤色'], undefined);
});

test('exact per-layer recipe is preferred over a shared channel and unknown layers stay original', () => {
  const r = recipe(); r.layers['line-front'] = '#AA8899'; r.layers['line-back'] = '#665566';
  const frozen = L.freeze(r, { version: 1 }, identity(), driver());
  assert.deepEqual(L.palette(frozen, identity(), driver(), [
    { path: 'front', key: 'line-front', channel: 'lineart' },
    { path: 'back', key: 'line-back', channel: 'lineart' },
    { path: 'ordinary', key: 'line-middle', channel: 'lineart' },
    { path: 'texture', key: 'texture', channel: null },
  ]), { front: '#AA8899', back: '#665566', ordinary: '#DBB8AB' });
});

test('manual valid HEX wins without mutating the frozen palette or manual cache', () => {
  const frozen = L.freeze(recipe(), { version: 1 }, identity(), driver());
  const manual = { 'B/头发/底色': '#abc123', 'B/头发/重色': 'not-a-color' };
  const originalFrozen = structuredClone(frozen), originalManual = structuredClone(manual);
  const palette = L.palette(frozen, identity(), driver(), nodes(), manual);
  assert.equal(palette['B/头发/底色'], '#ABC123');
  assert.equal(palette['B/头发/重色'], '#E9CEC4');
  assert.deepEqual(frozen, originalFrozen);
  assert.deepEqual(manual, originalManual);
});

test('role recognition preserves skin, fixed, fur, reference and watermark layers', () => {
  assert.equal(L.channel('HAIR_BASE', '底色'), 'base');
  assert.equal(L.channel('HAIR_OUTLINE', '线稿'), 'lineart');
  assert.equal(L.channel('OUTFIT_SHADOW', '重色'), 'shadow');
  assert.equal(L.channel('COMPONENT_HIGHLIGHT', '高光'), 'highlight');
  assert.equal(L.channel('NONE', '没有规范命名的图层'), null);
  for (const role of ['HAIR_SKIN_AIR_FIXED', 'HAIR_HIGHLIGHT_FIXED', 'FIXED', 'REFERENCE', 'WATERMARK_PREVIEW', 'DECOR_FUR', 'TAIL_FUR']) {
    assert.equal(L.channel(role, '底色'), null, role);
  }
  for (const name of ['肤色', '皮肤', '绒毛线稿']) assert.equal(L.channel('HAIR_BASE', name), null, name);
});

test('invalid recipe HEX cannot become an override or a CSS value', () => {
  for (const value of ['#fff', 'red', 'url(javascript:alert(1))', '#1234567', null, undefined, 123456]) assert.equal(L.hex(value), null);
  assert.equal(L.hex('#abcDEF'), '#ABCDEF');
  const r = recipe(); r.layers.base = 'red';
  assert.equal(L.palette(L.freeze(r, { version: 1 }, identity(), driver()), identity(), driver(), nodes())['B/头发/底色'], undefined);
});
