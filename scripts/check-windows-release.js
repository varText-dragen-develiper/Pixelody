const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const yaml = createRequire(require.resolve('electron-builder'))('js-yaml');
const asar = require('@electron/asar');
const identity = require('../release/windows-identity.json');
const { artifactName, inspectAppFile, inspectContent, sourceInventory } = require('./windows-package-policy');
const { captureSource } = require('./windows-release-source');
const { publicAssetNotice } = require('./windows-public-notices');

const root = path.resolve(__dirname, '..');
const releaseRoot = path.join(root, '.artifacts', 'windows-release');
const outputArg = process.argv.find((value) => value.startsWith('--output='))?.slice(9);
const signing = process.argv.find((value) => value.startsWith('--signing='))?.slice(10) || 'unsigned';
const instrumented = process.argv.includes('--instrumented');
const output = path.resolve(outputArg || path.join(releaseRoot, instrumented ? 'instrumented' : signing));
const expectedVersion = process.env.PIXELODY_RELEASE_VERSION_OVERRIDE || require('../package.json').version;
const forbiddenFragments = new Set(['.git', 'notes', 'scripts', 'docs', 'android', 'private-assets', 'user-memes']);
if (!instrumented) ['security-probe.html', 'security-probe-preload.js', 'integration-test-runner.js'].forEach((value) => forbiddenFragments.add(value));
const forbiddenExtensions = new Set(['.flac', '.wav', '.wave', '.aiff', '.aif', '.mp3', '.m4a', '.aac', '.ogg', '.opus']);

function assertInside(base, target, label) {
  const relative = path.relative(path.resolve(base), path.resolve(target));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`${label} must stay inside ${base}.`);
}

async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function signature(file) {
  const helper = path.join(root, 'scripts', 'get-authenticode-signature.ps1');
  const candidates = [
    'pwsh.exe',
    path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  ];
  const failures = [];
  for (const executable of candidates) {
    const result = spawnSync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-Target', file], { encoding: 'utf8', windowsHide: true });
    if (result.error?.code === 'ENOENT') continue;
    if (result.status !== 0) {
      const detail = String(result.stderr || result.stdout || 'unknown error')
        .replaceAll(root, '[project]')
        .replace(/[A-Za-z]:\\[^\r\n]+/g, '[windows-path-hidden]')
        .split(/\r?\n/).find(Boolean) || 'unknown error';
      failures.push(`${path.basename(executable)}: ${detail}`);
      continue;
    }
    try {
      const parsed = JSON.parse(String(result.stdout || '').trim());
      if (!parsed || typeof parsed.status !== 'string') throw new Error('missing status');
      return parsed;
    } catch {
      failures.push(`${path.basename(executable)}: invalid JSON response`);
    }
  }
  throw new Error(`Windows Authenticode inspection failed closed (${failures.join('; ') || 'no supported PowerShell host found'}).`);
}

function validateAsar(archive) {
  const read = (file) => asar.extractFile(archive, path.normalize(file), false);
  const entries = asar.listPackage(archive).map((entry) => entry.replace(/^[/\\]+/, '').replace(/\\/g, '/')).filter(Boolean);
  const lowerEntries = entries.map((entry) => entry.toLowerCase());
  for (const entry of lowerEntries) {
    const parts = entry.split('/');
    if (parts.some((part) => forbiddenFragments.has(part))) throw new Error(`Forbidden production ASAR path: ${entry}`);
    const licensedSound = entry.startsWith('src/assets/themes/ui-sounds/');
    if (forbiddenExtensions.has(path.extname(entry)) && !licensedSound) throw new Error(`Unexpected audio in production ASAR: ${entry}`);
  }
  let inspectedFiles = 0;
  for (const entry of entries) {
    const metadata = asar.statFile(archive, path.normalize(entry), false);
    if (metadata.link || metadata.unpacked) throw new Error(`Unexpected linked/unpacked ASAR entry: ${entry}`);
    if (metadata.files) continue;
    inspectAppFile(entry, read(entry), { instrumented });
    inspectedFiles += 1;
  }
  const packedIdentity = JSON.parse(read('release/windows-identity.json'));
  if (JSON.stringify(packedIdentity) !== JSON.stringify(identity)) throw new Error('Packaged Windows identity differs from the authoritative contract.');
  const packedPackage = JSON.parse(read('package.json'));
  if (packedPackage.version !== expectedVersion || packedPackage.name !== identity.installerDirectoryName || packedPackage.productName !== identity.productName) throw new Error('Packaged name/product/version differs from the release contract.');
  for (const record of sourceInventory(root, instrumented)) {
    if (lowerEntries.includes(record.path.toLowerCase()) !== record.included) throw new Error(`Source/package classification mismatch: ${record.path}`);
    if (record.included && !read(record.path).equals(fs.readFileSync(path.join(root, record.path)))) throw new Error(`Package source bytes are stale: ${record.path}`);
  }
  const required = ['package.json', 'release/windows-identity.json', 'src/main.js', 'src/preload.js', 'src/mini-preload.js', 'src/release-identity.js', 'src/electron-security.js', 'src/index.html'];
  for (const file of required) if (!lowerEntries.includes(file)) throw new Error(`Production ASAR is missing ${file}.`);
  const probes = ['src/integration-test-runner.js', 'src/security-probe.html', 'src/security-probe-preload.js'];
  for (const file of probes) {
    const present = lowerEntries.includes(file);
    if (instrumented !== present) throw new Error(`${file} ${instrumented ? 'is required in' : 'must be absent from'} this package.`);
  }
  return { entryCount: entries.length, fileCount: inspectedFiles, requiredFilesPresent: true, probesIncluded: instrumented, sourceBytesMatch: true, contentScanPassed: true, passed: true };
}

