'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

async function child() {
  const http = require('node:http');
  const { fetch } = require('undici');
  const server = http.createServer((request, response) => {
    if (request.url === '/normal') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
    } else {
      // GHSA-xjj6-f33q-929c: the rejected response used to leave an orphan
      // body stream whose later error crashed the process, beyond try/catch.
      response.writeHead(200, { 'Content-Encoding': 'gzip,gzip,gzip,gzip,gzip,gzip', 'Content-Length': '10' });
      response.end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const normal = await fetch(`${origin}/normal`);
    assert.deepEqual(await normal.json(), { ok: true });
    await assert.rejects(fetch(`${origin}/excessive-encodings`));
    await new Promise(resolve => setTimeout(resolve, 150));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
  console.log('PATCHED_FETCH_SURVIVED');
}

if (process.argv[2] === '--child') child().catch(error => { console.error(error); process.exitCode = 1; });
else {
  const main = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  assert.match(main, /const \{ fetch \} = require\('undici'\);/, 'App HTTP calls must use the patched module, not Electron\'s older embedded fetch.');
  const run = spawnSync(process.execPath, [__filename, '--child'],
    { timeout: 8000, maxBuffer: 1024 * 1024, windowsHide: true });
  assert.equal(run.status, 0, `Network response handling crashed or timed out: ${run.stderr}`);
  assert.ok(run.stdout.toString().includes('PATCHED_FETCH_SURVIVED'));
  console.log('Network fetch audit passed: JSON succeeds, hostile content encodings reject without a deferred process crash.');
}
