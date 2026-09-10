const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const childProcess = require('node:child_process');
const H = require('../../color-handbook');
const Review = require('../../scripts/review-handbook');

function book() { return H.seedHandbook('artist-one'); }
function recipe(id, overrides = {}) {
  return { id, name: id, category: 'EYE', anchorHex: '#AACCEE', aliases: [{ text: '蓝色', weight: 60 }],
    excludeAliases: [], status: 'STABLE', scope: {}, layers: { irisBase: '#AACCEE', pupil: '#DDEEFF' }, ...overrides };
}
function snapshot(base, shadow = '#777777') {
  return { components: [{ id: 'hair-a', category: 'HAIR', name: 'A 头发', anchorHex: base, layers: { base, shadow }, context: { templateSignature: 'template-one', orderId: 'order-one' } }] };
}

test('CommonJS and browser global expose the same pure API', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../color-handbook.js'), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(source, context);
  assert.equal(typeof context.SHINE_HANDBOOK.seedHandbook, 'function');
  assert.equal(context.SHINE_HANDBOOK.SCHEMA_VERSION, 1);
  assert.equal(H.SCHEMA_VERSION, 1);
});

test('seed contains only the two artist-confirmed hair palettes and independent data', () => {
  const first = book();
  assert.deepEqual(first.recipes[0].layers, { base: '#FAEFE7', highlight: '#FFFDFB', lineart: '#DBB8AB', shadow: '#E9CEC4' });
  assert.deepEqual(first.recipes[1].layers, { base: '#FCF9FB', highlight: '#F6F3F7', lineart: '#C2C2C2', shadow: '#D0CDD9' });
  assert(first.recipes.every(r => r.status === 'STABLE'));
  first.recipes[0].layers.base = '#000000';
  assert.equal(book().recipes[0].layers.base, '#FAEFE7');
});

test('normalize validates HEX, schema, categories and unique ids without mutating input', () => {
  const input = book();
  input.recipes[0].layers.base = '#abc';
  const normalized = H.normalizeHandbook(input);
  assert.equal(normalized.recipes[0].layers.base, '#AABBCC');
  assert.equal(input.recipes[0].layers.base, '#abc');
  input.recipes[0].layers.base = 'red';
  assert.equal(H.validateHandbook(input).valid, false);
  assert.equal(H.validateHandbook({ ...book(), schemaVersion: 2 }).valid, false);
  const duplicate = book();
  duplicate.recipes.push(duplicate.recipes[0]);
  assert.equal(H.validateHandbook(duplicate).valid, false);
  const unknown = book();
  unknown.recipes[0].category = 'UNKNOWN';
  assert.equal(H.validateHandbook(unknown).valid, false);
});

test('extensible categories and layer specifications round-trip', () => {
  const input = book();
  input.categories.push({ id: 'BACKDROP', name: '衬底' });
  input.recipes.push(recipe('lace', { category: 'BACKDROP', layerSpecs: { base: { sourceLayerNames: ['蕾丝底色'], locked: false } } }));
  assert.deepEqual(H.normalizeHandbook(input).recipes[2].layerSpecs, input.recipes[2].layerSpecs);
});

test('rejects prototype pollution, accessor execution, cycles, excessive arrays and oversized data', () => {
  const unsafe = JSON.parse(JSON.stringify(book()));
  unsafe.recipes[0].layerSpecs = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.equal(H.validateHandbook(unsafe).valid, false);
  assert.equal({}.polluted, undefined);
  const inherited = Object.create({ recipes: [] });
  assert.equal(H.validateHandbook(inherited).valid, false);
  let invoked = false;
  const accessor = book();
  Object.defineProperty(accessor, 'evil', { get() { invoked = true; return ''; } });
  assert.equal(H.validateHandbook(accessor).valid, false);
  assert.equal(invoked, false);
  const cyclic = book(); cyclic.loop = cyclic;
  assert.equal(H.validateHandbook(cyclic).valid, false);
  assert.equal(H.validateHandbook({ ...book(), recipes: Array(501).fill(book().recipes[0]) }).valid, false);
  assert.equal(H.validateHandbook({ ...book(), extra: '大'.repeat(400000) }).valid, false);
});