function validateResources(unpacked) {
  const runtimeRoot = path.dirname(require('electron'));
  const entries = fs.readdirSync(unpacked, { recursive: true });
  if (entries.some((file) => fs.lstatSync(path.join(unpacked, file)).isSymbolicLink())) throw new Error('Linked runtime/resource payload is forbidden.');
  const files = entries.filter((file) => fs.lstatSync(path.join(unpacked, file)).isFile());
  const records = [];
  for (const relative of files) {
    const name = relative.replace(/\\/g, '/');
    const file = path.join(unpacked, relative);
    if (name === `${identity.executableName}.exe` || name === 'resources/app.asar') continue;
    if (name === 'resources/app-update.yml' && !instrumented) {
      const bytes = fs.readFileSync(file);
      inspectContent(name, bytes);
      const config = yaml.load(bytes.toString('utf8'), { schema: yaml.JSON_SCHEMA });
      const repository = new URL(require('../package.json').repository.url);
      const [owner, repo] = repository.pathname.slice(1).replace(/\.git$/, '').split('/');
      const known = ['owner', 'repo', 'provider', 'updaterCacheDirName', 'publisherName'];
      if (!config || Object.keys(config).some((key) => !known.includes(key)) || repository.hostname !== 'github.com' || config.provider !== 'github' || config.owner !== owner || config.repo !== repo || config.updaterCacheDirName !== `${identity.installerDirectoryName}-updater`) throw new Error('Generated update configuration differs from repository/identity.');
      if (config.publisherName !== undefined && (!Array.isArray(config.publisherName) || config.publisherName.some((value) => typeof value !== 'string' || !value || value.length > 300))) throw new Error('Unexpected publisher-name metadata.');
      records.push(name);
      continue;
    }
    let source;
    if (name.startsWith('resources/licenses/')) source = path.join(root, name.slice('resources/'.length));
    else if (name === 'resources/THIRD_PARTY_ASSETS.md') source = path.join(root, 'THIRD_PARTY_ASSETS.md');
    else source = path.join(runtimeRoot, name === 'LICENSE.electron.txt' ? 'LICENSE' : relative);
    const expected = name === 'resources/THIRD_PARTY_ASSETS.md' ? Buffer.from(publicAssetNotice(root)) : (fs.existsSync(source) && fs.statSync(source).isFile() ? fs.readFileSync(source) : null);
    if (!expected || !fs.readFileSync(file).equals(expected)) throw new Error(`Unexpected or changed runtime/resource payload: ${name}`);
    if (name.startsWith('resources/')) inspectContent(name, fs.readFileSync(file));
    records.push(name);
  }
  const resources = fs.readdirSync(path.join(unpacked, 'resources')).sort();
  if (JSON.stringify(resources) !== JSON.stringify(['THIRD_PARTY_ASSETS.md', 'app.asar', 'licenses', ...(instrumented ? [] : ['app-update.yml'])].sort())) throw new Error('Unexpected or missing extra-resource root.');
  for (const relative of fs.readdirSync(path.join(root, 'licenses'), { recursive: true })) {
    if (fs.statSync(path.join(root, 'licenses', relative)).isFile() && !records.includes(`resources/licenses/${relative.replace(/\\/g, '/')}`)) throw new Error('A required license notice is missing.');
  }
  return { checkedFiles: records.length, runtimeBytesMatchLockedElectron: true, extraResourcesMatchSource: true, passed: true };
}

