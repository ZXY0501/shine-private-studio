'use strict';
// Disposable browser QA only. The picker returns origin-private storage, never a user's folder.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.SHINE_PLAYWRIGHT_MODULE || 'playwright');

async function main() {
  const url = process.argv[2] || 'http://127.0.0.1:8782/';
  if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('Backup QA only accepts loopback.');
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const browser = await chromium.launch({ headless: true, ...(fs.existsSync(edge) ? { executablePath: edge } : {}) });
  const context = await browser.newContext(), page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(url + '#studio', { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const directory = await root.getDirectoryHandle('isolated-backup-qa', { create: true });
      // This is a test double for folder selection, not permission to any real user directory.
      window.showDirectoryPicker = async () => directory;
    });
    await page.locator('[data-section="backup"]').click();
    await page.locator('#studioFolder').click();
    await page.waitForFunction(() => /本次已写入 1 份手册/.test(document.querySelector('#studioStatus')?.textContent || ''));
    const readFiles = () => page.evaluate(async () => {
      const root = await navigator.storage.getDirectory(), dir = await root.getDirectoryHandle('isolated-backup-qa');
      const files = [];
      for await (const [name, handle] of dir.entries()) files.push({ name, body: await (await handle.getFile()).text() });
      return files;
    });
    const initial = await readFiles();
    assert.equal(initial.length, 2);
    assert.equal(JSON.parse(initial.find(file => file.name.endsWith('.json')).body).version, 1);
    assert.ok(initial.find(file => file.name.endsWith('.md')).body.includes('#'));
    assert.match(await page.locator('#studioContent').innerText(), /备份待办 0 份/);

    // Force a write failure inside this isolated profile; the UI must keep the saved snapshot pending.
    await page.evaluate(() => {
      window.qaOriginalWritable = FileSystemFileHandle.prototype.createWritable;
      FileSystemFileHandle.prototype.createWritable = async function () { throw new Error('QA disk unavailable'); };
    });
    await page.locator('[data-section="book"]').click();
    await page.locator('[data-edit="hair-gold"]').click();
    await page.locator('[data-hex="lineart"]').fill('#BB9999');
    await page.locator('#studioSaveRecipe').click();
    await page.waitForFunction(() => document.querySelector('#studioOwner')?.textContent.includes('v2') && !document.querySelector('#studioSaveRecipe'));
    await page.locator('[data-section="backup"]').click();
    assert.match(await page.locator('#studioContent').innerText(), /文件夹备份未完成/);
    assert.match(await page.locator('#studioContent').innerText(), /备份待办 1 份/);
    await page.evaluate(() => { FileSystemFileHandle.prototype.createWritable = window.qaOriginalWritable; });
    await page.locator('#studioRetryBackup').click();
    await page.waitForFunction(() => /本次已写入 1 份手册/.test(document.querySelector('#studioStatus')?.textContent || ''));
    const completed = await readFiles();
    const v2 = completed.filter(file => file.name.includes('-v2-') && file.body);
    assert.equal(v2.length, 2);
    assert.equal(JSON.parse(v2.find(file => file.name.endsWith('.json')).body).recipes.find(recipe => recipe.id === 'hair-gold').layers.lineart, '#BB9999');
    assert.match(await page.locator('#studioContent').innerText(), /备份待办 0 份/);
    assert.deepEqual(errors, []);
    await page.goto(new URL('inbox.html', url).href, { waitUntil: 'networkidle' });
    await page.setViewportSize({ width: 390, height: 844 });
    const layout = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
    assert.ok(layout.content <= layout.viewport, 'mobile inbox must not overflow horizontally');
    process.stdout.write('PASS: real origin-private JSON/Markdown writes, first connect, truthful failure, retained queue, retry, mobile layout. No user folder or real browser profile accessed.\n');
  } finally { await context.close(); await browser.close(); }
}
main().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
