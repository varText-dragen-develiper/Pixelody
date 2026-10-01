const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { sourceInventory } = require('./windows-package-policy');
const { captureSource } = require('./windows-release-source');
const identity = require('../src/release-identity');

const root = path.resolve(__dirname, '..');
const mode = process.argv.find((value) => value.startsWith('--mode='))?.slice(7) || 'unsigned';
const version = process.argv.find((value) => value.startsWith('--version='))?.slice(10) || '';
const outputValue = process.argv.find((value) => value.startsWith('--output='))?.slice(9) || '';
if (!['unsigned', 'signed', 'instrumented'].includes(mode)) throw new Error('Mode must be unsigned, signed, or instrumented.');
if (version && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Version override must be a semantic version.');
if (mode === 'signed' && version) throw new Error('Signed builds must use the package version, never a fixture override.');
if (mode === 'signed') {
  const hasLink = Boolean(process.env.WIN_CSC_LINK || process.env.CSC_LINK);
  const hasPassword = Boolean(process.env.WIN_CSC_KEY_PASSWORD || process.env.CSC_KEY_PASSWORD);
  if (!hasLink || !hasPassword || !process.env.PIXELODY_WINDOWS_PUBLISHER_SUBJECT) {
    throw new Error('Signed release requires a secret-backed CSC/WIN_CSC link, password, and exact PIXELODY_WINDOWS_PUBLISHER_SUBJECT. No values are logged.');
  }
}
sourceInventory(root, mode === 'instrumented');
const sourceBefore = captureSource(root, { instrumented: mode === 'instrumented', requireClean: mode === 'signed' });
const releaseRoot = path.join(root, '.artifacts', 'windows-release');
const output = path.resolve(outputValue || path.join(releaseRoot, mode));
const relative = path.relative(releaseRoot, output);
if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Release output must be a child of .artifacts/windows-release.');
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
const cli = require.resolve('electron-builder/cli.js');
const env = {
  ...process.env,
  PIXELODY_RELEASE_SIGNING: mode === 'signed' ? 'required' : 'disabled',
  PIXELODY_RELEASE_TEST_INSTRUMENTATION: mode === 'instrumented' ? '1' : '0',
  PIXELODY_RELEASE_OUTPUT: output,
  CSC_IDENTITY_AUTO_DISCOVERY: mode === 'signed' ? 'true' : 'false',
  PIXELODY_RELEASE_VERSION_OVERRIDE: version,
};
if (mode !== 'signed') {
  // Unsigned/test builds cannot consume a credential inherited by the host.
  // This changes only the child environment, never the stored credential.
  for (const name of ['WIN_CSC_LINK', 'CSC_LINK', 'WIN_CSC_KEY_PASSWORD', 'CSC_KEY_PASSWORD', 'PIXELODY_WINDOWS_PUBLISHER_SUBJECT']) delete env[name];
}
const builderArgs = [cli, '--config', 'electron-builder.windows.cjs', '--win', mode === 'instrumented' ? '--dir' : 'nsis', `--${identity.architecture[0]}`, '--publish', 'never'];
// Signing providers may echo a malformed link or credential in an error. Keep
// their raw output in memory only and emit a bounded status, never secret text.
const built = spawnSync(process.execPath, builderArgs, { cwd: root, env, stdio: mode === 'signed' ? 'pipe' : 'inherit', windowsHide: true });
if (mode === 'signed') console.log(`Signing provider completed with status ${built.status ?? 'launch-failed'}. Raw provider output is withheld.`);
if (built.status !== 0) process.exit(built.status || 1);
const sourceAfter = captureSource(root, { instrumented: mode === 'instrumented', requireClean: mode === 'signed' });
if (sourceBefore.head !== sourceAfter.head || sourceBefore.inputSha256 !== sourceAfter.inputSha256) throw new Error('Release inputs changed during packaging; discard this build and repeat the affected gates.');
for (const generatedDebugFile of ['builder-debug.yml', 'builder-effective-config.yaml']) {
  fs.rmSync(path.join(output, generatedDebugFile), { force: true });
}
fs.rmSync(path.join(output, '.icon-ico'), { recursive: true, force: true });
const auditArgs = [path.join(root, 'scripts', 'check-windows-release.js'), `--output=${output}`, `--signing=${mode === 'signed' ? 'signed' : 'unsigned'}`];
if (mode === 'instrumented') auditArgs.push('--instrumented');
const audited = spawnSync(process.execPath, auditArgs, { cwd: root, env, stdio: 'inherit', windowsHide: true });
process.exit(audited.status === 0 ? 0 : 1);
