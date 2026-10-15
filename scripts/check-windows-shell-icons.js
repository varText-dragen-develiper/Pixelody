'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createWindowsShellIconRefresher } = require('../src/windows-shell-icons');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pixelody-shell-icons-test-'));
const paths = { userData: path.join(root, 'profile-caf\u00e9'), desktop: path.join(root, 'Desktop'), appData: path.join(root, 'AppData') };
const app = { getPath: key => paths[key] };
const ownShortcut = path.join(paths.desktop, 'Pixelody caf\u00e9.lnk');
const workerSource = fs.readFileSync(path.join(__dirname, '../src/windows-shell-icons.ps1'));
const helperHash = crypto.createHash('sha256').update(workerSource).digest('hex').slice(0, 20);
const helpers = [];

function fakeWorkers(behaviors = []) {
  const launches = [];
  function spawn(executable, args, options) {
    const child = new EventEmitter();
    Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), requests: [], killed: false });
    const launch = { child, executable, args, options };
    launches.push(launch);
    child.kill = () => { child.killed = true; queueMicrotask(() => child.emit('exit', null, 'SIGTERM')); return true; };
    let input = '';
    child.stdin.setEncoding('utf8');
    child.stdin.on('data', chunk => {
      input += chunk;
      let newline;
      while ((newline = input.indexOf('\n')) !== -1) {
        const request = JSON.parse(input.slice(0, newline));
        input = input.slice(newline + 1);
        child.requests.push(request);
        queueMicrotask(() => {
          if (child.killed) return;
          const behavior = behaviors[launches.indexOf(launch)];
          if (behavior) behavior(child, request);
          else child.stdout.write(`${JSON.stringify({ id: request.id, ok: true, refreshedShortcuts: request.shortcuts.length })}\n`);
        });
      }
    });
    return child;
  }
  return { spawn, launches };
}

function refresher(options) {
  const helper = createWindowsShellIconRefresher({ platform: 'win32', ...options });
  helpers.push(helper);
  return helper;
}

