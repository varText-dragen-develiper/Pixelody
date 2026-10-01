const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createPersonalServer } = require('../src/server');

async function openMedia(url, token) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers: { Authorization: `Bearer ${token}` } }, (res) => {
      res.on('error', () => {});
      res.pause();
      resolve({ req, res });
    });
    req.on('error', reject);
  });
}

async function assertAborted(res, label) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}: response stayed open`)), 2000);
    res.once('close', () => { clearTimeout(timer); resolve(); });
    res.resume();
  });
  assert.equal(res.complete, false, `${label}: unauthorized response delivered the entire file`);
}

async function delayedCommand(server, baseUrl, device, route) {
  const previousSeen = server.trustedDevices().devices.find((item) => item.id === device.device.id)?.lastSeenAt;
  await new Promise((resolve) => setTimeout(resolve, 5));
  const body = Buffer.from('{"action":"toggle"}');
  let request;
  const completed = new Promise((resolve, reject) => {
    request = http.request(`${baseUrl}${route}`, { method: 'POST', headers: {
      Authorization: `Bearer ${device.token}`, 'Content-Type': 'application/json', 'Content-Length': body.length
    } }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
    request.setTimeout(2000, () => request.destroy(new Error('Delayed command timed out')));
    request.write(body.subarray(0, 1));
  });
  const deadline = Date.now() + 1000;
  while (server.trustedDevices().devices.find((item) => item.id === device.device.id)?.lastSeenAt === previousSeen) {
    if (Date.now() >= deadline) { request.destroy(); throw new Error('Delayed command never authenticated'); }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return { finish: () => { request.end(body.subarray(1)); return completed; } };
}

async function auditCommandTeardown() {
  const commands = [];
  const server = createPersonalServer({ onRemoteCommand: (command) => commands.push(command) });
  try {
    const status = await server.start();
    for (const action of ['revoke', 'permission', 'remove-participant', 'stop-session', 'replace-session']) {
      server.startJamSession();
      const device = server.createTrustedDevice({ name: 'Delayed command fixture', permissions: ['browse', 'playback:control'] });
      const joined = await fetch(`${status.baseUrl}/api/v1/jam/session/join`, {
        method: 'POST', headers: { Authorization: `Bearer ${device.token}`, 'Content-Type': 'application/json' }, body: '{}'
      });
      assert.equal(joined.status, 202);
      await joined.arrayBuffer();
      server.approveJamParticipant(device.device.id, { permissions: ['view', 'controlPlayback'] });
      // Observe a new authentication time rather than relying on request timing.
      const freshDevice = server.createTrustedDevice({ name: 'Delayed command fixture', permissions: ['browse', 'playback:control'] });
      const isJam = action !== 'permission';
      // For J.A.M. requests the already joined device has a timestamp, so wait for its update.
      const target = isJam ? device : freshDevice;
      if (isJam) await new Promise((resolve) => setTimeout(resolve, 10));
      const before = commands.length;
      const pending = await delayedCommand(server, status.baseUrl, target,
        isJam ? '/api/v1/jam/session/playback' : '/api/v1/commands/playback');
      if (action === 'revoke') server.revokeTrustedDevice(target.device.id);
      else if (action === 'permission') server.updateTrustedDeviceAccess(target.device.id, { permissions: ['browse'] });
      else if (action === 'remove-participant') server.removeJamParticipant(target.device.id);
      else { server.stopJamSession(); if (action === 'replace-session') server.startJamSession(); }
      const afterMutation = commands.length;
      assert.ok(afterMutation >= before);
      assert.notEqual(await pending.finish(), 202, `${action}: delayed command accepted after authority ended`);
      assert.equal(commands.length, afterMutation, `${action}: stale command reached the playback bridge`);
      server.stopJamSession();
    }
    console.log('Server delayed command teardown audit passed: revocation, permission removal, participant removal, stop, and session replacement.');
  } finally { await server.stop(); }
}

async function auditServerTeardown() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixelody-teardown-'));
  const media = path.join(root, 'generated.wav');
  const server = createPersonalServer({ deviceStorePath: path.join(root, 'devices.json') });
  const clients = [];
  try {
    await fs.writeFile(media, Buffer.alloc(32 * 1024 * 1024));
    server.updateSnapshot({ tracks: [{ id: 'private-fixture', title: 'Generated teardown fixture', path: media, artworkPath: media, format: 'WAV' }] });
    const status = await server.start();
    const library = await fetch(`${status.baseUrl}/api/v1/library/snapshot`, { headers: { Authorization: `Bearer ${status.token}` } }).then((r) => r.json());
    const track = library.tracks[0];
    for (const action of ['revoke', 'delete', 'stream-permission', 'guest-profile', 'browse-permission']) {
      const device = server.createTrustedDevice({ name: 'Teardown fixture', permissions: ['browse', 'stream'], accessProfile: 'personal-device' });
      assert.equal(device.ok, true);
      const mediaUrl = `${status.baseUrl}${action === 'browse-permission' ? track.artworkUrl : track.streamUrl}`;
      const client = await openMedia(mediaUrl, device.token);
      clients.push(client);
      assert.equal(client.res.statusCode, 200);
      const mutation = action === 'revoke' ? server.revokeTrustedDevice(device.device.id)
        : action === 'delete' ? server.deleteTrustedDevice(device.device.id)
          : server.updateTrustedDeviceAccess(device.device.id, action === 'guest-profile' ? { accessProfile: 'jam-guest' }
            : { permissions: action === 'browse-permission' ? ['stream'] : ['browse'] });
      assert.equal(mutation.ok, true);
      await assertAborted(client.res, action);
      const rejected = await fetch(mediaUrl, { headers: { Authorization: `Bearer ${device.token}` } });
      assert.equal(rejected.status, ['revoke', 'delete'].includes(action) ? 401 : 403, `${action}: next request must fail`);
      const owner = await fetch(`${status.baseUrl}${track.streamUrl}`, { headers: { Authorization: `Bearer ${status.token}`, Range: 'bytes=0-1' } });
      assert.equal(owner.status, 206, `${action}: unrelated owner access must survive`);
      await owner.arrayBuffer();
    }
    console.log('Server media teardown audit passed: revoke, delete, permission removal, guest downgrade, artwork, and owner isolation.');
  } finally {
    for (const client of clients) { client.req.destroy(); client.res.destroy(); }
    await server.stop();
    const relative = path.relative(os.tmpdir(), root);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(root).startsWith('pixelody-teardown-'));
    await fs.rm(root, { recursive: true, force: true });
  }
}

module.exports = { auditServerTeardown, auditCommandTeardown };
if (require.main === module) Promise.resolve().then(auditServerTeardown).then(auditCommandTeardown).catch((error) => { console.error(error); process.exitCode = 1; });