test('gold and silver aliases match deterministically, never nearest-color snap explicit HEX', () => {
  for (const text of ['银色', '银白']) assert.equal(H.matchRecipe(book(), { category: 'HAIR', text }).recipe.id, 'hair-silver-white');
  const result = H.matchRecipe(book(), { category: 'HAIR', text: '金色 #fbeee6' });
  assert.deepEqual(result, { status: 'none', reason: 'EXPLICIT_HEX', explicitHex: '#FBEEE6', candidates: [] });
  assert.equal(H.matchRecipe(book(), { category: 'HAIR', text: '金色', explicitHex: '#123' }).explicitHex, '#112233');
  assert.equal(H.matchRecipe(book(), { category: 'HAIR', text: '紫色' }).status, 'none');
});

test('tied matches require a user choice; only STABLE may auto-apply', () => {
  const input = book();
  input.recipes.push({ ...input.recipes[0], id: 'another-gold' });
  const a = H.matchRecipe(input, { category: 'HAIR', text: '金色' });
  assert.equal(a.status, 'ambiguous');
  assert.equal(a.reason, 'TIED_CANDIDATES');
  assert.deepEqual(a, H.matchRecipe(input, { category: 'HAIR', text: '金色' }));
  input.recipes.pop();
  for (const status of ['EXPERIMENTAL', 'CONFIRMED']) {
    input.recipes[0].status = status;
    assert.equal(H.matchRecipe(input, { category: 'HAIR', text: '金色' }).reason, 'REQUIRES_CONFIRMATION');
  }
});

test('exclusions and template/scheme scopes filter before matching', () => {
  const input = book();
  input.recipes.push(recipe('blue-eye', { excludeAliases: ['不要蓝色'], scope: { templateSignatures: ['t1'], schemeIds: ['AUTO_V3'] } }));
  assert.equal(H.matchRecipe(input, { category: 'EYE', text: '蓝色' }).status, 'none');
  assert.equal(H.matchRecipe(input, { category: 'EYE', text: '蓝色', templateSignature: 't2', schemeId: 'AUTO_V3' }).status, 'none');
  assert.equal(H.matchRecipe(input, { category: 'EYE', text: '不要蓝色', templateSignature: 't1', schemeId: 'AUTO_V3' }).status, 'none');
  assert.equal(H.matchRecipe(input, { category: 'EYE', text: '蓝色', templateSignature: 't1', schemeId: 'AUTO_V3' }).status, 'match');
});

test('character presets never select assets or override a separately specified color', () => {
  const input = book();
  input.recipes.push(recipe('generic-blue'), recipe('character-eye', { aliases: [], scope: { characterNames: ['祁煜'] } }));
  const result = H.matchRecipe(input, { category: 'EYE', text: '', characterName: '祁煜' });
  assert.equal(result.recipe.id, 'character-eye');
  assert.equal(Object.hasOwn(result.recipe, 'assetId'), false);
  assert.equal(H.matchRecipe(input, { category: 'EYE', text: '蓝色', characterName: '祁煜' }).recipe.id, 'generic-blue');
  assert.equal(H.matchRecipe(input, { category: 'EYE', text: '黑色', characterName: '祁煜' }).status, 'none');
  assert.equal(H.matchRecipe(input, { category: 'EYE', text: '蓝色', characterName: '其他' }).recipe.id, 'generic-blue');
  input.recipes[3].category = 'HAIR';
  assert.equal(H.validateHandbook(input).valid, true);
  assert.equal(H.matchRecipe(input, { category: 'HAIR', text: '祁煜', characterName: '祁煜' }).recipe.id, 'character-eye');
});

test('negations, zero weights and multiple positive color families never misapply a recipe', () => {
  for (const text of ['不要金色', '金色不要', '不是银白', '避免银色', '不要金色、银色', '不是金发']) {
    assert.notEqual(H.matchRecipe(book(), { category: 'HAIR', text }).status, 'match', text);
  }
  assert.equal(H.matchRecipe(book(), { category: 'HAIR', text: '不要金色，改成银白' }).recipe.id, 'hair-silver-white');
  assert.equal(H.matchRecipe(book(), { category: 'HAIR', text: '金色或者银色' }).reason, 'MULTIPLE_COLOR_REQUESTS');
  const input = book(); input.recipes[0].aliases.forEach(a => { a.weight = 0; });
  assert.equal(H.matchRecipe(input, { category: 'HAIR', text: '金色' }).status, 'none');
});

