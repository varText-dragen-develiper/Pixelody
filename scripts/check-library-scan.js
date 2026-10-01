const assert = require('assert/strict');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { scanAudioFolder } = require('../src/library-scan');

const extensions = new Set(['.flac', '.mp3']);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pixelody-library-scan-'));

function touch(relativePath) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, '');
  return target;
}

// Running as an administrator/root ignores permission bits, so unreadable
// folders are simulated at the readdir boundary rather than with chmod.
function readdirFailingFor(...blocked) {
  const blockedSet = new Set(blocked.map((item) => path.resolve(item)));
  return (directory, options) => {
    if (blockedSet.has(path.resolve(directory))) {
      const error = new Error(`EPERM: operation not permitted, scandir '${directory}'`);
      error.code = 'EPERM';
      return Promise.reject(error);
    }
    return fsp.readdir(directory, options);
  };
}

(async () => {
  try {
    const before = touch('a-before/one.flac');
    touch('b-protected/hidden.flac');
    const after = touch('c-after/nested/two.MP3');
    touch('c-after/cover.jpg');

    const clean = await scanAudioFolder(root, { extensions, maxFiles: 100 });
    assert.equal(clean.skippedFolders, 0);
    assert.equal(clean.paths.length, 3, 'a readable tree returns every supported file, matching extensions case-insensitively');

    const partial = await scanAudioFolder(root, { extensions, maxFiles: 100, readdir: readdirFailingFor(path.join(root, 'b-protected')) });
    assert.equal(partial.skippedFolders, 1, 'an unreadable subfolder is counted');
    assert.deepEqual(partial.paths.sort(), [before, after].sort(), 'files before and after an unreadable subfolder are still imported');

    const rootDenied = await scanAudioFolder(root, { extensions, maxFiles: 100, readdir: readdirFailingFor(root) });
    assert.deepEqual(rootDenied, { paths: [], skippedFolders: 1 }, 'an unreadable chosen folder resolves with a count instead of rejecting');

    const capped = await scanAudioFolder(root, { extensions, maxFiles: 1 });
    assert.equal(capped.paths.length, 1, 'the import file cap still applies');

    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
    assert.match(mainSource, /scanAudioFolder\(result\.filePaths\[0\]/, 'the folder dialog must use the resilient scanner');
    const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
    assert.match(preloadSource, /skippedFolders: Number\(result\?\.skippedFolders\) \|\| 0/, 'the preload must forward the skipped-folder count');
    const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
    assert.equal((rendererSource.match(/window\.desktop\.chooseFolder\(\)/g) || []).length, 1, 'every folder import must go through importFolderScan');
    assert.match(rendererSource, /async function importFolderScan\(\) \{[\s\S]*?catch \{[\s\S]*?showToast\(/, 'a failed folder scan must be reported to the user');

    console.log('Library scan audit passed: unreadable folders are skipped and reported, the rest of the scan is kept, and failures surface to the user.');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
