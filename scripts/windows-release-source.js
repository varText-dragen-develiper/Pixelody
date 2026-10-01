const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { sourceInventory } = require('./windows-package-policy');

function captureSource(root, { instrumented = false, requireClean = false } = {}) {
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  const head = git(['rev-parse', 'HEAD']).trim();
  const dirty = Boolean(git(['status', '--porcelain', '--untracked-files=normal']).trim());
  if (requireClean && dirty) throw new Error('Signed build requires a reviewed clean candidate; the working tree is dirty.');
  const tracked = new Set(git(['ls-files', '-z']).split('\0'));
  const inputs = sourceInventory(root, instrumented).filter((record) => record.included).map((record) => record.path);
  inputs.push('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'release/windows-identity.json', 'release/upgrade-fixture.json', 'electron-builder.windows.cjs', '.github/workflows/windows-integration.yml', 'THIRD_PARTY_ASSETS.md');
  for (const directory of ['scripts', 'licenses', 'build']) {
    for (const file of fs.readdirSync(path.join(root, directory), { recursive: true })) {
      if (fs.lstatSync(path.join(root, directory, file)).isFile()) inputs.push(`${directory}/${file.replace(/\\/g, '/')}`);
    }
  }
  const files = [...new Set(inputs)].sort().map((file) => ({ path: file, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'), tracked: tracked.has(file) }));
  const untrackedInputs = files.filter((file) => !file.tracked).length;
  if (requireClean && untrackedInputs) throw new Error('Signed build has untracked or ignored release inputs.');
  return { head, dirty, untrackedInputs, frozenCandidate: requireClean, version: require('../package.json').version, inputSha256: crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex'), files };
}

module.exports = { captureSource };
