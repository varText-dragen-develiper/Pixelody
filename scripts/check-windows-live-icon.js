'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createWindowsLiveIconController } = require('../src/windows-live-icon');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pixelody-live-icon-test-'));
const helpers = [];
function fakeSpawn(reply = (child, request) => child.stdout.write(JSON.stringify({ id: request.id, ok: true }) + '\n')) {
  const launches = [];
  const spawn = (exe, args, options) => {
    const child = new EventEmitter();
    Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), requests: [] });
    launches.push({ exe, args, options, child });
    let input = '';
    child.stdin.setEncoding('utf8'); child.stdin.on('data', data => {
      input += data; let end;
      while ((end = input.indexOf('\n')) >= 0) { const request = JSON.parse(input.slice(0, end)); input = input.slice(end + 1); child.requests.push(request); queueMicrotask(() => reply(child, request)); }
    });
    return child;
  };
  return { spawn, launches };
}
function controller(options) {
  const helper = createWindowsLiveIconController({ app: { getPath: () => root }, appId: 'io.pixelody.desktop.preview.4961681c20ee', platform: 'win32', ...options });
  helpers.push(helper); return helper;
}
(async () => {
  const fake = fakeSpawn(), helper = controller({ spawn: fake.spawn });
  const handle = Buffer.alloc(8); handle.writeBigUInt64LE(1234n);
  const win = { isDestroyed: () => false, getNativeWindowHandle: () => handle };
  await helper.prepare(); await helper.begin([win, { isDestroyed: () => true }]); await helper.rollback(); await helper.begin([win]); await helper.commit();
  assert.equal(fake.launches.length, 1, 'Transitions reuse one hidden worker.');
  const launch = fake.launches[0];
  assert.equal(launch.options.windowsHide, true); assert.equal(launch.options.shell, false);
  assert.equal(launch.args[launch.args.indexOf('-TaskProcessId') + 1], String(process.pid), 'Native ownership is bound to the app process.');
  assert.deepEqual(launch.child.requests.map(r => r.action), ['prepare', 'begin', 'rollback', 'begin', 'commit']);
  assert.deepEqual(launch.child.requests[1].handles, ['4d2']);
  const file = launch.args[launch.args.indexOf('-File') + 1];
  assert.ok(fs.readFileSync(file).equals(fs.readFileSync(path.join(__dirname, '../src/windows-live-icon.ps1'))));
  await assert.rejects(helper.begin([win, win, win]), /operation/);
  await assert.rejects(helper.begin([{ isDestroyed: () => false, getNativeWindowHandle: () => '1234' }]), /handle/);
  assert.equal(launch.child.requests.length, 5, 'Malformed handles never reach native code.');
  helper.shutdown(); await assert.rejects(helper.prepare(), /stopped/);
  const broken = fakeSpawn(child => child.stdout.write('malformed\n'));
  const failure = controller({ spawn: broken.spawn });
  await assert.rejects(failure.begin([win]), /response/); await assert.rejects(failure.prepare(), /stopped/);
  assert.equal(broken.launches.length, 1, 'Never restart a worker holding original properties.');
  const hanging = fakeSpawn(() => {}), timed = controller({ spawn: hanging.spawn, timeoutMs: 10 });
  await assert.rejects(timed.prepare(), /timed out/); await assert.rejects(timed.prepare(), /stopped/);
  const rejected = controller({ spawn: fakeSpawn((child, r) => child.stdout.write(JSON.stringify({ id: r.id, ok: false, error: 'Foreign window rejected' }) + '\n')).spawn });
  await assert.rejects(rejected.begin([win]), /Foreign window/);
  assert.equal((await controller({ platform: 'linux' }).prepare()).skipped, true);
  console.log('Windows live icon bridge passed: private handles, process authority, hidden persistent worker, commit/rollback, protocol errors and timeout.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  for (const helper of helpers) helper.shutdown();
  if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('pixelody-live-icon-test-')) throw new Error('Unsafe test cleanup');
  fs.rmSync(root, { recursive: true, force: true });
});
