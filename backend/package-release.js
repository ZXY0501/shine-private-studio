'use strict';

// Build a fresh, allowlisted staging folder. Never reads .env or deletes a prior release.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function regularFile(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Release input must be a regular file: ' + path.basename(file));
}

function packageRelease({ repoRoot = path.resolve(__dirname, '..'), withDependencies = false } = {}) {
  repoRoot = fs.realpathSync(repoRoot);
  const backend = path.join(repoRoot, 'backend');
  const inputs = ['server.js', 'package.json', 'package-lock.json'].map(name => ({ source: path.join(backend, name), target: name }));
  const sourceDir = path.join(backend, 'src');
  if (fs.lstatSync(sourceDir).isSymbolicLink()) throw new Error('Release source directory cannot be a symbolic link.');
  for (const name of fs.readdirSync(sourceDir).sort()) {
    if (!/^[a-zA-Z0-9_-]+\.js$/.test(name)) continue;
    inputs.push({ source: path.join(sourceDir, name), target: 'src/' + name });
  }
  inputs.push({ source: path.join(repoRoot, 'color-handbook.js'), target: 'color-handbook.js' });
  inputs.forEach(input => regularFile(input.source));
  const dependencyDir = path.join(backend, 'node_modules');
  if (withDependencies && (!fs.existsSync(dependencyDir) || fs.lstatSync(dependencyDir).isSymbolicLink())) {
    throw new Error('Install backend dependencies before packaging with --with-dependencies.');
  }
  const outputRoot = path.join(repoRoot, '.deploy');
  if (fs.existsSync(outputRoot) && fs.lstatSync(outputRoot).isSymbolicLink()) throw new Error('.deploy cannot be a symbolic link.');
  fs.mkdirSync(outputRoot, { recursive: true });
  const output = fs.mkdtempSync(path.join(outputRoot, 'backend-'));
  fs.mkdirSync(path.join(output, 'src'));
  const files = [];
  for (const input of inputs) {
    const bytes = fs.readFileSync(input.source);
    fs.writeFileSync(path.join(output, input.target), bytes, { flag: 'wx' });
    files.push({ path: input.target, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
  }
  if (withDependencies) {
    fs.cpSync(dependencyDir, path.join(output, 'node_modules'), {
      recursive: true, errorOnExist: true, force: false,
      filter(source) {
        if (fs.lstatSync(source).isSymbolicLink()) throw new Error('Release dependencies contain an unsupported symbolic link.');
        // npm's shell launchers are not needed for node server.js.
        return path.basename(source) !== '.bin' && !/^\.env(?:\.|$)/.test(path.basename(source));
      }
    });
  }
  fs.writeFileSync(path.join(output, 'release-manifest.json'), JSON.stringify({
    schemaVersion: 1, createdAt: new Date().toISOString(), dependenciesBundled: withDependencies,
    entrypoint: 'node server.js', files
  }, null, 2) + '\n', { flag: 'wx' });
  return { output, files, dependenciesBundled: withDependencies };
}

if (require.main === module) {
  try {
    if (process.argv.slice(2).some(arg => arg !== '--with-dependencies')) throw new Error('Usage: node backend/package-release.js [--with-dependencies]');
    const result = packageRelease({ withDependencies: process.argv.includes('--with-dependencies') });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (!result.dependenciesBundled) process.stdout.write('Source-only staging: run npm ci --omit=dev inside this fresh directory before deployment.\n');
  } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}

module.exports = { packageRelease };
