(function attachHandbook(root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SHINE_HANDBOOK = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createHandbook() {
  'use strict';

  const SCHEMA_VERSION = 1;
  const CATEGORIES = Object.freeze(['HAIR', 'CLOTHING', 'EYE']);
  const STATUSES = Object.freeze(['EXPERIMENTAL', 'CONFIRMED', 'STABLE']);
  const FEEDBACK_REASONS = Object.freeze(['SEMANTIC', 'AESTHETIC', 'CUSTOMER_OVERRIDE', 'IP']);
  const LIMITS = Object.freeze({ bytes: 1024 * 1024, recipes: 500, categories: 40, layers: 80, aliases: 80, history: 100, depth: 12, nodes: 60000 });
  const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
  const OWN = (o, key) => Object.prototype.hasOwnProperty.call(o, key);

  function fail(message) { throw new TypeError(message); }
  function record(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label + ' must be an object');
    return value;
  }
  function checkJson(input) {
    let nodes = 0;
    let size = 0;
    const ancestors = new Set();
    function visit(value, depth) {
      if (++nodes > LIMITS.nodes || depth > LIMITS.depth) fail('Data is too large or deeply nested');
      if (value === null || typeof value === 'boolean') { size += 5; return; }
      if (typeof value === 'string') { size += value.length * 3 + 2; }
      else if (typeof value === 'number') { if (!Number.isFinite(value)) fail('Numbers must be finite'); size += 24; }
      else if (typeof value === 'object') {
        if (ancestors.has(value)) fail('Cyclic data is not supported');
        const proto = Object.getPrototypeOf(value);
        if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) fail('Only plain JSON objects are supported');
        ancestors.add(value);
        for (const key of Reflect.ownKeys(value)) {
          if (typeof key !== 'string' || FORBIDDEN_KEYS.has(key)) fail('Unsafe object key');
          const descriptor = Object.getOwnPropertyDescriptor(value, key);
          if (descriptor.get || descriptor.set) fail('Accessors are not supported');
          if (Array.isArray(value) && key === 'length') continue;
          size += key.length * 3 + 3;
          visit(descriptor.value, depth + 1);
        }
        ancestors.delete(value);
      } else fail('Only JSON data is supported');
      if (size > LIMITS.bytes) fail('Data exceeds the handbook size limit');
    }
    visit(input, 0);
  }
  function str(value, label, max, optional) {
    if ((value === undefined || value === null) && optional) return '';
    if (typeof value !== 'string') fail(label + ' must be text');
    const result = value.trim();
    if ((!optional && !result) || result.length > max || /[\u0000-\u001f\u007f]/.test(result)) fail(label + ' is invalid');
    return result;
  }
  function identifier(value, label) {
    const result = str(value, label, 160, false);
    if (FORBIDDEN_KEYS.has(result)) fail(label + ' is unsafe');
    return result;
  }
  function category(value) {
    const result = str(value, 'category', 48, false).toUpperCase();
    if (!/^[A-Z][A-Z0-9_-]*$/.test(result)) fail('Invalid category');
    return result;
  }
  function hex(value, optional) {
    if ((value === undefined || value === null || value === '') && optional) return null;
    if (typeof value !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value.trim())) fail('Invalid HEX color');
    let result = value.trim().slice(1).toUpperCase();
    if (result.length === 3) result = result.split('').map(c => c + c).join('');
    return '#' + result;
  }
  function list(value, label, max) {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > max) fail(label + ' must be a bounded array');
    return value;
  }
  function strings(value, label, max) {
    return [...new Set(list(value, label, max).map(item => str(item, label, 160, false)))];
  }
  function positiveInteger(value, label, fallback) {
    if (value === undefined) return fallback;
    if (!Number.isSafeInteger(value) || value < 1) fail(label + ' must be a positive integer');
    return value;
  }
  function colors(value, optional) {
    if (value === undefined && optional) return {};
    record(value, 'layers');
    const keys = Object.keys(value);
    if (keys.length > LIMITS.layers) fail('Too many color layers');
    const result = {};
    for (const key of keys.sort()) result[identifier(key, 'layer role')] = hex(value[key]);
    return result;
  }
  function scope(value) {
    const input = value === undefined ? {} : record(value, 'scope');
    return {
      templateSignatures: strings(input.templateSignatures, 'templateSignatures', 100),
      schemeIds: strings(input.schemeIds, 'schemeIds', 60),
      characterNames: strings(input.characterNames, 'characterNames', 60)
    };
  }
  function normalizeRecipe(input, knownCategories) {
    record(input, 'recipe');
    const output = {
      id: identifier(input.id, 'recipe id'),
      name: str(input.name, 'recipe name', 120, false),
      category: category(input.category),
      anchorHex: hex(input.anchorHex),
      aliases: list(input.aliases, 'aliases', LIMITS.aliases).map(alias => {
        record(alias, 'alias');
        const weight = alias.weight === undefined ? 50 : alias.weight;
        if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0 || weight > 100) fail('Alias weight must be between 0 and 100');
        return { text: str(alias.text, 'alias text', 80, false), weight };
      }),
      excludeAliases: strings(input.excludeAliases, 'excludeAliases', LIMITS.aliases),
      status: input.status === undefined ? 'EXPERIMENTAL' : input.status,
      scope: scope(input.scope),
      layers: colors(input.layers)
    };
    if (!knownCategories.has(output.category)) fail('Recipe refers to an unknown category');
    if (!STATUSES.includes(output.status)) fail('Invalid recipe status');
    if (input.layerSpecs !== undefined) {
      if (!Array.isArray(input.layerSpecs)) record(input.layerSpecs, 'layerSpecs');
      if (Object.keys(input.layerSpecs).length > LIMITS.layers) fail('Too many layer specifications');
      output.layerSpecs = JSON.parse(JSON.stringify(input.layerSpecs));
    }
    return output;
  }
  function normalizeHistory(input) {
    record(input, 'history entry');
    const version = positiveInteger(input.version, 'history version', 1);
    const parentVersion = positiveInteger(input.parentVersion, 'parent version', 1);
    if (parentVersion >= version) fail('History parent must precede version');
    return {
      version, parentVersion,
      at: str(input.at, 'history timestamp', 64, true),
      by: str(input.by, 'history actor', 160, true),
      reason: str(input.reason, 'history reason', 600, true),
      changedRecipeIds: strings(input.changedRecipeIds, 'changedRecipeIds', LIMITS.recipes)
    };
  }
  function normalizeHandbook(input) {
    checkJson(input);
    record(input, 'handbook');
    if (input.schemaVersion !== SCHEMA_VERSION) fail('Unsupported handbook schemaVersion');
    const normalizedCategories = list(input.categories, 'categories', LIMITS.categories).map(item => {
      if (typeof item === 'string') return { id: category(item), name: item };
      record(item, 'category');
      return { id: category(item.id), name: str(item.name, 'category name', 80, false) };
    });
    const knownCategories = new Set(normalizedCategories.map(item => item.id));
    if (knownCategories.size !== normalizedCategories.length) fail('Duplicate category id');
    const recipes = list(input.recipes, 'recipes', LIMITS.recipes).map(item => normalizeRecipe(item, knownCategories));
    if (new Set(recipes.map(item => item.id)).size !== recipes.length) fail('Duplicate recipe id');
    const output = {
      schemaVersion: SCHEMA_VERSION,
      owner: str(input.owner, 'owner', 160, false),
      version: positiveInteger(input.version, 'version', 1),
      categories: normalizedCategories,
      recipes,
      history: list(input.history, 'history', LIMITS.history).map(normalizeHistory)
    };
    let previous = 1;
    for (const item of output.history) {
      if (item.version <= previous || item.version > output.version) fail('History versions must increase and not exceed current version');
      previous = item.version;
    }
    return output;
  }
  function validation(fn, input) {
    try { return { valid: true, errors: [], value: fn(input) }; }
    catch (error) { return { valid: false, errors: [error.message] }; }
  }
  function validateHandbook(input) { return validation(normalizeHandbook, input); }
  function seedHandbook(owner) {
    const recipe = (id, name, aliases, layers) => ({
      id, name, category: 'HAIR', anchorHex: layers.base,
      aliases: aliases.map(text => ({ text, weight: 80 })), excludeAliases: [], status: 'STABLE',
      scope: { templateSignatures: [], schemeIds: [], characterNames: [] }, layers
    });
    return normalizeHandbook({
      schemaVersion: SCHEMA_VERSION, owner: owner || 'local', version: 1,
      categories: [{ id: 'HAIR', name: '头发' }, { id: 'CLOTHING', name: '衣服' }, { id: 'EYE', name: '眼睛' }],
      recipes: [
        recipe('hair-gold', '金色', ['金色', '金发', '奶金色', '浅金色'], { base: '#FAEFE7', shadow: '#E9CEC4', lineart: '#DBB8AB', highlight: '#FFFDFB' }),
        recipe('hair-silver-white', '银白', ['银白', '银色', '银发'], { base: '#FCF9FB', shadow: '#D0CDD9', lineart: '#C2C2C2', highlight: '#F6F3F7' })
      ], history: []
    });
  }

  function phrase(value) { return String(value || '').normalize('NFKC').toLowerCase().replace(/[\s，,。.;；:：、_\-]+/g, ''); }
  function positiveAlias(text, alias) {
    const needle = phrase(alias);
    if (!needle) return false;
    // Never turn a negative request into a positive substring match. Reset at a
    // clear affirmative connector, not merely punctuation ("不要金色、银色").
    const source = text.normalize('NFKC').toLowerCase();
    const clauses = source.split(/(?:但是|不过|改成|改为|换成|换为|而是|只要|想要|需要|but\s+|instead\s+)/i);
    return clauses.some(clause => {
      const compact = phrase(clause);
      let offset = compact.indexOf(needle);
      while (offset >= 0) {
        const prefix = compact.slice(0, offset);
        const suffix = compact.slice(offset + needle.length);
        const negativeBefore = /(?:不要|不能|不是|不想|不喜欢|不考虑|避免|排除|除了|非|别|无|not|without|avoid)/i.test(prefix);
        const negativeAfter = /^(?:不要|不行|不喜欢|除外|排除|不考虑)/.test(suffix);
        if (!negativeBefore && !negativeAfter) return true;
        offset = compact.indexOf(needle, offset + needle.length);
      }
      return false;
    });
  }
  function scopeMatches(values, current) { return !values.length || (typeof current === 'string' && values.includes(current)); }
  function matchRecipe(input, context) {
    const book = normalizeHandbook(input);
    checkJson(context);
    record(context, 'match context');
    const requestedCategory = category(context.category);
    const rawText = str(context.text, 'match text', 4000, true);
    const explicit = context.explicitHex !== undefined && context.explicitHex !== null && context.explicitHex !== ''
      ? hex(context.explicitHex)
      : ((rawText.match(/#(?:[\da-f]{6}|[\da-f]{3})(?![\da-f])/i) || [])[0] || null);
    if (explicit) return { status: 'none', reason: 'EXPLICIT_HEX', explicitHex: hex(explicit), candidates: [] };
    const text = phrase(rawText);
    const character = phrase(context.characterName);
    const candidates = [];
    for (const recipe of book.recipes) {
      if (recipe.category !== requestedCategory) continue;
      if (!scopeMatches(recipe.scope.templateSignatures, context.templateSignature) || !scopeMatches(recipe.scope.schemeIds, context.schemeId)) continue;
      if (recipe.excludeAliases.some(alias => text.includes(phrase(alias)))) continue;
      const names = recipe.scope.characterNames.map(phrase);
      if (names.length && (!character || !names.includes(character))) continue;
      const aliases = recipe.aliases.filter(alias => alias.weight > 0 && positiveAlias(rawText, alias.text));
      // A character default must not override a separately specified color.
      // A named color is allowed only when it also belongs to this recipe.
      const characterOnly = names.length && (!text || text === character);
      if (!aliases.length && !characterOnly) continue;
      const score = (names.length ? 1000 : 0) + (aliases.length ? Math.max(...aliases.map(alias => alias.weight)) : 0);
      candidates.push({ id: recipe.id, name: recipe.name, score, matchedAliases: aliases.map(alias => alias.text), recipe });
    }
    candidates.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (!candidates.length) return { status: 'none', reason: 'NO_MATCH', candidates: [] };
    // Two different explicit color families ("金色或银色") require a decision;
    // alias popularity is not permission to discard half of a customer's text.
    const explicitAnchors = new Set(candidates.filter(item => item.matchedAliases.length).map(item => item.recipe.anchorHex));
    if (explicitAnchors.size > 1) return { status: 'ambiguous', reason: 'MULTIPLE_COLOR_REQUESTS', candidates };
    const top = candidates.filter(item => item.score === candidates[0].score);
    if (top.length !== 1) return { status: 'ambiguous', reason: 'TIED_CANDIDATES', candidates };
    if (top[0].recipe.status !== 'STABLE') return { status: 'ambiguous', reason: 'REQUIRES_CONFIRMATION', candidates };
    return { status: 'match', recipe: top[0].recipe, candidates };
  }

  function snapshotComponents(input) {
    checkJson(input);
    let components = Array.isArray(input) ? input : record(input, 'snapshot').components;
    if (components && !Array.isArray(components)) {
      record(components, 'components');
      components = Object.keys(components).map(id => ({ ...components[id], id }));
    }
    const result = list(components, 'components', 500).map(component => {
      record(component, 'component');
      const value = {
        id: identifier(component.id, 'component id'), category: category(component.category),
        name: str(component.name, 'component name', 120, true),
        recipeId: str(component.recipeId, 'recipe id', 160, true),
        anchorHex: hex(component.anchorHex, true), layers: colors(component.layers, true),
        context: normalizeContext(component.context)
      };
      return value;
    }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    if (new Set(result.map(item => item.id)).size !== result.length) fail('Duplicate component id');
    return { components: result };
  }
  function normalizeContext(input) {
    const data = input === undefined ? {} : record(input, 'context');
    const result = {};
    for (const key of ['templateSignature', 'schemeId', 'characterName', 'orderId', 'slot', 'assetId', 'folderPath', 'assetVersion', 'source', 'inputText']) {
      if (data[key] !== undefined) result[key] = str(key === 'assetVersion' && typeof data[key] === 'number' ? String(data[key]) : data[key], key, 160, true);
    }
    return result;
  }
  function sameLearningScope(first, second) {
    const scopeKeys = ['templateSignature', 'schemeId', 'characterName', 'orderId', 'slot', 'assetId', 'folderPath', 'assetVersion'];
    return scopeKeys.every(key => (first[key] || '') === (second[key] || ''));
  }
  function diffSnapshots(initial, final) {
    const before = snapshotComponents(initial).components;
    const after = snapshotComponents(final).components;
    const oldMap = new Map(before.map(item => [item.id, item]));
    const newMap = new Map(after.map(item => [item.id, item]));
    const result = [];
    for (const id of [...new Set([...oldMap.keys(), ...newMap.keys()])].sort()) {
      const old = oldMap.get(id);
      const current = newMap.get(id);
      const source = current || old;
      const changes = [];
      const oldColors = old ? { ...old.layers, anchorHex: old.anchorHex } : {};
      const newColors = current ? { ...current.layers, anchorHex: current.anchorHex } : {};
      for (const role of [...new Set([...Object.keys(oldColors), ...Object.keys(newColors)])].sort()) {
        const from = oldColors[role] || null;
        const to = newColors[role] || null;
        if (from !== to) changes.push({ role, from, to });
      }
      if (changes.length) result.push({ componentId: id, category: source.category, name: source.name,
        recipeId: (old || source).recipeId, kind: !old ? 'added' : !current ? 'removed' : 'changed',
        changes, context: source.context, initialSnapshot: old || null, finalSnapshot: current || null });
    }
    return result;
  }
  function activeActions(actions) {
    const active = [];
    const undone = [];
    const ids = new Map();
    for (const [index, action] of list(actions, 'actions', 5000).entries()) {
      record(action, 'action');
      const type = action.type || 'manual';
      if (type === 'derived') continue;
      if (!['manual', 'undo', 'redo'].includes(type)) fail('Invalid feedback action type');
      const componentId = identifier(action.componentId, 'action component id');
      const role = action.role === undefined ? '' : identifier(action.role, 'action role');
      if (action.reason !== undefined && action.reason !== null && !FEEDBACK_REASONS.includes(action.reason)) fail('Invalid feedback reason');
      if (action.confirmed !== undefined && typeof action.confirmed !== 'boolean') fail('Action confirmed must be boolean');
      if (type === 'manual') {
        const id = action.id === undefined ? 'index-' + index : identifier(action.id, 'action id');
        const decision = JSON.stringify([componentId, role, action.reason || null, action.confirmed === true]);
        if (ids.has(id)) {
          if (ids.get(id) !== decision) fail('Conflicting duplicate action id');
          continue;
        }
        ids.set(id, decision);
        active.push({ id, componentId, role,
          reason: action.reason || null, confirmed: action.confirmed === true });
        // A fresh edit starts a new branch; old undo history is no longer redoable.
        for (let i = undone.length - 1; i >= 0; i--) if (undone[i].componentId === componentId && (!role || undone[i].role === role)) undone.splice(i, 1);
      } else {
        const source = type === 'undo' ? active : undone;
        const destination = type === 'undo' ? undone : active;
        const targetId = action.targetActionId === undefined ? null : identifier(action.targetActionId, 'target action id');
        for (let i = source.length - 1; i >= 0; i--) {
          if (source[i].componentId === componentId && (!role || source[i].role === role) && (targetId === null || source[i].id === targetId)) {
            destination.push(source.splice(i, 1)[0]); break;
          }
        }
      }
    }
    return active;
  }
  function feedbackId(diff) {
    const { source, inputText, ...learningContext } = diff.context;
    // Source is provenance, not another vote. Display-name edits also do not
    // create a second golden sample of exactly the same order and colors.
    const sample = diff.kind === 'golden' ? {
      anchorHex: diff.finalSnapshot.anchorHex, layers: diff.finalSnapshot.layers
    } : null;
    const text = JSON.stringify([diff.componentId, diff.category, learningContext, diff.recipeId || '', diff.kind, diff.changes, sample]);
    const hashes = [2166136261, 2246822519, 3266489917, 668265263];
    for (let i = 0; i < text.length; i++) {
      for (let part = 0; part < hashes.length; part++) hashes[part] = Math.imul(hashes[part] ^ (text.charCodeAt(i) + part), 16777619);
    }
    return 'feedback-' + hashes.map(hash => (hash >>> 0).toString(16).padStart(8, '0')).join('');
  }
  function normalizeFeedback(input) {
    checkJson(input);
    record(input, 'feedback');
    if (input.schemaVersion !== SCHEMA_VERSION) fail('Unsupported feedback schemaVersion');
    if (!['changed', 'added', 'removed', 'golden'].includes(input.kind)) fail('Invalid feedback kind');
    const reason = input.reason === undefined ? null : input.reason;
    if (reason !== null && !FEEDBACK_REASONS.includes(reason)) fail('Invalid feedback reason');
    if (typeof input.confirmed !== 'boolean') fail('Feedback confirmed must be boolean');
    const output = {
      schemaVersion: SCHEMA_VERSION, id: identifier(input.id, 'feedback id'),
      componentId: identifier(input.componentId, 'feedback component id'),
      category: category(input.category), name: str(input.name, 'component name', 120, true), kind: input.kind,
      recipeId: str(input.recipeId, 'recipe id', 160, true),
      changes: list(input.changes, 'changes', LIMITS.layers + 1).map(change => {
        record(change, 'change');
        return { role: identifier(change.role, 'change role'), from: hex(change.from, true), to: hex(change.to, true) };
      }).filter(change => change.from !== change.to),
      reason, confirmed: input.confirmed, learningEligible: false, context: normalizeContext(input.context)
    };
    for (const key of ['initialSnapshot', 'finalSnapshot']) {
      if (input[key] !== undefined && input[key] !== null) {
        const component = snapshotComponents([input[key]]).components[0];
        if (component.id !== output.componentId || component.category !== output.category) fail('Feedback snapshot identity mismatch');
        if (key === 'finalSnapshot' && !sameLearningScope(component.context, output.context)) fail('Feedback snapshot scope mismatch');
        output[key] = component;
      }
    }
    if (new Set(output.changes.map(change => change.role)).size !== output.changes.length) fail('Duplicate changed role');
    const golden = output.kind === 'golden';
    if (golden && (output.changes.length || !output.finalSnapshot || (!output.finalSnapshot.anchorHex && !Object.keys(output.finalSnapshot.layers).length))) fail('Golden samples require an unchanged valid color snapshot');
    // Imported feedback may contain only the directly edited roles, but every
    // claimed color must still agree with the actual saved snapshots. Never
    // turn a hand-edited or stale export into apparently verified evidence.
    for (const change of output.changes) {
      for (const [snapshotKey, colorKey] of [['initialSnapshot', 'from'], ['finalSnapshot', 'to']]) {
        const snapshot = output[snapshotKey];
        if (!snapshot) continue;
        const observed = change.role === 'anchorHex' ? snapshot.anchorHex : snapshot.layers[change.role] || null;
        if (observed !== change[colorKey]) fail('Feedback change does not match its saved snapshot');
      }
    }
    const scopedIP = reason !== 'IP' || (output.context.characterName && (output.context.templateSignature || output.context.schemeId));
    output.scopeChanged = Boolean(output.initialSnapshot && !sameLearningScope(output.initialSnapshot.context, output.context));
    // An orderless legacy record may be displayed, but cannot be deduplicated
    // safely across commissions and must not enter the learning queue.
    output.learningEligible = Boolean(output.context.orderId && output.confirmed && reason !== null && reason !== 'CUSTOMER_OVERRIDE' && scopedIP && !output.scopeChanged
      && (golden ? ['AESTHETIC', 'IP'].includes(reason) : output.kind === 'changed' && output.changes.length > 0));
    // This is one reviewed decision, not one vote per derived layer or export.
    output.learningWeight = output.learningEligible ? 1 : 0;
    return output;
  }
  function validateFeedback(input) { return validation(normalizeFeedback, input); }
  function createFeedbackProposal(initial, final, actions) {
    const providedActions = actions === undefined ? [] : actions;
    checkJson(providedActions);
    const active = activeActions(providedActions);
    const proposals = [];
    for (const diff of diffSnapshots(initial, final)) {
      const relevant = active.filter(action => action.componentId === diff.componentId);
      const allForComponent = providedActions.filter(action => action.componentId === diff.componentId);
      // A manual base edit produces several derived colors; those are one decision, not several votes.
      const changes = allForComponent.length
        ? diff.changes.filter(change => relevant.some(action => !action.role || action.role === change.role))
        : diff.changes;
      if (!changes.length) continue;
      const changedActions = [...new Set(changes.map(change => relevant.filter(action => !action.role || action.role === change.role).at(-1)).filter(Boolean))];
      const reasons = [...new Set(changedActions.map(action => action.reason).filter(Boolean))];
      const reason = reasons.includes('CUSTOMER_OVERRIDE') ? 'CUSTOMER_OVERRIDE' : reasons.length === 1 ? reasons[0] : null;
      const proposal = { ...diff, schemaVersion: SCHEMA_VERSION, changes, reason,
        confirmed: changedActions.length > 0 && changedActions.every(action => action.confirmed), id: feedbackId({ ...diff, changes }) };
      proposals.push(normalizeFeedback(proposal));
    }
    return proposals;
  }
  function createGoldenSample(input, metadata) {
    const snapshots = snapshotComponents(input).components;
    const meta = metadata === undefined ? {} : metadata;
    checkJson(meta);
    record(meta, 'golden metadata');
    const id = meta.componentId === undefined && snapshots.length === 1 ? snapshots[0].id : identifier(meta.componentId, 'golden component id');
    const component = snapshots.find(item => item.id === id);
    if (!component) fail('Golden sample component not found');
    const context = meta.context === undefined ? component.context : normalizeContext(meta.context);
    if (!sameLearningScope(context, component.context)) fail('Golden sample scope must match the snapshot');
    const proposal = { schemaVersion: SCHEMA_VERSION, componentId: component.id, category: component.category,
      name: component.name, recipeId: component.recipeId, kind: 'golden', changes: [], context,
      reason: meta.reason === undefined ? 'AESTHETIC' : meta.reason, confirmed: meta.confirmed === true, finalSnapshot: component };
    return normalizeFeedback({ ...proposal, id: feedbackId(proposal) });
  }

  function commit(input, edited, metadata) {
    const previous = normalizeHandbook(input);
    checkJson(edited);
    record(edited, 'edited handbook');
    const meta = metadata === undefined ? {} : metadata;
    checkJson(meta);
    record(meta, 'commit metadata');
    if (OWN(edited, 'owner') && edited.owner !== previous.owner) fail('A commit cannot change handbook owner');
    const next = normalizeHandbook({ ...previous, ...edited, owner: previous.owner, version: previous.version, history: previous.history });
    if (previous.version === Number.MAX_SAFE_INTEGER) fail('Handbook version limit reached');
    const oldRecipes = new Map(previous.recipes.map(recipe => [recipe.id, JSON.stringify(recipe)]));
    const newRecipes = new Map(next.recipes.map(recipe => [recipe.id, JSON.stringify(recipe)]));
    const changedRecipeIds = [...new Set([...oldRecipes.keys(), ...newRecipes.keys()])]
      .filter(id => oldRecipes.get(id) !== newRecipes.get(id)).sort();
    next.version = previous.version + 1;
    next.history = previous.history.concat({
      version: next.version, parentVersion: previous.version,
      at: str(meta.at, 'commit timestamp', 64, true), by: str(meta.by, 'commit actor', 160, true),
      reason: str(meta.reason, 'commit reason', 600, true), changedRecipeIds
    }).slice(-LIMITS.history);
    return normalizeHandbook(next);
  }
  function markdown(value) { return String(value).replace(/([\\`*_{}\[\]<>()!|])/g, '\\$1').replace(/\r?\n/g, ' '); }
  function serializeMarkdown(input) {
    const book = normalizeHandbook(input);
    const output = ['# SHINE 配色手册', '', '账户：' + markdown(book.owner), '版本：' + book.version + ' · Schema ' + SCHEMA_VERSION, ''];
    for (const group of book.categories) {
      output.push('## ' + markdown(group.name), '');
      for (const recipe of book.recipes.filter(item => item.category === group.id)) {
        output.push('### ' + markdown(recipe.name), '', '- ID：' + markdown(recipe.id), '- 状态：' + recipe.status,
          '- 主色：`' + recipe.anchorHex + '`', '- 读取别名：' + recipe.aliases.map(alias => markdown(alias.text) + '（' + alias.weight + '）').join('、'),
          '- 排除词：' + recipe.excludeAliases.map(markdown).join('、'),
          '- 模板范围：' + (recipe.scope.templateSignatures.map(markdown).join('、') || '不限'),
          '- 眼睛方案：' + (recipe.scope.schemeIds.map(markdown).join('、') || '不限'),
          '- 角色名字：' + (recipe.scope.characterNames.map(markdown).join('、') || '无'), '', '| 图层角色 | HEX |', '| --- | --- |');
        for (const [role, color] of Object.entries(recipe.layers)) output.push('| ' + markdown(role) + ' | `' + color + '` |');
        output.push('');
      }
    }
    // Include machine-readable data so this human-readable backup is also lossless.
    output.push('## 完整数据备份', '', '```json', JSON.stringify(book, null, 2).replace(/`/g, '\\u0060'), '```', '');
    return output.join('\n');
  }

  return Object.freeze({ SCHEMA_VERSION, CATEGORIES, STATUSES, FEEDBACK_REASONS, LIMITS,
    seedHandbook, normalizeHandbook, validateHandbook, matchRecipe, snapshotComponents, diffSnapshots,
    createFeedbackProposal, createGoldenSample, normalizeFeedback, validateFeedback, commit, serializeMarkdown });
});