async function main() {
  const normal = fakeWorkers();
  const helper = refresher({ spawn: normal.spawn });
  const first = await helper.refresh({ app, shortcuts: [ownShortcut, ownShortcut] });
  assert.equal(first.refreshedShortcuts, 1, 'Duplicate paths must be notified once.');
  await helper.refresh({ app, shortcuts: [] });
  await helper.refresh({ app, shortcuts: [], animationFrame: true });
  await helper.refresh({ app, shortcuts: [ownShortcut], notifyAssociations: false });
  assert.equal(normal.launches.length, 1, 'Appearance changes reuse one persistent worker.');
  const launch = normal.launches[0];
  assert.equal(launch.options.windowsHide, true);
  assert.equal(launch.options.shell, false);
  assert.deepEqual(launch.options.stdio, ['pipe', 'pipe', 'pipe']);
  assert.deepEqual(launch.child.requests.map(request => request.id), [1, 2, 3, 4]);
  assert.equal(launch.child.requests[0].animationFrame, false, 'Final color delivery stays synchronous.');
  assert.equal(launch.child.requests[2].animationFrame, true, 'Only intermediate frames request non-blocking delivery.');
  assert.equal(launch.child.requests[0].notifyAssociations, true, 'The established full refresh stays the default.');
  assert.equal(launch.child.requests[3].notifyAssociations, false, 'Live-window settlement can notify only matching shortcuts.');
  await assert.rejects(helper.refresh({ app, shortcuts: [], animationFrame: 'yes' }), /notification mode/);
  await assert.rejects(helper.refresh({ app, shortcuts: [], notifyAssociations: 'no' }), /notification mode/);
  assert.equal(launch.child.requests[0].shortcuts[0], ownShortcut, 'UTF-8 shortcut names survive the protocol.');
  const staged = launch.args[launch.args.indexOf('-File') + 1];
  assert.equal(staged, path.join(paths.userData, 'brand-icons', `windows-shell-icons-${helperHash}.ps1`));
  assert.ok(fs.readFileSync(staged).equals(workerSource), 'Execute the exact bundled helper outside ASAR.');
  assert.equal(launch.args[launch.args.indexOf('-DesktopRoot') + 1], paths.desktop);
  await assert.rejects(helper.refresh({ app, shortcuts: [path.join(root, 'foreign.lnk')] }), /outside allowed/);
  await assert.rejects(helper.refresh({ app, shortcuts: [path.join(paths.desktop, '..', 'foreign.lnk')] }), /outside allowed/);
  await assert.rejects(helper.refresh({ app, shortcuts: [path.join(paths.desktop, 'application.exe')] }), /end in .lnk/);
  await assert.rejects(helper.refresh({ app, shortcuts: Array(65).fill(ownShortcut) }), /shortcut list/);
  assert.equal(normal.launches.length, 1, 'Invalid requests must not launch or restart a worker.');
  helper.shutdown();
  assert.equal(launch.child.killed, true);
  await assert.rejects(helper.refresh({ app, shortcuts: [] }), /shut down/);

  const timeout = fakeWorkers([() => {}]);
  const timeoutHelper = refresher({ spawn: timeout.spawn, timeoutMs: 20 });
  assert.equal((await timeoutHelper.refresh({ app, shortcuts: [ownShortcut] })).ok, true);
  assert.equal(timeout.launches.length, 2, 'A hung worker gets one fresh attempt.');
  assert.equal(timeout.launches[0].child.killed, true);

  const malformed = fakeWorkers([child => child.stdout.write('invalid JSON\n')]);
  assert.equal((await refresher({ spawn: malformed.spawn }).refresh({ app, shortcuts: [] })).ok, true);
  assert.equal(malformed.launches.length, 2);
  assert.equal(malformed.launches[0].child.killed, true);

  const wrongCount = fakeWorkers([ (child, request) => child.stdout.write(`${JSON.stringify({ id: request.id, ok: true, refreshedShortcuts: 0 })}\n`) ]);
  assert.equal((await refresher({ spawn: wrongCount.spawn }).refresh({ app, shortcuts: [ownShortcut] })).refreshedShortcuts, 1);
  assert.equal(wrongCount.launches.length, 2, 'A false successful shortcut count must restart the broken worker.');
  assert.equal(wrongCount.launches[0].child.killed, true);

  const fatal = fakeWorkers([child => child.stdout.write('{"id":null,"ok":false,"error":"compile failed"}\n')]);
  assert.equal((await refresher({ spawn: fatal.spawn }).refresh({ app, shortcuts: [] })).ok, true);
  assert.equal(fatal.launches.length, 2);

  const exited = fakeWorkers([child => child.emit('exit', 1, null), child => child.emit('exit', 1, null)]);
  await assert.rejects(refresher({ spawn: exited.spawn }).refresh({ app, shortcuts: [] }), /worker exited/);
  assert.equal(exited.launches.length, 2, 'Broken workers must not restart without a bound.');

  const rejected = fakeWorkers([ (child, request) => child.stdout.write(`${JSON.stringify({ id: request.id, ok: false, error: 'native rejection' })}\n`) ]);
  await assert.rejects(refresher({ spawn: rejected.spawn }).refresh({ app, shortcuts: [] }), /native rejection/);
  assert.equal(rejected.launches.length, 1, 'Application rejections are not transport retries.');

  const pending = fakeWorkers([() => {}]);
  const pendingHelper = refresher({ spawn: pending.spawn });
  const awaiting = pendingHelper.refresh({ app, shortcuts: [] });
  pendingHelper.shutdown();
  await assert.rejects(awaiting, /shut down/);
  assert.equal(pending.launches.length, 1, 'Shutdown cancels pending work without restarting.');

  fs.writeFileSync(staged, 'stale helper');
  const repaired = fakeWorkers();
  await refresher({ spawn: repaired.spawn }).refresh({ app, shortcuts: [] });
  assert.ok(fs.readFileSync(staged).equals(workerSource), 'A corrupted staged helper is restored from the bundled source.');

  const noWindows = fakeWorkers();
  assert.equal((await refresher({ platform: 'linux', spawn: noWindows.spawn }).refresh({ app, shortcuts: [] })).skipped, true);
  assert.equal(noWindows.launches.length, 0);
  console.log('Windows Shell icon worker: persistent UTF-8 protocol, path boundaries, exact staged helper, bounded restart, timeout, and shutdown passed.');
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  for (const helper of helpers) helper.shutdown();
  const resolved = path.resolve(root);
  if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('pixelody-shell-icons-test-')) throw new Error('Unsafe test cleanup path.');
  fs.rmSync(resolved, { recursive: true, force: true });
});