test('snapshots clone values, track net changes, and do not learn derived duplicates', () => {
  const initial = snapshot('#AAAAAA');
  const final = snapshot('#BBBBBB', '#888888');
  const copy = H.snapshotComponents(initial);
  initial.components[0].layers.base = '#000000';
  assert.equal(copy.components[0].layers.base, '#AAAAAA');
  const feedback = H.createFeedbackProposal(copy, final, [
    { componentId: 'hair-a', role: 'base', type: 'manual', reason: 'AESTHETIC', confirmed: true },
    { componentId: 'hair-a', role: 'shadow', type: 'derived' }
  ]);
  assert.equal(feedback.length, 1);
  assert.deepEqual(feedback[0].changes, [{ role: 'base', from: '#AAAAAA', to: '#BBBBBB' }]);
  assert.equal(feedback[0].learningEligible, true);
});

test('undo and fully reverted colors do not create learning; redo restores explicit decision', () => {
  const initial = snapshot('#AAAAAA');
  const final = snapshot('#BBBBBB');
  const manual = { id: 'm1', componentId: 'hair-a', role: 'base', type: 'manual', reason: 'AESTHETIC', confirmed: true };
  const undo = { componentId: 'hair-a', type: 'undo', targetActionId: 'm1' };
  assert.deepEqual(H.createFeedbackProposal(initial, initial, [manual]), []);
  assert.deepEqual(H.createFeedbackProposal(initial, final, [manual, undo]), []);
  const redo = { componentId: 'hair-a', type: 'redo', targetActionId: 'm1' };
  assert.equal(H.createFeedbackProposal(initial, final, [manual, undo, redo])[0].learningEligible, true);
});

test('unconfirmed changes never learn and CUSTOMER_OVERRIDE is permanently excluded', () => {
  const initial = snapshot('#AAAAAA');
  const final = snapshot('#BBBBBB');
  const unreviewed = H.createFeedbackProposal(initial, final)[0];
  assert.equal(unreviewed.confirmed, false);
  assert.equal(unreviewed.learningEligible, false);
  for (const reason of H.FEEDBACK_REASONS) {
    const item = H.createFeedbackProposal(initial, final, [{ componentId: 'hair-a', role: 'base', reason, confirmed: false }])[0];
    assert.equal(item.learningEligible, false);
  }
  const override = H.createFeedbackProposal(initial, final, [{ componentId: 'hair-a', role: 'base', reason: 'CUSTOMER_OVERRIDE', confirmed: true }])[0];
  assert.equal(override.learningEligible, false);
  const forged = H.validateFeedback({ ...override, learningEligible: true });
  assert.equal(forged.valid, true);
  assert.equal(forged.value.learningEligible, false);
  const hairIP = H.createFeedbackProposal(initial, final, [{ componentId: 'hair-a', role: 'base', reason: 'IP', confirmed: true }])[0];
  assert.equal(hairIP.learningEligible, false);
});

test('added assets and derived-only changes never count as learned colors', () => {
  const added = H.createFeedbackProposal({ components: [] }, snapshot('#BBBBBB'), [{ componentId: 'hair-a', role: 'base', reason: 'AESTHETIC', confirmed: true }])[0];
  assert.equal(added.kind, 'added');
  assert.equal(added.learningEligible, false);
  const derived = H.createFeedbackProposal(snapshot('#AAAAAA'), snapshot('#BBBBBB'), [{ componentId: 'hair-a', role: 'base', type: 'derived' }]);
  assert.deepEqual(derived, []);
});

test('last reviewed action wins, repeated action ids are deduplicated and redo cannot revive a discarded branch', () => {
  const manual = { id: 'm1', componentId: 'hair-a', role: 'base', reason: 'CUSTOMER_OVERRIDE', confirmed: true };
  const corrected = { ...manual, id: 'm2', reason: 'AESTHETIC' };
  const initial = snapshot('#AAAAAA'); const final = snapshot('#BBBBBB');
  const feedback = H.createFeedbackProposal(initial, final, [manual, manual, corrected]);
  assert.equal(feedback.length, 1);
  assert.equal(feedback[0].reason, 'AESTHETIC');
  assert.equal(feedback[0].learningWeight, 1);
  assert.throws(() => H.createFeedbackProposal(initial, final, [manual, { ...corrected, id: 'm1' }]), /Conflicting/);
  const branched = [manual, { componentId: 'hair-a', type: 'undo', targetActionId: 'm1' }, corrected,
    { componentId: 'hair-a', type: 'redo', targetActionId: 'm1' }];
  assert.equal(H.createFeedbackProposal(initial, final, branched)[0].reason, 'AESTHETIC');
});

