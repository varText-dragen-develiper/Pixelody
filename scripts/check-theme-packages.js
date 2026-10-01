'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { MAX_PACKAGE_BYTES, ThemePackageError, parseThemePackageBytes } = require('../src/theme-packages/contract');
const { ThemePackageStore } = require('../src/theme-packages/store');

const root = path.resolve(__dirname, '..');
const templatePath = path.join(root, 'src', 'themes', 'community-theme-template.pixelody-theme');

function expectThemeError(action, code) {
  assert.throws(action, (error) => error instanceof ThemePackageError && error.code === code, `Expected ThemePackageError ${code}.`);
}

async function expectThemeRejection(action, code) {
  await assert.rejects(action, (error) => error instanceof ThemePackageError && error.code === code, `Expected ThemePackageError ${code}.`);
}

async function main() {
  const mainSource = await fs.readFile(path.join(root, 'src', 'main.js'), 'utf8');
  const preloadSource = await fs.readFile(path.join(root, 'src', 'preload.js'), 'utf8');
  const rendererSource = await fs.readFile(path.join(root, 'src', 'renderer.js'), 'utf8');
  const miniSource = await fs.readFile(path.join(root, 'src', 'mini-player.js'), 'utf8');
  const indexSource = await fs.readFile(path.join(root, 'src', 'index.html'), 'utf8');
  const miniIndexSource = await fs.readFile(path.join(root, 'src', 'mini-player.html'), 'utf8');
  const communityCss = await fs.readFile(path.join(root, 'src', 'community-theme.css'), 'utf8');
  const miniCommunityCss = await fs.readFile(path.join(root, 'src', 'mini-community-theme.css'), 'utf8');
  for (const channel of ['theme:list-packages', 'theme:import-package', 'theme:delete-package']) {
    assert.ok(mainSource.includes(`registerHandle('${channel}'`), `Main process is missing ${channel}.`);
    assert.ok(preloadSource.includes(`'${channel}'`), `Main preload is missing ${channel}.`);
  }
  for (const marker of ['communityThemes', 'refreshCommunityThemes', 'activeCommunityTheme', 'effectiveThemeKey', 'communityTheme: communityTheme ?']) {
    assert.ok(rendererSource.includes(marker), `Renderer is missing community-theme runtime marker ${marker}.`);
  }
  // Package parsing and storage remain implemented, but the reset deliberately
  // withholds package presentation and application from the live shell.
  assert.match(indexSource, /id="communityThemeManager" hidden[\s\S]*id="importThemePackage"[\s\S]*id="communityThemeGrid"/);
  assert.doesNotMatch(indexSource, /href="community-theme\.css"/);
  assert.doesNotMatch(miniIndexSource, /href="mini-community-theme\.css"/);
  assert.match(rendererSource, /const STUDIO_REBUILD_MODE = true;/);
  assert.match(miniSource, /state\.theme === 'community'[\s\S]*communityTokens/);
  assert.match(communityCss, /body\[data-theme="community"\]/);
  assert.match(miniCommunityCss, /body\[data-theme="community"\]/);

  const templateBytes = await fs.readFile(templatePath);
  const template = JSON.parse(templateBytes.toString('utf8'));
  const normalized = parseThemePackageBytes(templateBytes, { appVersion: '0.1.1' });
  assert.equal(normalized.type, 'theme');
  assert.equal(normalized.theme.id, 'creator.theme-name');
  assert.equal(normalized.theme.tokens.accentPrimary, '#d8b66a');
  assert.equal(normalized.theme.navigation.trackBrowser, 'linear-list');

  expectThemeError(() => parseThemePackageBytes(Buffer.from('{bad')), 'invalid_json');
  expectThemeError(() => parseThemePackageBytes(Buffer.alloc(MAX_PACKAGE_BYTES + 1, 32)), 'package_size');

  const extra = structuredClone(template);
  extra.theme.executable = 'renderer.js';
  expectThemeError(() => parseThemePackageBytes(Buffer.from(JSON.stringify(extra))), 'unexpected_field');

  const builtInClaim = structuredClone(template);
  builtInClaim.theme.palette = { builtIn: 'studio' };
  expectThemeError(() => parseThemePackageBytes(Buffer.from(JSON.stringify(builtInClaim))), 'unexpected_field');

  const asset = structuredClone(template);
  asset.theme.assets.heroOverlay = '../escape.svg';
  expectThemeError(() => parseThemePackageBytes(Buffer.from(JSON.stringify(asset))), 'assets_not_supported');

  const font = structuredClone(template);
  font.theme.typography.font = 'https://tracker.invalid/font.woff2';
  expectThemeError(() => parseThemePackageBytes(Buffer.from(JSON.stringify(font))), 'fonts_not_supported');

  const incompatible = structuredClone(template);
  incompatible.compatibility.minAppVersion = '9.0.0';
  expectThemeError(() => parseThemePackageBytes(Buffer.from(JSON.stringify(incompatible)), { appVersion: '0.1.1' }), 'incompatible_app_version');

  const lowContrast = structuredClone(template);
  lowContrast.theme.tokens.foreground = '#090909';
  expectThemeError(() => parseThemePackageBytes(Buffer.from(JSON.stringify(lowContrast))), 'insufficient_contrast');

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pixelody-theme-packages-'));
  const storeDirectory = path.join(temporaryRoot, 'user-data', 'theme-packages');
  const importDirectory = path.join(temporaryRoot, 'imports');
  await fs.mkdir(importDirectory, { recursive: true });
  const firstFile = path.join(importDirectory, 'theme.pixelody-theme');
  await fs.writeFile(firstFile, templateBytes);
  const store = new ThemePackageStore({ directory: storeDirectory, appVersion: '0.1.1' });
  try {
    const installed = await store.installFromPath(firstFile);
    assert.equal(installed.ok, true);
    assert.equal(installed.installed, true);
    assert.equal(installed.package.trust.executable, false);
    assert.match(installed.package.hash, /^[a-f0-9]{64}$/);
    assert.ok(!JSON.stringify(installed.package).includes(temporaryRoot), 'Renderer descriptor leaked a local path.');

    const duplicate = await store.installFromPath(firstFile);
    assert.equal(duplicate.duplicate, true);
    let listing = await store.list();
    assert.equal(listing.packages.length, 1);
    assert.equal(listing.issues.length, 0);

    const second = structuredClone(template);
    second.version = '1.1.0';
    second.theme.name = 'Theme Name Update';
    const secondFile = path.join(importDirectory, 'theme-update.pixelody-theme');
    await fs.writeFile(secondFile, `${JSON.stringify(second, null, 2)}\n`);
    await store.installFromPath(secondFile);
    listing = await store.list();
    assert.equal(listing.packages.length, 2, 'Side-by-side package versions were not retained.');

    await expectThemeRejection(() => store.delete({ id: '../escape', version: '1.0.0', hash: installed.package.hash }), 'invalid_identity');
    const removed = await store.delete({ id: installed.package.id, version: installed.package.version, hash: installed.package.hash });
    assert.equal(removed.removed, true);
    listing = await store.list();
    assert.equal(listing.packages.length, 1);

    const remaining = listing.packages[0];
    const installedFile = path.join(storeDirectory, remaining.id, remaining.version, remaining.hash, 'package.pixelody-theme');
    await fs.appendFile(installedFile, ' ');
    listing = await store.list();
    assert.equal(listing.packages.length, 0, 'Tampered package remained admissible.');
    assert.equal(listing.issues.length, 1, 'Tampered package did not produce a bounded issue receipt.');
    assert.equal(JSON.stringify(listing.issues).includes(temporaryRoot), false, 'Issue receipt leaked a local path.');
  } finally {
    const resolvedTemporary = path.resolve(temporaryRoot);
    const resolvedSystemTemp = path.resolve(os.tmpdir());
    const relative = path.relative(resolvedSystemTemp, resolvedTemporary);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Temporary cleanup target escaped the operating-system temp directory.');
    await fs.rm(resolvedTemporary, { recursive: true, force: true });
  }

  console.log('Theme-package audit passed: the package store remains safe and intact while its presentation/application surface is deliberately unavailable during the Studio reset.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
