// Measures durable-state commit cost on the Electron main process for large
// generated libraries. Pure Node; no personal media or Electron required.
//
//   node scripts/bench-state-store.js [trackCounts...]   (default: 2000 10000)
//
// "main-thread stall" is the longest gap between 5 ms timer ticks while a
// commit runs: the time the main process could not route input or IPC.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PixelodyStateStore } = require('../src/state-store');
const { fixtureValues } = require('./perf-fixture');

async function measure(trackCount) {
  const values = fixtureValues(trackCount);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pixelody-bench-'));
  try {
    const store = new PixelodyStateStore({ directory });
    store.loadSync();
    await store.commit(values, { reason: 'bench-warm' });
    const commits = [];
    const stalls = [];
    for (let run = 0; run < 5; run += 1) {
      values['pixelody.session'] = { ...values['pixelody.session'], time: run * 5 };
      let last = performance.now();
      let longestGap = 0;
      const probe = setInterval(() => {
        const now = performance.now();
        longestGap = Math.max(longestGap, now - last);
        last = now;
      }, 5);
      const startedAt = performance.now();
      const result = await store.commit(values, { reason: 'bench', includeState: false });
      commits.push(performance.now() - startedAt);
      clearInterval(probe);
      stalls.push(Math.max(longestGap, performance.now() - last));
      if (!result.ok) throw new Error(result.error || result.status);
    }
    const loadStartedAt = performance.now();
    new PixelodyStateStore({ directory }).loadSync();
    const loadMs = performance.now() - loadStartedAt;
    const median = (samples) => samples.sort((left, right) => left - right)[Math.floor(samples.length / 2)];
    const megabytes = fs.statSync(store.paths.current).size / 1048576;
    console.log(`${String(trackCount).padStart(6)} tracks | file ${megabytes.toFixed(1).padStart(5)} MB | commit ${median(commits).toFixed(0).padStart(5)} ms | main-thread stall ${median(stalls).toFixed(0).padStart(5)} ms | startup load ${loadMs.toFixed(0).padStart(5)} ms`);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

(async () => {
  const counts = process.argv.slice(2).map(Number).filter((count) => Number.isInteger(count) && count > 0);
  for (const count of counts.length ? counts : [2000, 10000]) await measure(count);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
