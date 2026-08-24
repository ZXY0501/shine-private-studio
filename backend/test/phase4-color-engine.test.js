'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const color = require('../../phase4-color-engine.js');

test('basic HSL recipe follows the approved warm/cold and channel formulas', () => {
  const warm = color.deriveBasicComponent('#F29A55');
  const cool = color.deriveBasicComponent('#7EC8F5');
  const warmBase = color.hexToHsl('#F29A55');
  const warmShadow = color.hexToHsl(warm.shadow);
  const coolBase = color.hexToHsl('#7EC8F5');
  const coolShadow = color.hexToHsl(cool.shadow);

  assert.equal(warm.recipeId, 'BASIC_HSL_V1');
  assert.ok(Math.abs(color.shortestHueDelta(warmBase.h, warmShadow.h) - 20) < 1.5);
  assert.ok(Math.abs(color.shortestHueDelta(coolBase.h, coolShadow.h) + 20) < 1.5);
  assert.ok(color.hexToHsl(warm.lineart).s <= 0.555);
  assert.ok(color.hexToHsl(warm.shadow).s <= 0.455);
});

test('environment hue interpolation crosses zero by the shortest path', () => {
  assert.equal(color.lerpHueShortest(350, 10, 0.5), 0);
  assert.equal(color.lerpHueShortest(10, 350, 0.5), 0);
  const result = color.deriveBasicComponent('#F45B74', { environmentHex: '#FF7043' });
  const base = color.hexToHsl('#F45B74');
  const environment = color.hexToHsl('#FF7043');
  const shadow = color.hexToHsl(result.shadow);
  const expected = color.lerpHueShortest(base.h, environment.h, 0.15);
  assert.ok(Math.abs(color.shortestHueDelta(expected, shadow.h)) < 1.5);
});

test('near-white components use the calibrated neutral branch', () => {
  const result = color.deriveBasicComponent('#FAF8FC', { environmentHex: '#8FA0C7' });
  assert.equal(result.neutralBranch, true);
  assert.notEqual(result.lineart, '#FFFFFF');
  assert.notEqual(result.shadow, '#FFFFFF');
  assert.ok(color.hexToHsl(result.lineart).l < color.hexToHsl(result.shadow).l);
});

test('manual component channel overrides take precedence without changing the base recipe', () => {
  const result = color.deriveBasicComponent('#B7D9AB', { overrides: { shadow: '#123456' } });
  assert.equal(result.base, '#B7D9AB');
  assert.equal(result.shadow, '#123456');
  assert.match(result.lineart, /^#[0-9A-F]{6}$/);
});

test('hair has an independent muted recipe with exact gold and silver-white presets', () => {
  const gold = color.deriveHairComponent('#FAEFE7');
  const silver = color.deriveHairComponent('#FCF9FB');
  assert.deepEqual(
    { base: gold.base, highlight: gold.highlight, lineart: gold.lineart, shadow: gold.shadow },
    { base: '#FAEFE7', highlight: '#FFFDFB', lineart: '#DBB8AB', shadow: '#E9CEC4' }
  );
  assert.deepEqual(
    { base: silver.base, highlight: silver.highlight, lineart: silver.lineart, shadow: silver.shadow },
    { base: '#FCF9FB', highlight: '#F6F3F7', lineart: '#C2C2C2', shadow: '#D0CDD9' }
  );
  assert.equal(gold.recipeId, 'HAIR_HSL_V1');
  assert.equal(silver.recipeId, 'HAIR_HSL_V1');

  const brown = color.deriveHairComponent('#5B4036');
  const clothing = color.deriveBasicComponent('#5B4036');
  assert.notEqual(brown.lineart, clothing.lineart, 'hair must not reuse the clothing recipe');
  assert.ok(color.hexToHsl(brown.lineart).s < color.hexToHsl('#5B4036').s);
  assert.ok(color.hexToHsl(brown.lineart).l < color.hexToHsl(brown.shadow).l);
  assert.ok(color.hexToHsl(brown.shadow).l < color.hexToHsl(brown.base).l);
  assert.ok(color.hexToHsl(brown.highlight).l > color.hexToHsl(brown.base).l);

  const overridden = color.deriveHairComponent('#C9AA76', { overrides: { shadow: '#123456' } });
  assert.equal(overridden.shadow, '#123456');
});

test('phase four hidden-color eye recipe produces all eight semantic layers', () => {
  const result = color.derivePhase4Eye('#BDACE4');
  assert.deepEqual(Object.keys(result), [
    'recipeId', 'pupil', 'irisBase', 'irisMid', 'irisDark',
    'irisHighlightMid', 'irisHighlight', 'outline', 'pupilHighlight'
  ]);
  assert.equal(result.recipeId, 'EYE_HIDDEN_PHASE4_V1');
  assert.equal(result.irisBase, '#BDACE4');
  assert.equal(result.pupilHighlight, '#FFFFFF');
  const hue = color.hexToHsl(result.irisBase).h;
  ['pupil', 'irisMid', 'irisDark', 'irisHighlightMid', 'irisHighlight', 'outline'].forEach(key => {
    assert.ok(Math.abs(color.shortestHueDelta(hue, color.hexToHsl(result[key]).h)) <= 5.1, key);
  });
});
