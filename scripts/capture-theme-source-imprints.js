'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const archiveRoot = path.join(root, 'notes', 'theme-imprints', '2026-08-25-pre-studio-rebuild');
const paintArgument = process.argv.find((argument) => argument.startsWith('--paint-root='));
const paintRoot = paintArgument ? path.resolve(paintArgument.slice('--paint-root='.length)) : '';
const registryPath = path.join(root, 'src', 'themes', 'built-in-themes.json');
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));

if (fs.existsSync(path.join(archiveRoot, 'IMPRINT_MANIFEST.json'))) {
  throw new Error(`Theme imprint archive already exists: ${archiveRoot}`);
}

function ensureInside(base, target) {
  const relative = path.relative(path.resolve(base), path.resolve(target));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Archive target escaped its root: ${target}`);
}

function copyFile(source, target) {
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) return false;
  ensureInside(archiveRoot, target);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  return true;
}

function copyTree(source, target) {
  if (!fs.existsSync(source)) return;
  ensureInside(archiveRoot, target);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, force: false, errorOnExist: true });
}

function safeName(value) {
  return String(value || '').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'item';
}

fs.mkdirSync(archiveRoot, { recursive: true });
copyTree(path.join(root, 'src', 'themes'), path.join(archiveRoot, 'runtime-snapshot', 'src', 'themes'));
copyTree(path.join(root, 'src', 'assets', 'themes'), path.join(archiveRoot, 'runtime-snapshot', 'src', 'assets', 'themes'));
copyTree(path.join(root, 'src', 'theme-runtime'), path.join(archiveRoot, 'runtime-snapshot', 'src', 'theme-runtime'));
copyTree(path.join(root, 'src', 'theme-instruments'), path.join(archiveRoot, 'runtime-snapshot', 'src', 'theme-instruments'));

for (const relative of ['src/index.html', 'src/renderer.js', 'src/styles.css', 'src/precision-pixel.css', 'src/playback-performance.css', 'src/mini-player.html', 'src/mini-player.js', 'src/mini-player.css', 'docs/themes/THEME_SYSTEM.md', 'docs/themes/THEME_CATALOG.md']) {
  copyFile(path.join(root, relative), path.join(archiveRoot, 'runtime-snapshot', relative));
}

for (const theme of registry.themes || []) {
  const themeRoot = path.join(archiveRoot, 'themes', safeName(theme.runtimeKey));
  const manifestSource = path.join(root, 'src', 'themes', theme.manifest);
  copyFile(manifestSource, path.join(themeRoot, 'manifest', path.basename(manifestSource)));
  for (const styleRelative of [...(theme.mainStyles || []), ...(theme.miniStyles || [])]) {
    const source = path.resolve(path.join(root, 'src', 'themes'), styleRelative);
    copyFile(source, path.join(themeRoot, 'styles', path.basename(source)));
  }
  if (fs.existsSync(manifestSource)) {
    const manifest = JSON.parse(fs.readFileSync(manifestSource, 'utf8'));
    const assetValues = [
      ...Object.values(manifest.assets || {}),
      manifest.typography?.font,
    ].filter(Boolean);
    for (const assetRelative of assetValues) {
      const source = path.resolve(path.dirname(manifestSource), assetRelative);
      copyFile(source, path.join(themeRoot, 'declared-assets', path.basename(source)));
    }
  }
  if (paintRoot) copyFile(path.join(paintRoot, `theme-imprint-${theme.runtimeKey}.png`), path.join(archiveRoot, 'painted', `${theme.runtimeKey}.png`));
}

const cartridgeRoot = path.join(archiveRoot, 'CARTRIDGE_QUEST_EXACT_ISOLATE');
for (const relative of [
  'src/themes/cartridge-quest.theme.json',
  'src/cartridge-quest.css',
  'src/mini-cartridge-quest.css',
  'src/styles.css',
  'src/renderer.js',
  'src/index.html',
  'src/mini-player.js',
  'src/mini-player.html',
  'src/playback-performance.css',
  'src/assets/fonts/GeistPixel-Circle.woff2',
]) copyFile(path.join(root, relative), path.join(cartridgeRoot, relative));
copyTree(path.join(root, 'src', 'assets', 'themes', 'cartridge-quest'), path.join(cartridgeRoot, 'src', 'assets', 'themes', 'cartridge-quest'));
if (paintRoot) copyFile(path.join(paintRoot, 'theme-imprint-cartridge-quest.png'), path.join(cartridgeRoot, 'painted', 'cartridge-quest.png'));

const files = [];
function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(full);
    else if (entry.isFile()) {
      const buffer = fs.readFileSync(full);
      files.push({
        archivePath: path.relative(archiveRoot, full).replaceAll('\\', '/'),
        bytes: buffer.length,
        sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      });
    }
  }
}
collect(archiveRoot);
files.sort((left, right) => left.archivePath.localeCompare(right.archivePath));
const manifest = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  purpose: 'Recoverable pre-reset source and painted imprints for the Pixelody Studio rebuild.',
  sourceThemeCount: (registry.themes || []).length,
  sourceRuntimeKeys: (registry.themes || []).map((theme) => theme.runtimeKey),
  cartridgeQuestExactIsolate: true,
  paintRootIncluded: Boolean(paintRoot),
  fileCount: files.length,
  files,
};
fs.writeFileSync(path.join(archiveRoot, 'IMPRINT_MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Captured ${manifest.sourceThemeCount} theme imprints (${manifest.fileCount} files) at ${archiveRoot}.`);
