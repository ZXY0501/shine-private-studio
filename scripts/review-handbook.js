#!/usr/bin/env node
'use strict';

// Offline review only. This tool deliberately has no network, publishing,
// Obsidian discovery, scheduler, or source-handbook write capability.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const H = require('../color-handbook');

const MAX_EXPORT_BYTES = 8 * 1024 * 1024;
const MAX_FEEDBACK = 5000;
const markdown = value => String(value).replace(/[\\`*_{}\[\]<>()!|]/g, '\\$&').replace(/[\r\n]/g, ' ');
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function applies(recipe, context) {
  return (!recipe.scope.templateSignatures.length || recipe.scope.templateSignatures.includes(context.templateSignature))
    && (!recipe.scope.schemeIds.length || recipe.scope.schemeIds.includes(context.schemeId))
    && (!recipe.scope.characterNames.length || recipe.scope.characterNames.includes(context.characterName));
}
function evidenceKey(item) {
  const { source, inputText, ...learningContext } = item.context;
  const sample = item.kind === 'golden' ? {
    anchorHex: item.finalSnapshot.anchorHex, layers: item.finalSnapshot.layers
  } : null;
  return digest([item.componentId, item.category, learningContext, item.kind, item.reason, item.recipeId,
    [...item.changes].sort((a, b) => a.role.localeCompare(b.role)), sample]);
}

function createReview(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Review export must be an object');
  const handbook = H.normalizeHandbook(input.handbook);
  if (!Array.isArray(input.feedback) || input.feedback.length > MAX_FEEDBACK) throw new TypeError('feedback must be a bounded array');
  const categories = new Set(handbook.categories.map(item => item.id));
  const recipes = new Map(handbook.recipes.map(recipe => [recipe.id, recipe]));
  const seen = new Set();
  const skipped = { unconfirmed: 0, customerOverride: 0, ineligible: 0, duplicate: 0, invalid: 0 };
  const candidates = [];
  for (const raw of input.feedback) {
    const validated = H.validateFeedback(raw);
    if (!validated.valid) { skipped.invalid++; continue; }
    const item = validated.value;
    // Never include excluded customer colors in the candidate JSON or report.
    if (item.reason === 'CUSTOMER_OVERRIDE') { skipped.customerOverride++; continue; }
    if (!item.confirmed) { skipped.unconfirmed++; continue; }
    if (!item.learningEligible || !categories.has(item.category)) { skipped.ineligible++; continue; }
    const key = evidenceKey(item);
    if (seen.has(key)) { skipped.duplicate++; continue; }
    seen.add(key);
    const recipe = recipes.get(item.recipeId);
    const linked = recipe && recipe.category === item.category && applies(recipe, item.context);
    const type = item.reason === 'SEMANTIC' ? 'SEMANTIC_REVIEW_ONLY'
      : item.reason === 'IP' ? 'SCOPED_CHARACTER_REVIEW' : item.kind === 'golden' ? 'GOLDEN_SAMPLE_REVIEW' : 'AESTHETIC_REVIEW';
    const candidate = {
      id: 'candidate-' + key.slice(0, 32), feedbackId: item.id, type, componentId: item.componentId,
      category: item.category, name: item.name, context: item.context, recipeId: linked ? recipe.id : null,
      linkedToCurrentRecipe: Boolean(linked), currentStatus: linked ? recipe.status : null,
      evidenceCount: 1, observedChanges: item.changes, proposedColorChanges: [], warnings: [],
      decision: 'REQUIRES_ARTIST_APPROVAL'
    };
    if (!linked) candidate.warnings.push('未关联当前适用配方；需先确认部件、模板和配方，不能按颜色猜测关联。');
    if (item.reason === 'SEMANTIC') {
      candidate.warnings.push('仅作词义复核；需补充原词和目标词条，不依据 HEX 差异改锚点、配方或词条权重。');
    } else if (item.kind === 'golden') {
      candidate.sample = item.finalSnapshot;
      candidate.warnings.push('优质样本只保留参考快照，不伪造修改，也不自动升为稳定规则。');
    } else if (linked) {
      for (const change of item.changes) {
        const current = change.role === 'anchorHex' ? recipe.anchorHex : recipe.layers[change.role];
        if (current === undefined || !change.to || !change.from) {
          candidate.warnings.push('图层 ' + change.role + ' 缺少一对一配方映射或有效前后色，保留人工检查。');
          continue;
        }
        if (current !== change.from) {
          candidate.warnings.push('图层 ' + change.role + ' 的当前配方已不同于记录起点，须对照现行版本重新确认。');
          continue;
        }
        candidate.proposedColorChanges.push({ role: change.role, before: current, after: change.to });
      }
    }
    if (item.reason === 'IP') candidate.warnings.push('只建议该角色及明确模板/方案范围内的颜色规则；不绑定或自动选择头发等素材。');
    candidates.push(candidate);
  }
  return {
    schemaVersion: 1, type: 'SHINE_REVIEW_CANDIDATES', sourceOwner: handbook.owner,
    sourceHandbookVersion: handbook.version, sourceHandbookDigest: digest(handbook),
    publishes: false, updateSuggested: candidates.length > 0, inputCount: input.feedback.length,
    skipped, candidates
  };
}

function renderReport(review) {
  const lines = ['# SHINE 配色复盘候选', '',
    '账户：' + markdown(review.sourceOwner) + '；依据手册版本：' + review.sourceHandbookVersion + '。', '',
    '**只整理候选，没有发布、修改配方、创建定时任务或写入笔记库。**', '',
    '收到 ' + review.inputCount + ' 条记录，保留 ' + review.candidates.length + ' 条待审核候选。',
    '排除：客户单次要求 ' + review.skipped.customerOverride + '、未确认 ' + review.skipped.unconfirmed
      + '、不具备学习条件 ' + review.skipped.ineligible + '、重复 ' + review.skipped.duplicate + '、格式不合法 ' + review.skipped.invalid + '。', ''];
  if (!review.candidates.length) lines.push('没有有效样本，本次不建议更新。现有手册和原色配方保持不变。', '');
  for (const [index, candidate] of review.candidates.entries()) {
    lines.push('## ' + (index + 1) + '. ' + markdown(candidate.name || candidate.componentId), '',
      '- 类型：' + candidate.type, '- 配方：' + markdown(candidate.recipeId || '尚未关联'),
      '- 范围：模板 ' + markdown(candidate.context.templateSignature || '未注明') + ' / 方案 '
        + markdown(candidate.context.schemeId || '未注明') + ' / 角色 ' + markdown(candidate.context.characterName || '未注明'), '');
    if (candidate.observedChanges.length) {
      lines.push('| 主动修改项目 | 原色 | 最终色 |', '| --- | --- | --- |');
      for (const change of candidate.observedChanges) lines.push('| ' + markdown(change.role) + ' | ' + (change.from || '未记录') + ' | ' + (change.to || '未记录') + ' |');
      lines.push('');
    }
    if (candidate.sample) lines.push('已保留明确确认的完整颜色快照；没有色差不代表没有价值。', '');
    for (const warning of candidate.warnings) lines.push('- ' + markdown(warning));
    lines.push('', '审核动作：保留参考 / 拒绝 / 在手册编辑器中手动修改并预览。', '');
  }
  lines.push('下一步必须先核对实际 PSD 预览、保护图层和混合模式，再由画师确认提交。候选文件不能直接导入为正式手册。', '');
  return lines.join('\n');
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!['--input', '--output'].includes(argv[i]) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('Usage: node scripts/review-handbook.js --input <export.json> --output <new-review-directory>');
    const key = argv[i].slice(2);
    if (args[key]) throw new Error('Duplicate argument: ' + argv[i]);
    args[key] = argv[++i];
  }
  if (!args.input || !args.output) throw new Error('Both --input and --output are required');
  return args;
}

function main(argv) {
  const args = parseArgs(argv);
  const inputPath = fs.realpathSync(path.resolve(args.input));
  const stat = fs.statSync(inputPath);
  if (!stat.isFile() || stat.size > MAX_EXPORT_BYTES) throw new Error('Input must be a JSON file no larger than 8 MB');
  const review = createReview(JSON.parse(fs.readFileSync(inputPath, 'utf8').replace(/^\uFEFF/, '')));
  const outputPath = path.resolve(args.output);
  if ([path.parse(outputPath).root, process.cwd(), path.resolve(__dirname, '..'), path.dirname(inputPath)].includes(outputPath)) {
    throw new Error('Choose a dedicated review output directory, not a drive, workspace, or input directory');
  }
  if (fs.existsSync(outputPath)) {
    if (fs.lstatSync(outputPath).isSymbolicLink() || !fs.statSync(outputPath).isDirectory() || fs.readdirSync(outputPath).length) throw new Error('Output must be a new or empty dedicated directory');
  }
  fs.mkdirSync(outputPath, { recursive: true });
  fs.writeFileSync(path.join(outputPath, 'review-candidates.json'), JSON.stringify(review, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  fs.writeFileSync(path.join(outputPath, 'review-report.md'), renderReport(review), { encoding: 'utf8', flag: 'wx' });
  return { outputPath, candidates: review.candidates.length, publishes: false };
}

if (require.main === module) {
  try { process.stdout.write(JSON.stringify(main(process.argv.slice(2))) + '\n'); }
  catch (error) { process.stderr.write('SHINE review: ' + error.message + '\n'); process.exitCode = 1; }
}
module.exports = { createReview, renderReport, main, parseArgs };
