const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const identity = require('../release/windows-identity.json');
const { sourceIncluded, inspectAppFile } = require('./windows-package-policy');

const root = path.resolve(__dirname, '..');
const artifactRoot = path.join(root, '.artifacts', 'windows-package');
const defaultOutput = path.join(artifactRoot, `${identity.productName}-win32-${identity.architecture[0]}`);
const forbiddenAppFragments = ['private-assets', '.git', '.appdata', '.localappdata', 'scripts', 'notes', 'docs', 'android'];
const forbiddenMediaExtensions = new Set(['.flac', '.wav', '.wave', '.aiff', '.aif', '.mp3', '.m4a', '.aac', '.ogg', '.opus']);

function assertInside(base, target, label) {
  const relative = path.relative(path.resolve(base), path.resolve(target));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`${label} must stay inside ${base}.`);
}

async function resetDirectory(target) {
  assertInside(path.join(root, '.artifacts'), target, 'Package output');
  await fsp.rm(target, { recursive: true, force: true });
  await fsp.mkdir(target, { recursive: true });
}

function packageRootFor(name, fromDirectory) {
  let entry;
  try {
    entry = require.resolve(name, { paths: [fromDirectory, root] });
  } catch {
    entry = require.resolve(`${name}/package.json`, { paths: [fromDirectory, root] });
  }
  let cursor = fs.statSync(entry).isDirectory() ? entry : path.dirname(entry);
  while (true) {
    const manifestPath = path.join(cursor, 'package.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (manifest.name === name) return { directory: cursor, manifest };
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  throw new Error(`Could not resolve package root for ${name}.`);
}

async function copyProductionDependencies(appDirectory, dependencies) {
  const installed = new Map();
  const targetNodeModules = path.join(appDirectory, 'node_modules');
  await fsp.mkdir(targetNodeModules, { recursive: true });

  async function copyDependency(name, fromDirectory) {
    const resolved = packageRootFor(name, fromDirectory);
    const prior = installed.get(name);
    if (prior) {
      if (prior !== resolved.manifest.version) throw new Error(`Package smoke flattening found conflicting ${name} versions: ${prior} and ${resolved.manifest.version}.`);
      return;
    }
    installed.set(name, resolved.manifest.version);
    const target = path.join(targetNodeModules, ...name.split('/'));
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.cp(resolved.directory, target, {
      recursive: true,
      dereference: true,
      filter: (source) => !path.relative(resolved.directory, source).split(path.sep).includes('node_modules'),
    });
    const childDependencies = { ...(resolved.manifest.dependencies || {}), ...(resolved.manifest.optionalDependencies || {}) };
    for (const childName of Object.keys(childDependencies).sort()) {
      try {
        await copyDependency(childName, resolved.directory);
      } catch (error) {
        if (!resolved.manifest.optionalDependencies?.[childName]) throw error;
      }
    }
  }

  for (const name of Object.keys(dependencies || {}).sort()) await copyDependency(name, root);
  return Object.fromEntries([...installed.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

async function listFiles(directory) {
  const files = [];
  async function visit(current) {
    const entries = await fsp.readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) files.push(target);
    }
  }
  await visit(directory);
  return files;
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

async function validatePackagedApp(appDirectory) {
  const topLevel = (await fsp.readdir(appDirectory)).sort();
  const allowedTopLevel = ['node_modules', 'package.json', 'package-contents.json', 'release', 'src'];
  const unexpected = topLevel.filter((name) => !allowedTopLevel.includes(name));
  if (unexpected.length) throw new Error(`Packaged app has unexpected top-level content: ${unexpected.join(', ')}`);
  const files = await listFiles(appDirectory);
  for (const file of files) {
    const relative = path.relative(appDirectory, file).replace(/\\/g, '/');
    inspectAppFile(relative, await fsp.readFile(file), { instrumented: true });
    const lower = relative.toLowerCase();
    if (!lower.startsWith('node_modules/') && forbiddenAppFragments.some((fragment) => lower.split('/').includes(fragment))) {
      throw new Error(`Forbidden package path: ${relative}`);
    }
    const isLicensedUiSound = lower.startsWith('src/assets/themes/ui-sounds/');
    if (forbiddenMediaExtensions.has(path.extname(lower)) && !isLicensedUiSound) {
      throw new Error(`Personal/test audio must not be packaged: ${relative}`);
    }
    if (lower.includes('user-memes')) throw new Error(`Private meme assets must not be packaged: ${relative}`);
  }
  for (const required of ['release/windows-identity.json', 'src/main.js', 'src/preload.js', 'src/mini-preload.js', 'src/electron-security.js', 'src/development-profiles.js', 'src/index.html', 'src/state-store.js', 'src/library-scan.js', 'src/playlist-export.js', 'src/musicbrainz.js', 'src/workspace-composition/persistence.js', 'src/workspace-composition/first-party-modules.js', 'src/workspace-composition/production-host.js', 'src/integration-test-runner.js', 'src/security-probe.html', 'src/security-probe-preload.js', 'node_modules/music-metadata/package.json', 'node_modules/qrcode-generator/dist/qrcode.js']) {
    if (!fs.existsSync(path.join(appDirectory, ...required.split('/')))) throw new Error(`Packaged app is missing ${required}.`);
  }
  return files;
}

async function buildWindowsSmokePackage(options = {}) {
  if (process.platform !== 'win32') throw new Error('The Windows smoke package can only be assembled on Windows.');
  const outputDirectory = path.resolve(options.outputDirectory || defaultOutput);
  assertInside(artifactRoot, outputDirectory, 'Package output');
  await resetDirectory(outputDirectory);

  const electronExecutable = require('electron');
  const electronDist = path.dirname(electronExecutable);
  await fsp.cp(electronDist, outputDirectory, { recursive: true, dereference: true });
  const copiedElectron = path.join(outputDirectory, 'electron.exe');
  const packagedExecutable = path.join(outputDirectory, `${identity.executableName}.exe`);
  if (!fs.existsSync(copiedElectron)) throw new Error('Electron runtime copy did not include electron.exe.');
  await fsp.rename(copiedElectron, packagedExecutable);

  const resourcesDirectory = path.join(outputDirectory, 'resources');
  await fsp.rm(path.join(resourcesDirectory, 'default_app.asar'), { force: true });
  const appDirectory = path.join(resourcesDirectory, 'app');
  await fsp.mkdir(appDirectory, { recursive: true });
  const sourceDirectory = path.join(root, 'src');
  await fsp.cp(sourceDirectory, path.join(appDirectory, 'src'), {
    recursive: true,
    dereference: true,
    filter: (source) => sourceIncluded(`src/${path.relative(sourceDirectory, source).replace(/\\/g, '/')}`, true),
  });
  const releaseDirectory = path.join(appDirectory, 'release');
  await fsp.mkdir(releaseDirectory, { recursive: true });
  await fsp.copyFile(path.join(root, 'release', 'windows-identity.json'), path.join(releaseDirectory, 'windows-identity.json'));

  const sourceManifest = JSON.parse(await fsp.readFile(path.join(root, 'package.json'), 'utf8'));
  const packagedManifest = {
    name: sourceManifest.name,
    productName: sourceManifest.productName,
    version: sourceManifest.version,
    private: true,
    description: sourceManifest.description,
    main: sourceManifest.main,
    dependencies: sourceManifest.dependencies,
  };
  await fsp.writeFile(path.join(appDirectory, 'package.json'), `${JSON.stringify(packagedManifest, null, 2)}\n`, 'utf8');
  const installedDependencies = await copyProductionDependencies(appDirectory, packagedManifest.dependencies);
  const appFiles = await validatePackagedApp(appDirectory);
  const contents = [];
  for (const file of appFiles.filter((item) => path.basename(item) !== 'package-contents.json')) {
    const stats = await fsp.stat(file);
    contents.push({ path: path.relative(appDirectory, file).replace(/\\/g, '/'), bytes: stats.size, sha256: await hashFile(file) });
  }
  const contentManifest = {
    schemaVersion: 1,
    product: identity.productName,
    version: packagedManifest.version,
    runtime: 'electron-portable-directory',
    productionDependencies: installedDependencies,
    files: contents,
    privacy: { personalMediaIncluded: false, privateAssetsIncluded: false, absolutePathsIncluded: false },
  };
  await fsp.writeFile(path.join(appDirectory, 'package-contents.json'), `${JSON.stringify(contentManifest, null, 2)}\n`, 'utf8');
  return { outputDirectory, executable: packagedExecutable, appDirectory, manifest: contentManifest };
}

if (require.main === module) {
  buildWindowsSmokePackage().then((result) => {
    console.log(`Packaged Windows smoke directory ready: ${result.outputDirectory}`);
    console.log(`Allowlisted app files: ${result.manifest.files.length}; personal media: none; private assets: none.`);
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { artifactRoot, buildWindowsSmokePackage, defaultOutput, validatePackagedApp };
