const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { inspectAppFile, inspectContent, sourceIncluded, sourceInventory, artifactName } = require('./windows-package-policy');
const identity = require('../release/windows-identity.json');
const version = require('../package.json').version;
const harmless = Buffer.from('original package content');
const hostilePaths = ['src/private-assets/art.png', 'src/PRIVATE_DO_NOT_SHIP/art.png', 'src/evidence/capture.png', 'src/.env', 'src/signing.pfx', 'src/private.wav', 'src/test-profiles/state.json', 'unexpected.js'];
for (const file of hostilePaths) assert.throws(() => inspectAppFile(file, harmless), undefined, file);
for (const file of ['src/integration-test-runner.js', 'src/security-probe-preload.js', 'src/security-probe.html']) {
  assert.throws(() => inspectAppFile(file, harmless));
  assert.doesNotThrow(() => inspectAppFile(file, harmless, { instrumented: true }));
}
for (const file of ['src/workspace-composition/README.md', 'src/visualizer-lab.html', 'src/theme-instrument-foundry.js', 'src/workspace-composition-lab.html']) assert.equal(sourceIncluded(file, true), false);
assert.equal(sourceIncluded('src/assets/themes/orbital-retro/LICENSE-KENNEY.txt'), true);
assert.doesNotThrow(() => inspectAppFile('src/assets/themes/orbital-retro/LICENSE-KENNEY.txt', harmless));
assert.doesNotThrow(() => inspectAppFile('src/assets/themes/ui-sounds/kenney-rpg/click.ogg', harmless));
const privateText = ['C:', 'Users', 'package-policy-fixture', 'private-file'].join('\\');
for (const encoding of ['utf8', 'utf16le']) {
  assert.throws(() => inspectContent('src/image.png', Buffer.from(`metadata ${privateText}`, encoding)), (error) => error.message.includes('host-user-path') && !error.message.includes(privateText));
}
for (const text of ['-----BEGIN PRIVATE KEY-----', 'WIN_CSC_KEY_PASSWORD="synthetic-secret"', `ghp_${'x'.repeat(36)}`]) {
  assert.throws(() => inspectContent('src/settings.json', Buffer.from(text)), (error) => !error.message.includes(text));
}
const expectedName = identity.artifactName.replace('${version}', version).replace('${arch}', identity.architecture[0]).replace('${ext}', 'exe');
assert.equal(artifactName(version), expectedName);
assert.throws(() => artifactName('../escape'));
const inventory = sourceInventory(path.resolve(__dirname, '..'));
assert.ok(inventory.length > 0);
const png = fs.readFileSync(path.resolve(__dirname, '../src/assets/brand/window-icon-ultraviolet.png'));
assert.doesNotThrow(() => inspectContent('src/assets/brand/window-icon-ultraviolet.png', png));
assert.ok(!inventory.some((record) => record.included && record.path.startsWith('src/assets/themes/dead-signal/')));
const publicNotice = require('./windows-public-notices').publicAssetNotice(path.resolve(__dirname, '..'));
assert.ok(publicNotice.includes('## Pixelarticons desktop UI glyphs'));
assert.ok(!publicNotice.includes('## Poly Haven: Blue Metal Plate'));
assert.ok(publicNotice.includes('## Space Grotesk'));
assert.ok(!publicNotice.includes('being-on-this-early.gif'));
console.log(`Windows package boundary passed: hostile path/content rejection, preserved license notices, identity naming, and ${inventory.length} classified source files.`);
