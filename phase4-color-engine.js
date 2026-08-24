(function attachShinePhase4ColorEngine(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ShinePhase4Color = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createShinePhase4ColorEngine() {
  'use strict';

  const BASIC_RECIPE_ID = 'BASIC_HSL_V1';
  const HAIR_RECIPE_ID = 'HAIR_HSL_V1';
  const EYE_RECIPE_ID = 'EYE_HIDDEN_PHASE4_V1';
  const HAIR_FIXED_PRESETS = Object.freeze({
    GOLD: Object.freeze({
      base: '#FAEFE7',
      highlight: '#FFFDFB',
      lineart: '#DBB8AB',
      shadow: '#E9CEC4'
    }),
    SILVER_WHITE: Object.freeze({
      base: '#FCF9FB',
      highlight: '#F6F3F7',
      lineart: '#C2C2C2',
      shadow: '#D0CDD9'
    })
  });

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function wrapHue(hue) {
    return ((Number(hue) % 360) + 360) % 360;
  }

  function shortestHueDelta(from, to) {
    return ((Number(to) - Number(from) + 540) % 360) - 180;
  }

  function lerpHueShortest(from, to, amount) {
    return wrapHue(Number(from) + shortestHueDelta(from, to) * clamp(Number(amount), 0, 1));
  }

  function normalizeHex(value) {
    const text = String(value || '').trim();
    const short = text.match(/^#([0-9a-f]{3})$/i);
    if (short) return '#' + short[1].split('').map(char => char + char).join('').toUpperCase();
    const full = text.match(/^#([0-9a-f]{6})$/i);
    return full ? '#' + full[1].toUpperCase() : null;
  }

  function hexToRgb(hex) {
    const value = normalizeHex(hex);
    if (!value) throw new TypeError('Expected a #RRGGBB color');
    return [1, 3, 5].map(index => parseInt(value.slice(index, index + 2), 16));
  }

  function rgbToHex(red, green, blue) {
    return '#' + [red, green, blue]
      .map(value => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  }

  function hexToHsl(hex) {
    const [red, green, blue] = hexToRgb(hex).map(value => value / 255);
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const chroma = max - min;
    let hue = 0;
    const lightness = (max + min) / 2;
    let saturation = 0;
    if (chroma > 0) {
      saturation = chroma / (1 - Math.abs(2 * lightness - 1));
      if (max === red) hue = 60 * (((green - blue) / chroma) % 6);
      else if (max === green) hue = 60 * ((blue - red) / chroma + 2);
      else hue = 60 * ((red - green) / chroma + 4);
    }
    return { h: wrapHue(hue), s: clamp(saturation, 0, 1), l: clamp(lightness, 0, 1), chroma };
  }

  function hslToHex(input) {
    const hue = wrapHue(input.h);
    const saturation = clamp(Number(input.s), 0, 1);
    const lightness = clamp(Number(input.l), 0, 1);
    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
    const section = hue / 60;
    const x = chroma * (1 - Math.abs((section % 2) - 1));
    const offset = lightness - chroma / 2;
    let rgb;
    if (section < 1) rgb = [chroma, x, 0];
    else if (section < 2) rgb = [x, chroma, 0];
    else if (section < 3) rgb = [0, chroma, x];
    else if (section < 4) rgb = [0, x, chroma];
    else if (section < 5) rgb = [x, 0, chroma];
    else rgb = [chroma, 0, x];
    return rgbToHex(...rgb.map(value => (value + offset) * 255));
  }

  function shadowHueShift(hue) {
    const h = wrapHue(hue);
    if (h <= 60 || h >= 300) return 20;
    if (h >= 180 && h <= 270) return -20;
    return 0;
  }

  function resolveOverride(value, fallback) {
    return normalizeHex(value) || fallback;
  }

  function neutralComponentColors(baseHex, base, environment, hueHint) {
    const referenceHue = environment ? environment.h : Number.isFinite(hueHint) ? wrapHue(hueHint) : base.h;
    const referenceSaturation = environment ? environment.s : 0;
    const lineSaturation = environment
      ? clamp(referenceSaturation * 0.18 + 0.025, 0.04, 0.14)
      : clamp(base.chroma * 2.2 + 0.025, 0.025, 0.12);
    const shadowSaturation = environment
      ? clamp(referenceSaturation * 0.24 + 0.035, 0.06, 0.22)
      : clamp(base.chroma * 2.6 + 0.02, 0.02, 0.12);
    return {
      recipeId: BASIC_RECIPE_ID,
      neutralBranch: true,
      base: baseHex,
      lineart: hslToHex({ h: referenceHue, s: lineSaturation, l: base.l - (base.l > 0.94 ? 0.36 : 0.40) }),
      shadow: hslToHex({ h: referenceHue, s: shadowSaturation, l: base.l - (base.l > 0.94 ? 0.13 : environment ? 0.07 : 0.08) }),
      highlight: hslToHex({ h: referenceHue, s: clamp(referenceSaturation * 0.035, 0, 0.025), l: Math.min(0.99, base.l + 0.02) })
    };
  }

  function deriveBasicComponent(baseValue, options = {}) {
    const baseHex = normalizeHex(baseValue);
    if (!baseHex) throw new TypeError('deriveBasicComponent requires a valid base color');
    const base = hexToHsl(baseHex);
    const environmentHex = normalizeHex(options.environmentHex);
    const environment = environmentHex ? hexToHsl(environmentHex) : null;
    const nearlyNeutral = base.chroma < 0.045 || base.s < 0.055;
    const generated = nearlyNeutral
      ? neutralComponentColors(baseHex, base, environment, options.hueHint)
      : {
          recipeId: BASIC_RECIPE_ID,
          neutralBranch: false,
          base: baseHex,
          lineart: hslToHex({ h: base.h, s: Math.min(0.55, base.s + 0.12), l: base.l - 0.40 }),
          shadow: hslToHex({
            h: environment ? lerpHueShortest(base.h, environment.h, 0.15) : wrapHue(base.h + shadowHueShift(base.h)),
            s: Math.min(0.45, base.s + 0.08),
            l: base.l - (environment ? 0.07 : 0.08)
          }),
          highlight: hslToHex({
            h: environment ? environment.h : base.h,
            s: base.s * 0.08,
            l: Math.min(0.99, base.l + 0.02)
          })
        };
    const overrides = options.overrides || {};
    return {
      ...generated,
      base: resolveOverride(overrides.base, generated.base),
      shadow: resolveOverride(overrides.shadow, generated.shadow),
      lineart: resolveOverride(overrides.lineart, generated.lineart),
      highlight: resolveOverride(overrides.highlight, generated.highlight)
    };
  }

  function hairShadowHue(hue) {
    const h = wrapHue(hue);
    if (h <= 70 || h >= 330) return wrapHue(h - 8);
    if (h >= 180 && h <= 270) return wrapHue(h + 8);
    if (h > 270 && h < 330) return wrapHue(h - 5);
    return h;
  }

  function deriveHairComponent(baseValue, options = {}) {
    const baseHex = normalizeHex(baseValue);
    if (!baseHex) throw new TypeError('deriveHairComponent requires a valid base color');
    const fixedEntry = Object.entries(HAIR_FIXED_PRESETS).find(([, preset]) => preset.base === baseHex);
    let generated;
    if (fixedEntry) {
      const [presetId, preset] = fixedEntry;
      generated = { recipeId: HAIR_RECIPE_ID, presetId, neutralBranch: presetId === 'SILVER_WHITE', ...preset };
    } else {
      const base = hexToHsl(baseHex);
      const neutralBranch = base.chroma < 0.055 || base.s < 0.10;
      const shadowDrop = base.l > 0.82 ? 0.10 : base.l > 0.45 ? 0.09 : 0.06;
      const lineartDrop = base.l > 0.82 ? 0.22 : base.l > 0.45 ? 0.18 : 0.11;
      const highlightLift = base.l < 0.35 ? 0.18 : base.l < 0.70 ? 0.16 : base.l < 0.88 ? 0.12 : 0.07;
      if (neutralBranch) {
        const coolHue = Number.isFinite(options.hueHint) ? wrapHue(options.hueHint) : 245;
        generated = {
          recipeId: HAIR_RECIPE_ID,
          presetId: null,
          neutralBranch: true,
          base: baseHex,
          lineart: hslToHex({ h: coolHue, s: clamp(base.chroma * 1.6 + 0.015, 0.015, 0.07), l: Math.max(0.08, base.l - lineartDrop) }),
          shadow: hslToHex({ h: coolHue, s: clamp(base.chroma * 2.2 + 0.035, 0.035, 0.14), l: Math.max(0.12, base.l - shadowDrop) }),
          highlight: hslToHex({ h: coolHue, s: clamp(base.chroma * 1.1 + 0.015, 0.015, 0.07), l: Math.min(0.99, base.l + highlightLift) })
        };
      } else {
        const shadeHue = hairShadowHue(base.h);
        generated = {
          recipeId: HAIR_RECIPE_ID,
          presetId: null,
          neutralBranch: false,
          base: baseHex,
          lineart: hslToHex({ h: shadeHue, s: clamp(base.s * 0.46 + 0.015, 0.035, 0.38), l: Math.max(0.08, base.l - lineartDrop) }),
          shadow: hslToHex({ h: shadeHue, s: clamp(base.s * 0.62 + 0.02, 0.04, 0.46), l: Math.max(0.12, base.l - shadowDrop) }),
          highlight: hslToHex({ h: base.h, s: clamp(base.s * 0.38, 0.02, 0.32), l: Math.min(0.99, base.l + highlightLift) })
        };
      }
    }
    const overrides = options.overrides || {};
    return {
      ...generated,
      base: resolveOverride(overrides.base, generated.base),
      shadow: resolveOverride(overrides.shadow, generated.shadow),
      lineart: resolveOverride(overrides.lineart, generated.lineart),
      highlight: resolveOverride(overrides.highlight, generated.highlight)
    };
  }

  function derivePhase4Eye(irisValue) {
    const irisHex = normalizeHex(irisValue);
    if (!irisHex) throw new TypeError('derivePhase4Eye requires a valid iris color');
    const iris = hexToHsl(irisHex);
    const sameHue = (saturation, lightness) => hslToHex({ h: iris.h, s: saturation, l: lightness });
    return {
      recipeId: EYE_RECIPE_ID,
      pupil: sameHue(Math.min(0.85, iris.s * 1.3), iris.l + 0.14),
      irisBase: irisHex,
      irisMid: sameHue(iris.s - 0.04, iris.l - 0.10),
      irisDark: sameHue(iris.s - 0.03, iris.l - 0.27),
      irisHighlightMid: sameHue(Math.min(0.85, iris.s * 1.5), iris.l + 0.13),
      irisHighlight: sameHue(Math.min(0.85, iris.s * 1.6), iris.l + 0.17),
      outline: sameHue(iris.s - 0.03, iris.l - 0.29),
      pupilHighlight: '#FFFFFF'
    };
  }

  return Object.freeze({
    BASIC_RECIPE_ID,
    HAIR_RECIPE_ID,
    EYE_RECIPE_ID,
    HAIR_FIXED_PRESETS,
    clamp,
    wrapHue,
    shortestHueDelta,
    lerpHueShortest,
    normalizeHex,
    hexToHsl,
    hslToHex,
    shadowHueShift,
    deriveBasicComponent,
    deriveHairComponent,
    derivePhase4Eye
  });
});