async function main() {
  if (process.platform !== 'win32') throw new Error('Windows release auditing requires Windows.');
  if (!['unsigned', 'signed'].includes(signing)) throw new Error('Signing mode must be unsigned or signed.');
  assertInside(releaseRoot, output, 'Release output');
  const unpacked = path.join(output, 'win-unpacked');
  const archive = path.join(unpacked, 'resources', 'app.asar');
  const executable = path.join(unpacked, `${identity.executableName}.exe`);
  if (!fs.existsSync(archive) || !fs.existsSync(executable)) throw new Error('Expected win-unpacked production app and ASAR were not found.');
  if (fs.existsSync(path.join(unpacked, 'resources', 'app'))) throw new Error('Loose app directory found beside production ASAR.');
  const allowlist = validateAsar(archive);
  const resources = validateResources(unpacked);
  const rootEntries = (await fsp.readdir(output, { withFileTypes: true })).map((entry) => entry.name);
  const expectedRootArtifacts = instrumented ? [] : [
    artifactName(expectedVersion),
    `${artifactName(expectedVersion)}.blockmap`,
    'latest.yml',
  ];
  const unexpectedRootFiles = rootEntries.filter((name) => name !== 'win-unpacked' && name !== 'release-manifest.json' && !expectedRootArtifacts.includes(name));
  if (unexpectedRootFiles.length) throw new Error(`Unexpected release-root content: ${unexpectedRootFiles.join(', ')}`);
  for (const name of expectedRootArtifacts) {
    if (!rootEntries.includes(name)) throw new Error(`Release root is missing the exact ${expectedVersion} artifact: ${name}`);
  }
  if (!instrumented) {
    const installer = path.join(output, artifactName(expectedVersion));
    const latestBytes = fs.readFileSync(path.join(output, 'latest.yml'));
    inspectContent('latest.yml', latestBytes);
    const latest = yaml.load(latestBytes.toString('utf8'), { schema: yaml.JSON_SCHEMA });
    const sha512 = crypto.createHash('sha512').update(fs.readFileSync(installer)).digest('base64');
    const files = latest?.files;
    if (!latest || Object.keys(latest).some((key) => !['version', 'files', 'path', 'sha512', 'releaseDate'].includes(key)) || latest.version !== expectedVersion || latest.path !== artifactName(expectedVersion) || latest.sha512 !== sha512 || !Array.isArray(files) || files.length !== 1 || Object.keys(files[0]).some((key) => !['url', 'sha512', 'size'].includes(key)) || files[0].url !== artifactName(expectedVersion) || files[0].sha512 !== sha512 || files[0].size !== fs.statSync(installer).size || !Number.isFinite(Date.parse(latest.releaseDate))) throw new Error('Update metadata does not match the exact installer name/version/bytes.');
  }
  const candidates = expectedRootArtifacts.map((name) => path.join(output, name));
  const artifacts = [executable, archive, ...candidates].filter((value, index, values) => values.indexOf(value) === index);
  const expectedSubject = process.env.PIXELODY_WINDOWS_PUBLISHER_SUBJECT || '';
  const records = [];
  for (const file of artifacts) {
    const isExecutable = path.extname(file).toLowerCase() === '.exe';
    const auth = isExecutable ? signature(file) : null;
    if (signing === 'signed' && isExecutable) {
      if (auth.status !== 'Valid' || !auth.timestampSubject) throw new Error(`${path.basename(file)} does not have a valid timestamped Authenticode signature.`);
      if (!expectedSubject || auth.subject !== expectedSubject) throw new Error(`${path.basename(file)} signer subject does not exactly match PIXELODY_WINDOWS_PUBLISHER_SUBJECT.`);
    }
    records.push({
      name: path.relative(output, file).replace(/\\/g, '/'),
      bytes: (await fsp.stat(file)).size,
      sha256: await hashFile(file),
      ...(auth ? { signature: { status: auth.status, subject: auth.subject || '', thumbprint: auth.thumbprint || '', timestamped: Boolean(auth.timestampSubject) } } : {}),
    });
  }
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    identity: { appId: identity.appId, appUserModelId: identity.appUserModelId, productName: identity.productName, executableName: identity.executableName, installerGuid: identity.installerGuid, installScope: identity.installScope },
    version: expectedVersion,
    source: captureSource(root, { instrumented, requireClean: signing === 'signed' }),
    architecture: identity.architecture[0],
    signing,
    publishable: signing === 'signed' && !instrumented,
    instrumented,
    allowlist,
    resources,
    privacy: { relativeNamesOnly: true, credentialsIncluded: false, personalMediaIncluded: false, hostPathsIncluded: false },
    artifacts: records,
  };
  await fsp.writeFile(path.join(output, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Windows release audit passed: ${allowlist.fileCount} ASAR entries, ${records.length} hashed artifacts, signing=${signing}, instrumented=${instrumented}.`);
}

main().catch((error) => { console.error(error.message || error); process.exitCode = 1; });