test('golden sample explicitly confirms a valid unchanged snapshot without faking a color correction', () => {
  const initial = snapshot('#AAAAAA');
  const sample = H.createGoldenSample(initial, { componentId: 'hair-a', confirmed: true });
  assert.equal(sample.kind, 'golden');
  assert.deepEqual(sample.changes, []);
  assert.equal(sample.learningEligible, true);
  assert.equal(sample.learningWeight, 1);
  assert.equal(sample.finalSnapshot.layers.base, '#AAAAAA');
  assert.deepEqual(H.createFeedbackProposal(initial, initial), []);
  assert.equal(H.createGoldenSample(initial).learningEligible, false);
  assert.equal(H.createGoldenSample(initial, { confirmed: true, reason: 'CUSTOMER_OVERRIDE' }).learningWeight, 0);
  assert.equal(H.createGoldenSample(initial, { confirmed: true, reason: 'SEMANTIC' }).learningEligible, false);
  assert.throws(() => H.createGoldenSample({ components: [{ id: 'empty', category: 'HAIR', layers: {} }] }, { confirmed: true }), /valid color snapshot/);
  assert.throws(() => H.createGoldenSample(initial, { confirmed: true, context: { templateSignature: 'other' } }), /scope/);
  assert.throws(() => H.normalizeFeedback({ ...sample, changes: [{ role: 'base', from: '#AAAAAA', to: '#BBBBBB' }] }), /unchanged/);
});

test('feedback is order scoped and all IP color categories require explicit character/template or scheme scope', () => {
  const source = snapshot('#AAAAAA');
  source.components[0].context = { templateSignature: 'template-one', orderId: 'one', characterName: '自设角色' };
  const final = structuredClone(source); final.components[0].layers.base = '#BBBBBB';
  const actions = [{ componentId: 'hair-a', role: 'base', reason: 'IP', confirmed: true }];
  const first = H.createFeedbackProposal(source, final, actions)[0];
  assert.equal(first.learningEligible, true);
  source.components[0].context.orderId = 'two'; final.components[0].context.orderId = 'two';
  const second = H.createFeedbackProposal(source, final, actions)[0];
  assert.notEqual(first.id, second.id);
  assert.equal(second.id.length, 'feedback-'.length + 32);
  assert.deepEqual(second, H.createFeedbackProposal(source, final, actions)[0]);
  delete source.components[0].context.templateSignature; delete final.components[0].context.templateSignature;
  assert.equal(H.createFeedbackProposal(source, final, actions)[0].learningEligible, false);
});

test('orderless legacy feedback and golden samples remain readable but cannot enter learning', () => {
  const initial = snapshot('#AAAAAA');
  const final = snapshot('#BBBBBB');
  delete initial.components[0].context.orderId; delete final.components[0].context.orderId;
  const feedback = H.createFeedbackProposal(initial, final, [{ componentId: 'hair-a', role: 'base', reason: 'AESTHETIC', confirmed: true }])[0];
  assert.equal(feedback.learningEligible, false);
  assert.equal(feedback.learningWeight, 0);
  assert.equal(H.validateFeedback(feedback).valid, true);
  assert.equal(H.createGoldenSample(final, { confirmed: true }).learningEligible, false);
  const review = Review.createReview({ handbook: book(), feedback: [feedback] });
  assert.equal(review.skipped.ineligible, 1);
  assert.equal(review.updateSuggested, false);
});

test('feedback may include a direct-edit subset but cannot contradict either saved snapshot', () => {
  const initial = snapshot('#AAAAAA'); const final = snapshot('#BBBBBB', '#888888');
  const item = H.createFeedbackProposal(initial, final, [{ componentId: 'hair-a', role: 'base', reason: 'AESTHETIC', confirmed: true }])[0];
  assert.equal(item.learningEligible, true);
  assert.equal(item.changes.length, 1);
  const forgedFrom = structuredClone(item); forgedFrom.changes[0].from = '#000000';
  const forgedTo = structuredClone(item); forgedTo.changes[0].to = '#FFFFFF';
  const unknownRole = structuredClone(item); unknownRole.changes[0].role = 'nonexistent';
  for (const invalid of [forgedFrom, forgedTo, unknownRole]) {
    const result = H.validateFeedback(invalid);
    assert.equal(result.valid, false);
    assert.match(result.errors[0], /saved snapshot/);
    assert.equal(Review.createReview({ handbook: book(), feedback: [invalid] }).skipped.invalid, 1);
  }
});

