const fs = require('node:fs');
const path = require('node:path');
const identity = require('../release/windows-identity.json');

const probes = ['src/integration-test-runner.js', 'src/security-probe.html', 'src/security-probe-preload.js'];
const developmentPages = ['visualizer-lab', 'theme-instrument-foundry', 'workspace-composition-lab']
  .flatMap((name) => ['html', 'js', 'css'].map((extension) => `src/${name}.${extension}`));
const excludedSegments = new Set(['.git', '.appdata', '.localappdata', 'private-assets', 'private_do_not_ship', 'user-memes', 'evidence', 'screenshots', 'test-profiles', 'reports', 'secrets']);
const audioExtensions = new Set(['.flac', '.wav', '.wave', '.aiff', '.aif', '.mp3', '.m4a', '.aac', '.ogg', '.opus', '.wma', '.alac', '.ape', '.dsf', '.dff']);
const sourceExtensions = new Set(['.js', '.json', '.html', '.css', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.pixelody-theme']);

function sourceIncluded(relative, instrumented = false) {
  const lower = relative.replace(/\\/g, '/').toLowerCase();
  return !lower.split('/').some((part) => excludedSegments.has(part))
    && !/\.(md|map|log|jsonl)$/i.test(lower)
    && (!lower.endsWith('.txt') || /^src\/assets\/.*\/(?:license|ofl|info)-[^/]+\.txt$/.test(lower))
    && !developmentPages.includes(lower)
    && (instrumented || !probes.includes(lower));
}

function builderFiles(instrumented) {
  return ['package.json', 'release/windows-identity.json', 'src/**/*',
    ...[...excludedSegments].map((name) => `!src/**/${name}{,/**/*}`),
    '!src/**/*.{md,map,log,jsonl}', ...developmentPages.map((name) => `!${name}`),
    ...(instrumented ? [] : probes.map((name) => `!${name}`))];
}

function artifactName(version, extension = 'exe') {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Invalid artifact version.');
  const name = identity.artifactName.replace('${version}', version).replace('${arch}', identity.architecture[0]).replace('${ext}', extension);
  if (/[\\/]|\$\{|\.\./.test(name)) throw new Error('Artifact identity must resolve to a relative filename.');
  return name;
}

function inspectContent(relative, bytes) {
  // Inspect byte strings as well as UTF-16LE metadata; never emit matched values.
  const texts = [bytes.toString('utf8'), bytes.toString('utf16le')];
  const patterns = [
    ['host-user-path', /\b[A-Za-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+[^\s"'<>]+|\/(?:Users|home)\/[^\s/]+\//i],
    ['private-marker', /PRIVATE_DO_NOT_SHIP/],
    ['private-key', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/],
    ['credential-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16})\b/],
    ['assigned-secret', /(?:WIN_CSC_LINK|CSC_LINK|WIN_CSC_KEY_PASSWORD|CSC_KEY_PASSWORD)\s*[=:]\s*["'][^"'\r\n]+["']/],
  ];
  for (const [kind, pattern] of patterns) {
    if (texts.some((text) => pattern.test(text))) throw new Error(`Package content rejected (${kind}): ${relative}`);
  }
}

function inspectAppFile(relative, bytes, { instrumented = false } = {}) {
  const lower = relative.replace(/\\/g, '/').toLowerCase();
  const parts = lower.split('/');
  if (parts.some((part) => excludedSegments.has(part) || part === '..' || part.startsWith('.env'))
      || /\.(pfx|p12|pem|key|jks|keystore|dump|dmp|bak|db|sqlite|sqlite3)$/i.test(lower)) {
    throw new Error(`Forbidden package file: ${relative}`);
  }
  const licensedSound = lower.startsWith('src/assets/themes/ui-sounds/');
  if (audioExtensions.has(path.extname(lower)) && !licensedSound) throw new Error(`Unexpected packaged audio: ${relative}`);
  if (lower.startsWith('src/')) {
    if (!sourceIncluded(lower, instrumented)) throw new Error(`Development/private source in package: ${relative}`);
    const licenseNotice = /^src\/assets\/.*\/(?:license|ofl|info)-[^/]+\.txt$/.test(lower);
    if (lower === 'src/module-shop/listening-notes.pixelody-module') require('../src/module-shop/contract').parsePackage(bytes, 'desktop');
    if (lower !== 'src/module-shop/listening-notes.pixelody-module' && !sourceExtensions.has(path.extname(lower)) && !licenseNotice && !(licensedSound && audioExtensions.has(path.extname(lower)))) throw new Error(`Unclassified source file: ${relative}`);
  } else if (!lower.startsWith('node_modules/') && !['package.json', 'release/windows-identity.json', 'package-contents.json'].includes(lower)) {
    throw new Error(`Unclassified application file: ${relative}`);
  }
  inspectContent(relative, bytes);
}

function sourceInventory(root, instrumented = false) {
  const records = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      const relative = path.relative(root, file).replace(/\\/g, '/');
      if (entry.isSymbolicLink()) throw new Error(`Source links are not distributable: ${relative}`);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) {
        const included = sourceIncluded(relative, instrumented);
        if (included) inspectAppFile(relative, fs.readFileSync(file), { instrumented });
        records.push({ path: relative, included });
      }
    }
  }
  visit(path.join(root, 'src'));
  return records;
}

module.exports = { probes, developmentPages, artifactName, builderFiles, sourceIncluded, inspectContent, inspectAppFile, sourceInventory };
