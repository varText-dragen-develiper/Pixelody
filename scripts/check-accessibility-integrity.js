const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const access = require('../src/renderer-domains/accessibility-controller');
const outputMode = require('../src/renderer-domains/output-mode');
const integrity = require('../src/file-integrity');
const security = require('../src/electron-security');

async function run() {
  // Accessibility settings: only allowlisted values survive.
  assert.deepEqual(access.normalizeSettings(null), { textScale: 1, contrast: 'auto' });
  assert.deepEqual(access.normalizeSettings({ textScale: 2.5, contrast: 'neon' }), { textScale: 1, contrast: 'auto' });
  assert.deepEqual(access.normalizeSettings({ textScale: 1.3, contrast: 'high' }), { textScale: 1.3, contrast: 'high' });
  assert.equal(access.resolveContrast({ contrast: 'auto' }, {}), 'standard');
  assert.equal(access.resolveContrast({ contrast: 'auto' }, { forcedColors: true }), 'high');
  assert.equal(access.resolveContrast({ contrast: 'auto' }, { prefersMore: true }), 'high');
  assert.equal(access.resolveContrast({ contrast: 'standard' }, { forcedColors: true }), 'standard');
  assert.equal(access.resolveContrast({ contrast: 'high' }, {}), 'high');

  const store = new Map();
  const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  const scales = [];
  const contrasts = [];
  const controller = access.createAccessibilityController({ storage, setTextScale: (factor) => { scales.push(factor); return Promise.resolve(true); }, applyContrast: (resolved) => contrasts.push(resolved), os: () => ({}) });
  controller.apply();
  assert.deepEqual(scales, [], 'A default launch must not touch the window zoom.');
  controller.update({ textScale: 1.5, contrast: 'high' });
  assert.deepEqual(scales, [1.5]);
  assert.deepEqual(contrasts, ['standard', 'high']);
  const reloaded = access.createAccessibilityController({ storage, setTextScale() {}, applyContrast() {} });
  assert.deepEqual(reloaded.current(), { textScale: 1.5, contrast: 'high' }, 'Settings persist across launches.');
  const reloadScales = [];
  const reloadedWithZoom = access.createAccessibilityController({ storage, setTextScale: (f) => reloadScales.push(f), applyContrast() {} });
  reloadedWithZoom.apply();
  assert.deepEqual(reloadScales, [1.5], 'A saved non-default size is restored at launch.');
  assert.deepEqual(reloaded.reset(), { textScale: 1, contrast: 'auto' });
  storage.setItem(access.STORAGE_KEY, '{not json');
  assert.deepEqual(access.readSettings(storage), { textScale: 1, contrast: 'auto' }, 'Corrupt storage falls back to defaults.');

  // Output mode must never claim exclusive or bit-perfect playback.
  const shared = outputMode.describeOutputMode({ platform: 'win32', contextSampleRate: 48000, trackSampleRate: 44100 });
  assert.equal(shared.label, 'Shared mode');
  assert.equal(shared.exclusive, false);
  assert.equal(shared.bitPerfect, false);
  assert.equal(shared.resampled, true);
  assert.match(shared.detail, /44\.1 kHz.*48 kHz.*resampled/);
  assert.equal(outputMode.describeOutputMode({ platform: 'win32', contextSampleRate: 48000, trackSampleRate: 48000 }).resampled, false);
  assert.equal(outputMode.describeOutputMode({ platform: 'linux' }).label, 'System mixer');

  // File integrity against real files.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pixelody-integrity-'));
  try {
    const write = (name, buffer) => { const file = path.join(dir, name); fs.writeFileSync(file, buffer); return file; };
    const wavHeader = (dataBytes) => { const b = Buffer.alloc(44); b.write('RIFF', 0); b.writeUInt32LE(36 + dataBytes, 4); b.write('WAVE', 8); return b; };
    const good = write('good.flac', Buffer.concat([Buffer.from('fLaC'), Buffer.alloc(100)]));
    const empty = write('empty.mp3', Buffer.alloc(0));
    const fake = write('fake.flac', Buffer.from('this is plainly not audio at all'));
    const mp3 = write('tagged.mp3', Buffer.concat([Buffer.from('ID3'), Buffer.alloc(100)]));
    const cutWav = write('cut.wav', wavHeader(1000));
    const fullWav = write('full.wav', Buffer.concat([wavHeader(100), Buffer.alloc(100)]));
    const missing = path.join(dir, 'gone.flac');

    const first = await integrity.verifyFiles([{ path: good }, { path: empty }, { path: fake }, { path: mp3 }, { path: cutWav }, { path: fullWav }, { path: missing }]);
    assert.deepEqual(first.map((r) => r.status), ['ok', 'empty', 'header-mismatch', 'ok', 'truncated', 'ok', 'missing']);
    assert.equal(first[0].size, 104);

    // Baseline fingerprint: untouched is ok, modified is changed.
    const baseline = { path: good, size: first[0].size, mtimeMs: first[0].mtimeMs };
    assert.equal((await integrity.verifyFile(good, baseline)).status, 'ok');
    fs.appendFileSync(good, 'extra');
    assert.equal((await integrity.verifyFile(good, baseline)).status, 'changed');
    assert.deepEqual(integrity.summarize(first), { checked: 7, problems: 4, counts: { ok: 3, empty: 1, 'header-mismatch': 1, truncated: 1, missing: 1 } });
    assert.equal((await integrity.verifyFile(dir)).status, 'unreadable', 'A directory is not a readable audio file.');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }

  // IPC validation: only allowlisted scales and well-formed requests pass.
  for (const scale of [1, 1.15, 1.3, 1.5]) assert.equal(security.validateIpcArguments('app:set-text-scale', [scale]).ok, true);
  for (const hostile of [[], [2], ['1.3'], [1.3, 1], [{}], [Infinity]]) assert.equal(security.validateIpcArguments('app:set-text-scale', hostile).ok, false);
  const fixture = process.platform === 'win32' ? 'C:\\Music\\a.flac' : null;
  if (fixture) assert.equal(security.validateIpcArguments('music:verify-integrity', [[{ path: fixture, size: 1, mtimeMs: 1 }]]).ok, true);
  for (const hostile of [[], ['C:\\a.flac'], [[{ path: 'C:\\Music\\a.txt' }]], [[{ path: 'C:\\Music\\a.flac', extra: 1 }]], [[{ path: 'C:\\Music\\a.flac', size: -1 }]], [[], 1]]) {
    assert.equal(security.validateIpcArguments('music:verify-integrity', hostile).ok, false, JSON.stringify(hostile));
  }
  assert.ok(security.IPC_CONTRACTS['music:verify-integrity'] && security.IPC_CONTRACTS['app:set-text-scale']);

  // The settings markup, scripts and stylesheet are wired.
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  for (const id of ['textScaleSetting', 'contrastSetting', 'resetAccessibility', 'diagOutputMode', 'verifyLibraryFiles', 'copyIntegrityReport', 'integrityStatus']) assert.ok(html.includes(`id="${id}"`), `index.html is missing #${id}`);
  for (const asset of ['accessibility.css', 'accessibility.js', 'renderer-domains/accessibility-controller.js', 'renderer-domains/output-mode.js']) assert.ok(html.includes(asset), `index.html does not load ${asset}`);
  assert.ok(html.indexOf('accessibility.js') < html.indexOf('src="renderer.js"'));
  console.log('Accessibility and file-integrity checks passed.');
}
run().catch((error) => { console.error(error); process.exit(1); });