test('commit creates immutable versions/history, deterministic given metadata, owner fixed', () => {
  const input = book();
  const original = JSON.stringify(input);
  const edited = { recipes: input.recipes.map(r => ({ ...r, name: r.name + '新版' })) };
  const meta = { at: '2026-09-07T00:00:00Z', by: 'artist-one', reason: '确认新配色' };
  const next = H.commit(input, edited, meta);
  assert.equal(JSON.stringify(input), original);
  assert.equal(next.version, 2);
  assert.deepEqual(next.history[0].changedRecipeIds, ['hair-gold', 'hair-silver-white']);
  assert.equal(next.history[0].parentVersion, 1);
  assert.deepEqual(next, H.commit(input, edited, meta));
  next.recipes[0].layers.base = '#000000';
  assert.equal(input.recipes[0].layers.base, '#FAEFE7');
  assert.throws(() => H.commit(input, { owner: 'someone-else' }), /owner/);
});

test('Markdown backup has readable palettes and lossless JSON import payload', () => {
  const input = book();
  input.recipes[0].name = '金色 ``` 自定义';
  const markdown = H.serializeMarkdown(input);
  assert.match(markdown, /# SHINE 配色手册/);
  assert.match(markdown, /#FAEFE7/);
  const payload = markdown.split('```json\n')[1].split('\n```')[0];
  assert.deepEqual(H.normalizeHandbook(JSON.parse(payload)), H.normalizeHandbook(input));
});

function linkedSnapshots() {
  const b = book(); const palette = b.recipes[0];
  const initial = { components: [{ id: 'hair-a', category: 'HAIR', name: 'A 金发', recipeId: palette.id,
    anchorHex: palette.anchorHex, layers: palette.layers,
    context: { templateSignature: 'template-one', orderId: 'order-one', slot: 'A', assetId: 'hair-one', assetVersion: 2 } }] };
  const final = structuredClone(initial); final.components[0].layers.lineart = '#C0AABB';
  return { b, initial, final };
}

test('scope changes are retained for review but cannot become learning evidence; source changes are only provenance', () => {
  const { initial, final } = linkedSnapshots();
  const actions = [{ componentId: 'hair-a', role: 'lineart', reason: 'AESTHETIC', confirmed: true }];
  initial.components[0].context.source = 'local'; final.components[0].context.source = 'manual';
  const same = H.createFeedbackProposal(initial, final, actions)[0];
  assert.equal(same.learningEligible, true);
  assert.equal(same.context.assetVersion, '2');
  final.components[0].context.schemeId = 'different';
  const different = H.createFeedbackProposal(initial, final, actions)[0];
  assert.equal(different.scopeChanged, true);
  assert.equal(different.learningEligible, false);
});

test('source labels and display names do not create extra feedback or golden-sample votes', () => {
  const { b, initial, final } = linkedSnapshots();
  initial.components[0].context.source = 'local'; final.components[0].context.source = 'manual';
  const actions = [{ componentId: 'hair-a', role: 'lineart', reason: 'AESTHETIC', confirmed: true }];
  const first = H.createFeedbackProposal(initial, final, actions)[0];
  const golden = H.createGoldenSample(final, { confirmed: true });
  initial.components[0].context.source = 'api'; final.components[0].context.source = 'api';
  final.components[0].name = '改了个显示名字';
  const repeated = H.createFeedbackProposal(initial, final, actions)[0];
  const repeatedGolden = H.createGoldenSample(final, { confirmed: true });
  assert.equal(first.id, repeated.id);
  assert.equal(golden.id, repeatedGolden.id);
  const review = Review.createReview({ handbook: b, feedback: [first, repeated, golden, repeatedGolden] });
  assert.equal(review.candidates.length, 2);
  assert.equal(review.skipped.duplicate, 2);
});

test('review proposes only scoped confirmed aesthetics, deduplicates exports, and never changes the input book', () => {
  const { b, initial, final } = linkedSnapshots();
  const before = JSON.stringify(b);
  const actions = [{ componentId: 'hair-a', role: 'lineart', reason: 'AESTHETIC', confirmed: true }];
  const item = H.createFeedbackProposal(initial, final, actions)[0];
  const review = Review.createReview({ handbook: b, feedback: [item, { ...item, id: 'exported-again' }] });
  assert.equal(review.publishes, false);
  assert.equal(review.candidates.length, 1);
  assert.equal(review.skipped.duplicate, 1);
  assert.deepEqual(review.candidates[0].proposedColorChanges, [{ role: 'lineart', before: '#DBB8AB', after: '#C0AABB' }]);
  assert.equal(JSON.stringify(b), before);
  const drift = structuredClone(b); drift.recipes[0].layers.lineart = '#AAAAAA';
  const drifted = Review.createReview({ handbook: drift, feedback: [item] }).candidates[0];
  assert.deepEqual(drifted.proposedColorChanges, []);
  assert(drifted.warnings.some(message => message.includes('当前配方已不同')));
});

test('semantic review cannot change HEX and explicitly confirmed unchanged golden snapshots remain useful', () => {
  const { b, initial, final } = linkedSnapshots();
  const semantic = H.createFeedbackProposal(initial, final, [{ componentId: 'hair-a', role: 'lineart', reason: 'SEMANTIC', confirmed: true }])[0];
  const golden = H.createGoldenSample(initial, { confirmed: true });
  const review = Review.createReview({ handbook: b, feedback: [semantic, golden] });
  assert.equal(review.candidates.length, 2);
  assert.equal(review.candidates[0].type, 'SEMANTIC_REVIEW_ONLY');
  assert.deepEqual(review.candidates[0].proposedColorChanges, []);
  assert.equal(review.candidates[1].type, 'GOLDEN_SAMPLE_REVIEW');
  assert.deepEqual(review.candidates[1].observedChanges, []);
  assert.equal(review.candidates[1].sample.layers.base, '#FAEFE7');
});

test('customer overrides and invalid, unconfirmed or unscoped IP records yield no update or leaked customer colors', () => {
  const { b, initial, final } = linkedSnapshots();
  final.components[0].layers.lineart = '#123456';
  const action = { componentId: 'hair-a', role: 'lineart', reason: 'CUSTOMER_OVERRIDE', confirmed: true };
  const customer = H.createFeedbackProposal(initial, final, [action])[0];
  const unconfirmed = H.createFeedbackProposal(initial, final, [{ ...action, reason: 'AESTHETIC', confirmed: false }])[0];
  const ip = H.createFeedbackProposal(initial, final, [{ ...action, reason: 'IP' }])[0];
  const review = Review.createReview({ handbook: b, feedback: [customer, unconfirmed, ip, { invalid: true }] });
  assert.equal(review.updateSuggested, false);
  assert.deepEqual(review.candidates, []);
  assert.deepEqual(review.skipped, { unconfirmed: 1, customerOverride: 1, ineligible: 1, duplicate: 0, invalid: 1 });
  assert.match(Review.renderReport(review), /没有有效样本/);
  assert(!JSON.stringify(review).includes('#123456'));
});

test('review CLI writes only a new dedicated output directory, preserves export, and rejects overwrite', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'shine-review-test-'));
  const inputPath = path.join(temporary, 'export.json'); const outputPath = path.join(temporary, 'report');
  const input = JSON.stringify({ handbook: book(), feedback: [] });
  const script = path.resolve(__dirname, '../../scripts/review-handbook.js');
  try {
    fs.writeFileSync(inputPath, input);
    const result = childProcess.spawnSync(process.execPath, [script, '--input', inputPath, '--output', outputPath], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).publishes, false);
    assert.deepEqual(fs.readdirSync(outputPath).sort(), ['review-candidates.json', 'review-report.md']);
    assert.equal(fs.readFileSync(inputPath, 'utf8'), input);
    const retry = childProcess.spawnSync(process.execPath, [script, '--input', inputPath, '--output', outputPath], { encoding: 'utf8' });
    assert.notEqual(retry.status, 0);
    assert.match(retry.stderr, /new or empty/);
    const unsafe = childProcess.spawnSync(process.execPath, [script, '--input', inputPath, '--output', temporary], { encoding: 'utf8' });
    assert.notEqual(unsafe.status, 0);
    assert.match(unsafe.stderr, /dedicated/);
  } finally {
    const allowedParent = fs.realpathSync(os.tmpdir());
    const resolved = fs.realpathSync(temporary);
    assert.equal(path.dirname(resolved), allowedParent);
    assert(path.basename(resolved).startsWith('shine-review-test-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
