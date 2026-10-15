const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fixture = require('../release/upgrade-fixture.json');

const root = path.resolve(__dirname, '..');
const packageVersion = require('../package.json').version;
if (packageVersion !== fixture.currentVersion) throw new Error(`Upgrade fixture currentVersion ${fixture.currentVersion} must match package version ${packageVersion}.`);
const base = path.join(root, '.artifacts', 'windows-release', 'upgrade-fixture');
for (const [label, version] of [['previous', fixture.previousVersion], ['current', fixture.currentVersion]]) {
  const output = path.join(base, label);
  const result = spawnSync(process.execPath, [path.join(__dirname, 'build-windows-release.js'), '--mode=unsigned', `--version=${version}`, `--output=${output}`], { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Controlled unsigned upgrade fixture ready: ${fixture.previousVersion} -> ${fixture.currentVersion}. TEST ONLY; not publishable.`);
