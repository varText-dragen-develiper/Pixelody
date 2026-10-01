const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const identity = require('../release/windows-identity.json');

const root = path.resolve(__dirname, '..');
const configText = fs.readFileSync(path.join(root, 'electron-builder.windows.cjs'), 'utf8');
const mainText = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
const releaseAuditText = fs.readFileSync(path.join(root, 'scripts', 'check-windows-release.js'), 'utf8');
const releaseBuildText = fs.readFileSync(path.join(root, 'scripts', 'build-windows-release.js'), 'utf8');
const releaseNotesText = fs.readFileSync(path.join(root, 'release', 'windows-v0.1.1-release-notes.md'), 'utf8');
const signatureHelperText = fs.readFileSync(path.join(root, 'scripts', 'get-authenticode-signature.ps1'), 'utf8');
const packageJson = require('../package.json');
require('./check-windows-package-policy');
assert.equal(identity.appId, identity.appUserModelId);
assert.equal(identity.installScope, 'perUser');
assert.match(identity.installerDirectoryName, /^[a-z0-9][a-z0-9._+-]*$/);
assert.deepEqual(identity.architecture, ['x64']);
assert.match(identity.installerGuid, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
assert.equal(packageJson.productName, identity.productName);
assert.equal(packageJson.name, identity.installerDirectoryName);
assert.deepEqual(packageJson.repository, {
  type: 'git',
  url: 'https://github.com/varText-dragen-develiper/pixelody.git',
});
assert.equal(packageJson.devDependencies.electron, '43.4.1');
assert.equal(packageJson.devDependencies['electron-builder'], '26.11.1');
assert.equal(packageJson.devDependencies['@electron/asar'], '3.4.1');
assert.match(configText, /asar: true/);
assert.match(configText, /name: identity\.installerDirectoryName/);
assert.match(configText, /forceCodeSigning: signed/);
assert.match(configText, /signingHashAlgorithms: \['sha256'\]/);
assert.match(configText, /rfc3161TimeStampServer/);
assert.match(configText, /perMachine: false/);
assert.match(configText, /allowElevation: false/);
assert.match(configText, /packElevateHelper: false/);
assert.match(configText, /deleteAppDataOnUninstall: false/);
assert.match(mainText, /!integrationTestMode\) app\.setAppUserModelId\(releaseIdentity\.appUserModelId\)/);
assert.match(mainText, /releaseIdentity\.userDataDirectoryName/);
assert.match(releaseAuditText, /'pwsh\.exe'/);
assert.match(releaseAuditText, /WindowsPowerShell', 'v1\.0', 'powershell\.exe'/);
assert.match(releaseAuditText, /Windows Authenticode inspection failed closed/);
assert.match(releaseBuildText, /fs\.rmSync\(output, \{ recursive: true, force: true \}\)/);
assert.match(releaseAuditText, /expectedRootArtifacts/);
assert.match(releaseAuditText, /Release root is missing the exact/);
assert.match(releaseNotesText, /grouped\/two-output path is an experimental prototype and is not release-quality synchronized playback/);
assert.match(releaseNotesText, /native audio helper binaries are not production features and are not included in the installer/);
assert.match(releaseNotesText, /does not claim bit-perfect or exclusive-mode output/);
assert.match(signatureHelperText, /Import-Module Microsoft\.PowerShell\.Security -ErrorAction Stop/);
assert.match(signatureHelperText, /Get-AuthenticodeSignature -LiteralPath \$resolved -ErrorAction Stop/);
for (const file of ['build/icon.svg', 'build/icon.png', 'scripts/create-release-icon.ps1', 'scripts/get-authenticode-signature.ps1', 'scripts/build-windows-release.js', 'scripts/check-windows-release.js', 'release/windows-identity.json']) {
  assert.ok(fs.existsSync(path.join(root, ...file.split('/'))), `${file} is missing.`);
}
console.log('Windows release identity, packaging, signing, and uninstall-preservation configuration passed.');
