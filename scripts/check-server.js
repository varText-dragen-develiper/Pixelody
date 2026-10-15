const fs = require('fs/promises');
require('./check-pairing-qr');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { createPersonalServer } = require('../src/server');
const { auditServerTeardown, auditCommandTeardown } = require('./check-server-teardown');

async function readFixture(name) {
  const fixturePath = path.join(__dirname, '..', 'docs', 'api-contract-fixtures', name);
  return JSON.parse(await fs.readFile(fixturePath, 'utf8'));
}

function assertKeys(object, keys, label) {
  for (const key of keys) {
    if (!(key in object)) throw new Error(`${label} fixture is missing key: ${key}`);
  }
}

function jsonBody(response) {
  return JSON.parse(response.body.toString('utf8'));
}

function assertHttpError(response, statusCode, code, label) {
  const body = jsonBody(response);
  if (response.statusCode !== statusCode || body.code !== code) {
    throw new Error(`${label} returned ${response.statusCode}/${body.code || 'no-code'} instead of ${statusCode}/${code}`);
  }
  return body;
}

function request(targetUrl, token = '', options = {}) {
  return new Promise((resolve, reject) => {
    const method = options.method || 'GET';
    const headers = { ...(options.headers || {}) };
    let body = null;
    if (options.body !== undefined) {
      body = Buffer.from(JSON.stringify(options.body), 'utf8');
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      headers['Content-Length'] = String(body.length);
    }
    if (token) headers.Authorization = `Bearer ${token}`;
    const req = http.request(targetUrl, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (options.timeoutMs) {
      req.setTimeout(options.timeoutMs, () => {
        const error = new Error(`Request timed out after ${options.timeoutMs} ms`);
        error.code = 'ETIMEDOUT';
        req.destroy(error);
      });
    }
    if (body) req.write(body);
    req.end();
  });
}

function openPausedRequest(targetUrl, token = '') {
  return new Promise((resolve, reject) => {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const req = http.request(targetUrl, { headers }, (res) => {
      res.on('error', () => {});
      res.pause();
      resolve({ req, res });
    });
    req.on('error', (error) => reject(error));
    req.end();
  });
}

function openStalledSocket(baseUrl) {
  const target = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: target.hostname, port: Number(target.port) });
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

async function expectRequestFailure(targetUrl, label) {
  try {
    await request(targetUrl, '', { timeoutMs: 750 });
  } catch (error) {
    if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(error.code)) return;
    throw error;
  }
  throw new Error(`${label} unexpectedly accepted a request`);
}

async function readTextWhenReady(filePath, attempts = 20) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fs.readFile(filePath, 'utf8');
    } catch (error) {
      if (attempt === attempts - 1 || error.code !== 'ENOENT') throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  return '';
}

async function auditDefaultAndEmptyServer(tempDir) {
  const emptyServer = createPersonalServer({
    appVersion: 'test',
    platform: 'test',
    identityStorePath: path.join(tempDir, 'empty-host-identity.json'),
    deviceStorePath: path.join(tempDir, 'empty-trusted-devices.json'),
  });
  let baseUrl = '';
  try {
    const freshStatus = emptyServer.status();
    if (freshStatus.enabled || freshStatus.token || freshStatus.baseUrl) throw new Error('fresh server was not off by default');
    const started = await emptyServer.start();
    baseUrl = started.baseUrl;
    if (!started.networkDiagnostics?.listening || started.networkDiagnostics?.riskLevel !== 'local-only') {
      throw new Error('localhost network diagnostics were not reported for an empty host');
    }
    const selfTest = await emptyServer.selfTest();
    if (!selfTest.selfTest?.ok || selfTest.selfTest.tracks !== 0) throw new Error('empty-library self-test did not pass with zero tracks');
    const stopped = await emptyServer.stop();
    if (stopped.enabled || stopped.token || stopped.baseUrl) throw new Error('stopped empty host still advertised connection details');
    if (baseUrl) await expectRequestFailure(`${baseUrl}/api/v1/health`, 'stopped empty host');
  } finally {
    await emptyServer.stop().catch(() => {});
  }
}

async function auditCredentialSafety(tempDir) {
  const failingStoreServer = createPersonalServer({
    identityStorePath: path.join(tempDir, 'failing-store-identity.json'),
    deviceStorePath: tempDir,
  });
  const failedDevice = failingStoreServer.createTrustedDevice({ name: 'Must not escape', permissions: ['browse'] });
  if (failedDevice.ok || failedDevice.token || failedDevice.code !== 'device_store_write_failed') {
    throw new Error('device-store failure returned an apparently durable credential');
  }
  if (failingStoreServer.trustedDevices().devices.length) throw new Error('failed device-store mutation was not rolled back');

  const profileStorePath = path.join(tempDir, 'profile-migration-devices.json');
  await fs.writeFile(profileStorePath, JSON.stringify({
    version: 1,
    devices: [
      { id: 'invalid-profile', name: 'Invalid profile', tokenHash: 'a'.repeat(64), permissions: ['browse', 'stream'], accessProfile: 'unexpected-profile' },
      { id: 'legacy-jam-invite', name: 'Legacy J.A.M. invite', tokenHash: 'b'.repeat(64), permissions: ['browse', 'stream'], pairingMethod: 'jam-quick-copy' },
      { id: 'legacy-personal', name: 'Legacy personal device', tokenHash: 'c'.repeat(64), permissions: ['browse', 'stream'], pairingMethod: 'manual' },
    ],
  }), 'utf8');
  const profileMigrationServer = createPersonalServer({
    identityStorePath: path.join(tempDir, 'profile-migration-identity.json'),
    deviceStorePath: profileStorePath,
  });
  const migratedProfiles = profileMigrationServer.trustedDevices().devices;
  for (const deviceId of ['invalid-profile', 'legacy-jam-invite']) {
    const device = migratedProfiles.find((item) => item.id === deviceId);
    if (device?.accessProfile !== 'jam-guest' || device.permissions.includes('stream') || device.originalStreamAccess) {
      throw new Error(`stored ${deviceId} did not migrate to fail-closed guest access`);
    }
  }
  const legacyPersonal = migratedProfiles.find((item) => item.id === 'legacy-personal');
  if (legacyPersonal?.accessProfile !== 'personal-device' || !legacyPersonal.originalStreamAccess) {
    throw new Error('legacy personal trusted device compatibility was not preserved');
  }

  const abuseServer = createPersonalServer({
    identityStorePath: path.join(tempDir, 'abuse-host-identity.json'),
    deviceStorePath: path.join(tempDir, 'abuse-trusted-devices.json'),
    maxPendingPairings: 2,
    pairingAttemptLimit: 2,
    commandRateLimit: 2,
  });
  try {
    const status = await abuseServer.start();
    for (let index = 0; index < 2; index += 1) {
      const pairing = await request(`${status.baseUrl}/api/v1/pair/start`, status.token, { method: 'POST', body: { deviceName: `Bound ${index}` } });
      if (pairing.statusCode !== 200) throw new Error('bounded pairing setup failed');
    }
    const capacity = await request(`${status.baseUrl}/api/v1/pair/start`, status.token, { method: 'POST', body: { deviceName: 'Too many' } });
    assertHttpError(capacity, 429, 'pairing_capacity', 'pending pairing capacity');

    for (let index = 0; index < 2; index += 1) {
      const attempt = await request(`${status.baseUrl}/api/v1/pair/complete`, '', { method: 'POST', body: { pairingCode: '000000', secret: 'wrong' } });
      assertHttpError(attempt, 400, 'pairing_not_found', 'invalid pairing attempt');
    }
    const rateLimitedPairing = await request(`${status.baseUrl}/api/v1/pair/complete`, '', { method: 'POST', body: { pairingCode: '000000', secret: 'wrong' } });
    assertHttpError(rateLimitedPairing, 429, 'pairing_rate_limited', 'pairing attempt throttle');

    for (let index = 0; index < 2; index += 1) {
      const command = await request(`${status.baseUrl}/api/v1/commands/playback`, status.token, { method: 'POST', body: { action: 'next' } });
      if (command.statusCode !== 202) throw new Error('command throttle setup failed');
    }
    const rateLimitedCommand = await request(`${status.baseUrl}/api/v1/commands/playback`, status.token, { method: 'POST', body: { action: 'next' } });
    assertHttpError(rateLimitedCommand, 429, 'command_rate_limited', 'remote command throttle');
  } finally {
    await abuseServer.stop();
  }
}

async function auditRevisionContract(tempDir) {
  const server = createPersonalServer({
    identityStorePath: path.join(tempDir, 'revision-host-identity.json'),
    deviceStorePath: path.join(tempDir, 'revision-trusted-devices.json'),
  });
  const startedAt = new Date(Date.now() - 10_000).toISOString();
  const base = {
    hostName: 'Revision Host',
    tracks: [{ id: 'revision-track', title: 'Revision Track', artist: 'Pixelody', format: 'MP3', path: path.join(tempDir, 'revision.mp3'), duration: 120 }],
    playlists: [{ id: 'all', name: 'All Music', trackIds: ['revision-track'] }],
    favorites: [],
    queue: ['revision-track'],
    playback: {
      currentTrackId: 'revision-track', playing: true, currentTime: 10, duration: 120,
      positionUpdatedAt: new Date().toISOString(), estimatedStartedAt: startedAt,
    },
  };
  server.updateSnapshot(base);
  try {
    const status = await server.start();
    const firstLive = jsonBody(await request(`${status.baseUrl}/api/v1/live`, status.token));
    if (firstLive.revision <= 0 || firstLive.revisions?.library !== firstLive.revision || firstLive.revisions?.playback !== firstLive.revision) {
      throw new Error('initial snapshot did not establish domain revisions');
    }
    if (firstLive.playback.currentTime < 9.5 || firstLive.playback.currentTime > 12) throw new Error('live playback position did not project from its timing anchor');
    if (Math.abs(Date.now() - Date.parse(firstLive.playback.positionUpdatedAt)) > 2000) throw new Error('live playback anchor was not current');

    const stableRevision = firstLive.revision;
    server.updateSnapshot({ ...base, generatedAt: new Date().toISOString(), playback: { ...base.playback, currentTime: 10.1, positionUpdatedAt: new Date().toISOString() } });
    if (server.status().revision !== stableRevision) throw new Error('equivalent renderer export changed the overall revision');
    const unchangedLive = jsonBody(await request(`${status.baseUrl}/api/v1/live?sinceRevision=${stableRevision}`, status.token));
    if (!unchangedLive.unchanged || unchangedLive.playback || unchangedLive.revision !== stableRevision) throw new Error('conditional live poll returned an unchanged full payload');
    const unchangedLibrary = jsonBody(await request(`${status.baseUrl}/api/v1/library/snapshot?sinceRevision=${stableRevision}`, status.token));
    if (!unchangedLibrary.unchanged || unchangedLibrary.tracks) throw new Error('conditional library refresh returned an unchanged full snapshot');

    server.updateSnapshot({ ...base, queue: [] });
    const queueStatus = server.status();
    if (queueStatus.revisions.queue !== queueStatus.revision || queueStatus.revisions.library !== stableRevision) throw new Error('queue change did not update only its domain revision');
    server.updateSnapshot({ ...base, queue: [], favorites: ['revision-track'] });
    const favoriteStatus = server.status();
    if (favoriteStatus.revisions.favorites !== favoriteStatus.revision) throw new Error('favorite change did not update its domain revision');
    server.updateSnapshot({ ...base, queue: [], favorites: ['revision-track'], playback: { ...base.playback, currentTime: 40, positionUpdatedAt: new Date().toISOString(), estimatedStartedAt: new Date(Date.now() - 40_000).toISOString() } });
    const playbackStatus = server.status();
    if (playbackStatus.revisions.playback !== playbackStatus.revision) throw new Error('seek did not update the playback revision');
    server.updateSnapshot({ ...base, queue: [], favorites: ['revision-track'], tracks: [{ ...base.tracks[0], title: 'Revision Track Updated' }], playback: { ...base.playback, currentTime: 40, positionUpdatedAt: new Date().toISOString(), estimatedStartedAt: new Date(Date.now() - 40_000).toISOString() } });
    const libraryStatus = server.status();
    if (libraryStatus.revisions.library !== libraryStatus.revision) throw new Error('library edit did not update the library revision');
    const permissionDevice = server.createTrustedDevice({ name: 'Revision permission device', permissions: ['browse'] });
    const permissionStatus = server.status();
    if (!permissionDevice.ok || permissionStatus.revisions.permissions !== permissionStatus.revision) throw new Error('permission change did not update the permission revision');

    const metadataOnly = jsonBody(await request(`${status.baseUrl}/api/v1/library/snapshot?includeTracks=false`, status.token));
    if (!metadataOnly.tracksOmitted || metadataOnly.tracks.length) throw new Error('metadata-only snapshot included the full track array');
    const page = jsonBody(await request(`${status.baseUrl}/api/v1/library/tracks?offset=0&limit=1&q=updated`, status.token));
    if (page.page?.total !== 1 || page.tracks?.length !== 1 || page.revision !== permissionStatus.revision) throw new Error('revisioned filtered track page failed');
  } finally {
    await server.stop();
  }
}

(async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pixelody-server-'));
  const mediaPath = path.join(tempDir, 'tone.mp3');
  const flacMediaPath = path.join(tempDir, 'tone.flac');
  const wavMediaPath = path.join(tempDir, 'tone.wav');
  const largeMediaPath = path.join(tempDir, 'large-tone.mp3');
  const missingMediaPath = path.join(tempDir, 'missing.flac');
  const missingArtworkPath = path.join(tempDir, 'missing-cover.jpg');
  const identityStorePath = path.join(tempDir, 'host-identity.json');
  const deviceStorePath = path.join(tempDir, 'trusted-devices.json');
  const privateTrackId = `C:\\Music\\Pixelody\\tone.mp3`;
  const flacPrivateTrackId = `C:\\Music\\Pixelody\\tone.flac`;
  const wavPrivateTrackId = `C:\\Music\\Pixelody\\tone.wav`;
  const largePrivateTrackId = `C:\\Music\\Pixelody\\large-tone.mp3`;
  const missingTrackId = `C:\\Music\\Pixelody\\missing.flac`;
  const remoteCommands = [];
  await fs.writeFile(mediaPath, Buffer.from('0123456789abcdef', 'utf8'));
  await fs.writeFile(flacMediaPath, Buffer.from('fLaC0123456789ab', 'utf8'));
  await fs.writeFile(wavMediaPath, Buffer.from('RIFF0123456789ab', 'utf8'));
  await fs.writeFile(largeMediaPath, Buffer.alloc(8 * 1024 * 1024, 0x61));
  const capabilityFixture = await readFixture('host-capabilities.json');
  const snapshotFixture = await readFixture('library-snapshot.json');
  const liveFixture = await readFixture('live-state.json');
  const unchangedLiveFixture = await readFixture('live-unchanged.json');
  const tracksPageFixture = await readFixture('library-tracks-page.json');
  const pairingFixture = await readFixture('pairing-payload.json');
  const jamQueueFixture = await readFixture('jam-queue-item.json');
  const jamSessionFixture = await readFixture('jam-session-v1.json');
  assertKeys(capabilityFixture, ['hostId', 'roles', 'auth', 'live', 'commands', 'jam', 'limits'], 'host capabilities');
  if (!capabilityFixture.canJamCoordinate || !capabilityFixture.roles.includes('jamCoordinator') || !capabilityFixture.jam?.singleHostV1 || capabilityFixture.jam?.federatedSources) {
    throw new Error('host capability fixture did not advertise the bounded single-host J.A.M. contract honestly');
  }
  assertKeys(snapshotFixture.tracks[0], ['id', 'title', 'artist', 'format', 'artworkUrl', 'streamUrl', 'favorite', 'missing'], 'track');
  assertKeys(liveFixture, ['revision', 'auth', 'playback', 'queue', 'favorites'], 'live state');
  assertKeys(liveFixture.revisions, ['overall', 'library', 'playback', 'queue', 'favorites', 'permissions', 'deviceRefresh', 'jam'], 'sync revisions');
  if (!unchangedLiveFixture.unchanged || unchangedLiveFixture.playback) throw new Error('unchanged live fixture was not minimal');
  if (tracksPageFixture.page?.nextOffset !== 1 || tracksPageFixture.tracks?.length !== 1) throw new Error('paged track fixture was invalid');
  if (liveFixture.networkSession?.host?.roles?.includes('jamCoordinator')) {
    throw new Error('live state fixture claimed unfinished J.A.M. coordination behavior');
  }
  assertKeys(pairingFixture, ['type', 'baseUrls', 'pairingCode', 'secret', 'permissions'], 'pairing');
  assertKeys(jamQueueFixture, ['queueItemId', 'trackId', 'addedByDeviceId', 'sourceDeviceId', 'sourceLibraryId', 'availability', 'cacheState'], 'J.A.M. queue item');
  assertKeys(jamSessionFixture, ['sessionId', 'mode', 'roles', 'permissions', 'participants', 'queue', 'diagnostics'], 'J.A.M. session V1');
  if (jamSessionFixture.mode !== 'single-host' || jamSessionFixture.permissions?.federatedSourcesEnabled !== false) {
    throw new Error('J.A.M. V1 fixture must remain single-host until federated source support is implemented.');
  }
  await auditDefaultAndEmptyServer(tempDir);
  await auditCredentialSafety(tempDir);
  await auditRevisionContract(tempDir);
  await auditServerTeardown();
  await auditCommandTeardown();
  const server = createPersonalServer({
    appVersion: 'test',
    platform: 'test',
    identityStorePath,
    deviceStorePath,
    onRemoteCommand: (command) => remoteCommands.push(command),
  });
  const playbackStartedAt = new Date(Date.now() - 5000).toISOString();
  const hostSnapshot = {
    hostName: 'Pixelody Test Host',
    tracks: [{
      id: privateTrackId,
      title: 'Server Test',
      artist: 'Pixelody',
      format: 'MP3',
      path: mediaPath,
      artworkPath: missingArtworkPath,
      duration: 1,
    }, {
      id: flacPrivateTrackId,
      title: 'FLAC Range Test',
      artist: 'Pixelody',
      format: 'FLAC',
      path: flacMediaPath,
      duration: 1,
    }, {
      id: wavPrivateTrackId,
      title: 'WAV Range Test',
      artist: 'Pixelody',
      format: 'WAV',
      path: wavMediaPath,
      duration: 1,
    }, {
      id: largePrivateTrackId,
      title: 'Large Stream Test',
      artist: 'Pixelody',
      format: 'MP3',
      path: largeMediaPath,
      duration: 600,
    }, {
      id: missingTrackId,
      title: 'Missing Server Test',
      artist: 'Pixelody',
      format: 'FLAC',
      path: missingMediaPath,
      duration: 1,
    }],
    playlists: [{ id: 'all', name: 'All Music', trackIds: [privateTrackId] }],
    queue: [privateTrackId],
    playback: {
      currentTrackId: privateTrackId,
      playing: true,
      currentTime: 5,
      duration: 60,
      positionUpdatedAt: new Date().toISOString(),
      estimatedStartedAt: playbackStartedAt,
    },
  };
  server.updateSnapshot(hostSnapshot);
  let recreatedServer = null;
  try {
    const status = await server.start();
    const storedIdentity = JSON.parse(await fs.readFile(identityStorePath, 'utf8'));
    if (!status.hostId || storedIdentity.hostId !== status.hostId) throw new Error('stable host identity was not persisted');
    if ((await fs.readFile(identityStorePath, 'utf8')).includes(status.token)) throw new Error('host identity store leaked the owner token');
    if (!status.networkDiagnostics?.listening || !status.networkDiagnostics?.addressCandidates?.length) {
      throw new Error('server status did not include usable network diagnostics');
    }
    if (status.networkDiagnostics.riskLevel !== 'local-only') throw new Error('localhost server did not report local-only network risk');
    const health = await request(`${status.baseUrl}/api/v1/health`);
    if (health.statusCode !== 200) throw new Error(`health returned ${health.statusCode}`);
    const capabilityResponse = await request(`${status.baseUrl}/api/v1/host/capabilities`, status.token);
    const capabilityBody = JSON.parse(capabilityResponse.body.toString('utf8'));
    if (!capabilityBody.canJamCoordinate || !capabilityBody.roles?.includes('jamCoordinator') || !capabilityBody.jam?.singleHostV1 || capabilityBody.jam?.federatedSources) {
      throw new Error('runtime capabilities did not advertise the bounded single-host J.A.M. contract honestly');
    }
    if (!capabilityBody.auth?.permissionEditing || !capabilityBody.auth?.accessProfiles || capabilityBody.auth?.jamGuestOriginalStreams !== false) {
      throw new Error('runtime capabilities did not advertise the fail-closed trusted-device access-profile boundary');
    }
    const unauthorized = await request(`${status.baseUrl}/api/v1/library/snapshot`);
    assertHttpError(unauthorized, 401, 'auth_required', 'missing credential');
    const invalidCredential = await request(`${status.baseUrl}/api/v1/library/snapshot`, 'pxd_not-a-real-token');
    assertHttpError(invalidCredential, 401, 'auth_invalid', 'invalid credential');
    const trustedDevice = server.createTrustedDevice({ name: 'Audit phone', permissions: ['browse', 'stream'] });
    if (!trustedDevice.ok || !trustedDevice.token) throw new Error('trusted device token was not created');
    const storedDevices = await readTextWhenReady(deviceStorePath);
    if (storedDevices.includes(trustedDevice.token)) throw new Error('trusted device store leaked a raw token');
    if (!storedDevices.includes('tokenHash')) throw new Error('trusted device store did not include token hashes');
    const devices = server.trustedDevices();
    if (!devices.devices?.some((device) => device.id === trustedDevice.device.id && device.status === 'active')) throw new Error('trusted device was not listed as active');
    const snapshot = await request(`${status.baseUrl}/api/v1/library/snapshot`, trustedDevice.token);
    if (snapshot.statusCode !== 200) throw new Error(`authorized snapshot returned ${snapshot.statusCode}`);
    await request(`${status.baseUrl}/api/v1/library/snapshot`, trustedDevice.token);
    await request(`${status.baseUrl}/api/v1/library/snapshot`, trustedDevice.token);
    const beforeLastSeenFlush = JSON.parse(await fs.readFile(deviceStorePath, 'utf8'));
    const storedTrustedDevice = beforeLastSeenFlush.devices.find((device) => device.id === trustedDevice.device.id);
    if (storedTrustedDevice?.lastSeenAt) throw new Error('one-second polling synchronously persisted lastSeenAt');
    const body = JSON.parse(snapshot.body.toString('utf8'));
    const snapshotText = snapshot.body.toString('utf8');
    if (body.tracks?.[0]?.path || body.tracks?.[0]?.artworkPath) throw new Error('snapshot leaked a local path field');
    if (snapshotText.includes(tempDir) || snapshotText.includes(privateTrackId)) throw new Error('snapshot leaked a private path value');
    if (/[:\\]/.test(body.tracks?.[0]?.id || '')) throw new Error('snapshot exposed a path-shaped track id');
    if (!body.tracks?.[0]?.streamUrl) throw new Error('snapshot did not include a stream URL');
    const tracksPage = await request(`${status.baseUrl}/api/v1/library/tracks?limit=1&offset=0&q=mp3`, trustedDevice.token);
    if (tracksPage.statusCode !== 200) throw new Error(`paged tracks returned ${tracksPage.statusCode}`);
    const tracksPageBody = JSON.parse(tracksPage.body.toString('utf8'));
    if (tracksPageBody.page?.limit !== 1 || tracksPageBody.page?.total !== 2 || tracksPageBody.tracks?.length !== 1 || !tracksPageBody.tracks[0].streamUrl) {
      throw new Error('paged tracks did not return a bounded public result');
    }
    const range = await request(`${status.baseUrl}${body.tracks[0].streamUrl}`, trustedDevice.token, { headers: { Range: 'bytes=2-5' } });
    if (range.statusCode !== 206) throw new Error(`range stream returned ${range.statusCode}`);
    if (range.body.toString('utf8') !== '2345') throw new Error('range stream returned unexpected bytes');
    const unauthorizedStream = await request(`${status.baseUrl}${body.tracks[0].streamUrl}`);
    if (unauthorizedStream.statusCode !== 401) throw new Error(`unauthorized stream returned ${unauthorizedStream.statusCode}`);
    const queryCredentialStream = await request(`${status.baseUrl}${body.tracks[0].streamUrl}?token=${encodeURIComponent(trustedDevice.token)}`);
    assertHttpError(queryCredentialStream, 401, 'auth_required', 'query-string media credential denial');
    const openEndedRange = await request(`${status.baseUrl}${body.tracks[0].streamUrl}`, trustedDevice.token, { headers: { Range: 'bytes=12-' } });
    if (openEndedRange.statusCode !== 206 || openEndedRange.body.toString('utf8') !== 'cdef') throw new Error('open-ended range stream failed');
    const suffixRange = await request(`${status.baseUrl}${body.tracks[0].streamUrl}`, trustedDevice.token, { headers: { Range: 'bytes=-4' } });
    if (suffixRange.statusCode !== 206 || suffixRange.body.toString('utf8') !== 'cdef') throw new Error('suffix range stream failed');
    const invalidRange = await request(`${status.baseUrl}${body.tracks[0].streamUrl}`, trustedDevice.token, { headers: { Range: 'bytes=99-100' } });
    if (invalidRange.statusCode !== 416) throw new Error(`invalid range returned ${invalidRange.statusCode}`);
    for (const format of ['FLAC', 'WAV', 'MP3']) {
      const mediaTrack = body.tracks.find((track) => track.format === format && !track.missing);
      if (!mediaTrack) throw new Error(`${format} audit track was missing`);
      const formatRange = await request(`${status.baseUrl}${mediaTrack.streamUrl}`, trustedDevice.token, { headers: { Range: 'bytes=4-7' } });
      const expectedType = format === 'FLAC' ? 'audio/flac' : format === 'WAV' ? 'audio/wav' : 'audio/mpeg';
      if (formatRange.statusCode !== 206 || formatRange.headers['content-type'] !== expectedType) {
        throw new Error(`${format} authenticated range contract failed`);
      }
    }

    const jamGuestDevice = server.createTrustedDevice({
      name: 'Control-only J.A.M. guest',
      accessProfile: 'jam-guest',
      permissions: ['browse', 'playback:read', 'jam:view', 'jam:suggest'],
    });
    if (!jamGuestDevice.ok || jamGuestDevice.device.accessProfile !== 'jam-guest' || jamGuestDevice.device.originalStreamAccess) {
      throw new Error('J.A.M. guest device did not receive the control-only access profile');
    }
    const jamGuestSnapshot = jsonBody(await request(`${status.baseUrl}/api/v1/library/snapshot`, jamGuestDevice.token));
    if (jamGuestSnapshot.tracks?.some((track) => track.streamUrl)) throw new Error('J.A.M. guest library payload advertised an original stream URL');
    assertHttpError(
      await request(`${status.baseUrl}${body.tracks[0].streamUrl}`, jamGuestDevice.token),
      403,
      'original_stream_requires_personal_device',
      'J.A.M. guest direct original stream denial',
    );
    const conflictingGuest = server.createTrustedDevice({ name: 'Invalid streaming guest', accessProfile: 'jam-guest', permissions: ['browse', 'stream'] });
    if (conflictingGuest.ok || conflictingGuest.code !== 'access_profile_permission_conflict') {
      throw new Error('J.A.M. guest creation accepted original stream permission');
    }
    const guestGrantConflict = await request(`${status.baseUrl}/api/v1/devices/${jamGuestDevice.device.id}`, status.token, {
      method: 'PATCH', body: { permissions: ['browse', 'stream'], accessProfile: 'jam-guest' },
    });
    assertHttpError(guestGrantConflict, 409, 'access_profile_permission_conflict', 'J.A.M. guest original stream grant denial');

    const editableDevice = server.createTrustedDevice({ name: 'Editable permissions', permissions: [] });
    if (!editableDevice.ok || editableDevice.device.permissions.length) throw new Error('empty device permissions were silently widened');
    const deniedBrowse = await request(`${status.baseUrl}/api/v1/library/snapshot`, editableDevice.token);
    assertHttpError(deniedBrowse, 403, 'permission_required', 'browse permission denial');
    const deniedStream = await request(`${status.baseUrl}${body.tracks[0].streamUrl}`, editableDevice.token);
    assertHttpError(deniedStream, 403, 'permission_required', 'stream permission denial');
    const deniedLive = await request(`${status.baseUrl}/api/v1/live`, editableDevice.token);
    assertHttpError(deniedLive, 403, 'permission_required', 'playback read permission denial');
    const deniedPlayback = await request(`${status.baseUrl}/api/v1/commands/playback`, editableDevice.token, { method: 'POST', body: { action: 'next' } });
    assertHttpError(deniedPlayback, 403, 'permission_required', 'playback control permission denial');
    const deniedQueue = await request(`${status.baseUrl}/api/v1/commands/queue`, editableDevice.token, { method: 'POST', body: { action: 'clear' } });
    assertHttpError(deniedQueue, 403, 'permission_required', 'queue write permission denial');
    const deniedOwnerList = await request(`${status.baseUrl}/api/v1/devices`, editableDevice.token);
    assertHttpError(deniedOwnerList, 403, 'owner_required', 'owner device-list denial');
    const deniedOwnerEdit = await request(`${status.baseUrl}/api/v1/devices/${editableDevice.device.id}`, editableDevice.token, {
      method: 'PATCH', body: { permissions: ['browse'] },
    });
    assertHttpError(deniedOwnerEdit, 403, 'owner_required', 'owner permission-edit denial');

    const grantedPermissions = ['browse', 'stream', 'playback:read', 'playback:control', 'queue:write'];
    const grantResult = await request(`${status.baseUrl}/api/v1/devices/${editableDevice.device.id}`, status.token, {
      method: 'PATCH', body: { permissions: grantedPermissions },
    });
    if (grantResult.statusCode !== 200 || JSON.stringify(jsonBody(grantResult).device?.permissions) !== JSON.stringify(grantedPermissions)) {
      throw new Error('owner could not grant trusted-device permissions');
    }
    if ((await request(`${status.baseUrl}/api/v1/library/snapshot`, editableDevice.token)).statusCode !== 200) throw new Error('granted browse permission did not take effect');
    if ((await request(`${status.baseUrl}${body.tracks[0].streamUrl}`, editableDevice.token, { headers: { Range: 'bytes=0-1' } })).statusCode !== 206) throw new Error('granted stream permission did not take effect');
    if ((await request(`${status.baseUrl}/api/v1/live`, editableDevice.token)).statusCode !== 200) throw new Error('granted playback read permission did not take effect');
    if ((await request(`${status.baseUrl}/api/v1/commands/playback`, editableDevice.token, { method: 'POST', body: { action: 'next' } })).statusCode !== 202) throw new Error('granted playback control permission did not take effect');
    if ((await request(`${status.baseUrl}/api/v1/commands/queue`, editableDevice.token, { method: 'POST', body: { action: 'clear' } })).statusCode !== 202) throw new Error('granted queue write permission did not take effect');

    const guestDowngrade = await request(`${status.baseUrl}/api/v1/devices/${editableDevice.device.id}`, status.token, {
      method: 'PATCH', body: { accessProfile: 'jam-guest' },
    });
    const guestDowngradeBody = jsonBody(guestDowngrade);
    if (guestDowngrade.statusCode !== 200 || guestDowngradeBody.device?.permissions?.includes('stream') || guestDowngradeBody.device?.originalStreamAccess) {
      throw new Error('switching a personal device to J.A.M. guest did not remove original media access');
    }
    assertHttpError(
      await request(`${status.baseUrl}${body.tracks[0].streamUrl}`, editableDevice.token),
      403,
      'original_stream_requires_personal_device',
      'downgraded J.A.M. guest original stream denial',
    );
    const personalRestore = await request(`${status.baseUrl}/api/v1/devices/${editableDevice.device.id}`, status.token, {
      method: 'PATCH', body: { accessProfile: 'personal-device', permissions: grantedPermissions },
    });
    if (personalRestore.statusCode !== 200 || !jsonBody(personalRestore).device?.originalStreamAccess) {
      throw new Error('owner could not restore a trusted personal-device stream profile');
    }

    const removeResult = await request(`${status.baseUrl}/api/v1/devices/${editableDevice.device.id}`, status.token, { method: 'PATCH', body: { permissions: [] } });
    if (removeResult.statusCode !== 200 || jsonBody(removeResult).device?.permissions?.length) throw new Error('owner could not remove trusted-device permissions');
    assertHttpError(await request(`${status.baseUrl}/api/v1/commands/playback`, editableDevice.token, { method: 'POST', body: { action: 'next' } }), 403, 'permission_required', 'removed playback permission');
    const invalidPermissionEdit = await request(`${status.baseUrl}/api/v1/devices/${editableDevice.device.id}`, status.token, { method: 'PATCH', body: { permissions: ['owner'] } });
    assertHttpError(invalidPermissionEdit, 400, 'permissions_invalid', 'unsupported permission edit');

    const deletedDevice = server.createTrustedDevice({ name: 'Delete fixture', permissions: ['browse'] });
    if (!deletedDevice.ok || !server.trustedDevices().devices.some((device) => device.id === deletedDevice.device.id)) {
      throw new Error('trusted-device delete fixture was not created');
    }
    const deleted = server.deleteTrustedDevice(deletedDevice.device.id);
    if (!deleted.ok || server.trustedDevices().devices.some((device) => device.id === deletedDevice.device.id)) {
      throw new Error('owner could not delete the trusted-device record');
    }
    assertHttpError(await request(`${status.baseUrl}/api/v1/library/snapshot`, deletedDevice.token), 401, 'auth_invalid', 'deleted credential');

    const expiredDevice = server.createTrustedDevice({ name: 'Expired phone', permissions: ['browse'], expiresAt: new Date(Date.now() - 1000).toISOString() });
    if (!expiredDevice.ok) throw new Error('expired credential fixture could not be created');
    assertHttpError(await request(`${status.baseUrl}/api/v1/library/snapshot`, expiredDevice.token), 401, 'auth_expired', 'expired credential');
    const missingTrack = body.tracks.find((track) => track.title === 'Missing Server Test');
    if (!missingTrack?.streamUrl) throw new Error('missing test track did not include a stream URL');
    const missingStream = await request(`${status.baseUrl}${missingTrack.streamUrl}`, trustedDevice.token);
    if (missingStream.statusCode !== 404) throw new Error(`missing stream returned ${missingStream.statusCode}`);
    const missingArtwork = await request(`${status.baseUrl}${body.tracks[0].artworkUrl}`, trustedDevice.token);
    if (missingArtwork.statusCode !== 404) throw new Error(`missing artwork returned ${missingArtwork.statusCode}`);
    const pairing = await request(`${status.baseUrl}/api/v1/pair/start`, status.token, {
      method: 'POST',
      body: { deviceName: 'Pairing phone', permissions: ['browse', 'stream', 'playback:read'] },
    });
    if (pairing.statusCode !== 200) throw new Error(`pair start returned ${pairing.statusCode}`);
    const pairingBody = JSON.parse(pairing.body.toString('utf8'));
    if (!pairingBody.pairingCode || !pairingBody.secret || !pairingBody.pairingPayload?.baseUrls?.length) {
      throw new Error('pair start did not include a QR-ready pairing payload');
    }
    const paired = await request(`${status.baseUrl}/api/v1/pair/complete`, '', {
      method: 'POST',
      body: {
        pairingCode: pairingBody.pairingCode,
        secret: pairingBody.secret,
        deviceName: 'Paired phone',
      },
    });
    if (paired.statusCode !== 200) throw new Error(`pair complete returned ${paired.statusCode}`);
    const pairedBody = JSON.parse(paired.body.toString('utf8'));
    if (!pairedBody.token || pairedBody.device?.pairingMethod !== 'short-code' || pairedBody.device?.accessProfile !== 'personal-device') throw new Error('pair complete did not create a personal short-code trusted device');
    const guestPairing = await request(`${status.baseUrl}/api/v1/pair/start`, status.token, {
      method: 'POST',
      body: { deviceName: 'Guest pairing phone', accessProfile: 'jam-guest', permissions: ['browse', 'playback:read', 'jam:view'] },
    });
    const guestPairingBody = jsonBody(guestPairing);
    if (guestPairing.statusCode !== 200 || guestPairingBody.accessProfile !== 'jam-guest' || guestPairingBody.pairingPayload?.accessProfile !== 'jam-guest') {
      throw new Error('guest short-code pairing did not preserve the access profile');
    }
    const guestPaired = await request(`${status.baseUrl}/api/v1/pair/complete`, '', {
      method: 'POST',
      body: { pairingCode: guestPairingBody.pairingCode, secret: guestPairingBody.secret, deviceName: 'Guest paired phone' },
    });
    const guestPairedBody = jsonBody(guestPaired);
    if (guestPaired.statusCode !== 200 || guestPairedBody.device?.accessProfile !== 'jam-guest' || guestPairedBody.device?.originalStreamAccess) {
      throw new Error('guest short-code completion widened the device to personal streaming');
    }
    const live = await request(`${status.baseUrl}/api/v1/live`, pairedBody.token);
    if (live.statusCode !== 200) throw new Error(`live state returned ${live.statusCode}`);
    const liveBody = JSON.parse(live.body.toString('utf8'));
    if (!Number.isFinite(liveBody.revision) || liveBody.playback?.currentTrackId !== body.tracks[0].id) {
      throw new Error('live state did not return public playback state');
    }
    const refresh = await request(`${status.baseUrl}/api/v1/devices/refresh`, pairedBody.token, {
      method: 'POST',
      body: { reason: 'server audit soft refresh' },
    });
    if (refresh.statusCode !== 202) throw new Error(`device refresh returned ${refresh.statusCode}`);
    const refreshBody = JSON.parse(refresh.body.toString('utf8'));
    if (!refreshBody.accepted || refreshBody.refresh?.action !== 'soft-refresh') throw new Error('device refresh was not accepted');
    const refreshedLive = await request(`${status.baseUrl}/api/v1/live`, pairedBody.token);
    const refreshedLiveBody = JSON.parse(refreshedLive.body.toString('utf8'));
    if (refreshedLiveBody.deviceRefresh?.id !== refreshBody.refresh.id) throw new Error('live state did not advertise the latest device refresh');
    if (!remoteCommands.some((command) => command.type === 'device-refresh' && command.payload?.id === refreshBody.refresh.id)) {
      throw new Error('device refresh did not reach the remote command bridge');
    }
    const rejectedControl = await request(`${status.baseUrl}/api/v1/commands/playback`, trustedDevice.token, {
      method: 'POST',
      body: { action: 'next' },
    });
    if (rejectedControl.statusCode !== 403) throw new Error(`limited device playback control returned ${rejectedControl.statusCode}`);
    const controllerDevice = server.createTrustedDevice({
      name: 'Controller phone',
      permissions: ['browse', 'stream', 'playback:read', 'playback:control', 'queue:write'],
    });
    if (!controllerDevice.ok || !controllerDevice.token) throw new Error('controller token was not created');
    const playbackCommand = await request(`${status.baseUrl}/api/v1/commands/playback`, controllerDevice.token, {
      method: 'POST',
      body: { action: 'next' },
    });
    if (playbackCommand.statusCode !== 202) throw new Error(`playback command returned ${playbackCommand.statusCode}`);
    const queueCommand = await request(`${status.baseUrl}/api/v1/commands/queue`, controllerDevice.token, {
      method: 'POST',
      body: { action: 'addTrack', trackId: body.tracks[0].id },
    });
    if (queueCommand.statusCode !== 202) throw new Error(`queue command returned ${queueCommand.statusCode}`);
    const shuffleCommand = await request(`${status.baseUrl}/api/v1/commands/shuffle`, controllerDevice.token, {
      method: 'POST', body: { action: 'setSession', session: { horizon: 7, energyShape: 'rise', albumPolicy: 'album' } },
    });
    if (shuffleCommand.statusCode !== 202 || jsonBody(shuffleCommand).commandVersion !== 1) throw new Error('versioned shuffle command was not accepted');
    if (!remoteCommands.some((command) => command.type === 'playback' && command.payload?.action === 'next')) {
      throw new Error('playback command did not reach the remote command bridge');
    }
    if (!remoteCommands.some((command) => command.type === 'queue' && command.payload?.trackId === privateTrackId)) {
      throw new Error('queue command did not map public track id back to the private renderer id');
    }
    if (!remoteCommands.some((command) => command.type === 'shuffle' && command.payload?.session?.horizon === 7 && command.version === 1)) {
      throw new Error('versioned shuffle command did not reach the desktop-authoritative bridge');
    }

    const jamStarted = await request(`${status.baseUrl}/api/v1/jam/session`, status.token, {
      method: 'POST',
      body: { guestPolicy: { guestsCanView: true, guestsCanSuggest: true, guestsCanQueue: false, guestsCanEditQueue: false, guestsCanControlPlayback: false } },
    });
    if (jamStarted.statusCode !== 201) throw new Error(`J.A.M. session start returned ${jamStarted.statusCode}`);
    const jamStartedBody = jsonBody(jamStarted);
    if (!jamStartedBody.active || jamStartedBody.mode !== 'single-host' || jamStartedBody.roles?.coordinatorDeviceId !== status.hostId || jamStartedBody.authority?.shuffle !== 'desktop-host' || jamStartedBody.permissions?.federatedSourcesEnabled) {
      throw new Error('J.A.M. session did not establish the bounded Windows-owned single-host contract');
    }
    if (jamStartedBody.queue?.some((item) => item.sourceDeviceId !== status.hostId || item.sourceLibraryId !== `${status.hostId}:library`)) {
      throw new Error('J.A.M. seed queue did not preserve host source ownership');
    }
    const jamGuest = server.createTrustedDevice({
      name: 'J.A.M. guest phone',
      accessProfile: 'jam-guest',
      permissions: ['browse', 'playback:read', 'jam:view', 'jam:suggest', 'jam:queue', 'jam:control'],
    });
    if (!jamGuest.ok || !jamGuest.token) throw new Error('J.A.M. guest credential was not created');
    assertHttpError(await request(`${status.baseUrl}/api/v1/jam/session`, jamGuest.token), 403, 'jam_permission_required', 'unjoined J.A.M. session inspection');
    const jamJoin = await request(`${status.baseUrl}/api/v1/jam/session/join`, jamGuest.token, { method: 'POST', body: { role: 'guest' } });
    if (jamJoin.statusCode !== 202 || !jsonBody(jamJoin).approvalRequired) throw new Error('J.A.M. join did not enter owner approval');
    assertHttpError(await request(`${status.baseUrl}/api/v1/jam/session`, jamGuest.token), 409, 'jam_approval_pending', 'pending J.A.M. inspection');
    assertHttpError(await request(`${status.baseUrl}/api/v1/jam/session/queue`, jamGuest.token, { method: 'POST', body: { action: 'suggest', trackId: body.tracks[0].id } }), 403, 'jam_permission_required', 'unapproved J.A.M. suggestion');
    const ownerPending = jsonBody(await request(`${status.baseUrl}/api/v1/jam/session/participants`, status.token));
    if (!ownerPending.participants?.some((item) => item.deviceId === jamGuest.device.id && item.status === 'pending')) throw new Error('Windows owner could not see the pending J.A.M. participant');
    const jamApprove = await request(`${status.baseUrl}/api/v1/jam/session/participants/${jamGuest.device.id}`, status.token, {
      method: 'PATCH', body: { approved: true, role: 'guest', permissions: ['view', 'suggest'] },
    });
    if (jamApprove.statusCode !== 200 || jsonBody(jamApprove).participant?.status !== 'active') throw new Error('Windows owner could not approve the J.A.M. participant');
    const jamGuestView = jsonBody(await request(`${status.baseUrl}/api/v1/jam/session`, jamGuest.token));
    if (!jamGuestView.active || jamGuestView.currentParticipant?.role !== 'guest' || jamGuestView.currentParticipant?.permissions?.includes('editQueue')) throw new Error('approved guest received the wrong visible J.A.M. role or permissions');
    const suggested = await request(`${status.baseUrl}/api/v1/jam/session/queue`, jamGuest.token, { method: 'POST', body: { action: 'suggest', trackId: body.tracks[0].id } });
    if (suggested.statusCode !== 202 || !jsonBody(suggested).queue?.some((item) => item.addedByDeviceId === jamGuest.device.id && item.playbackStatus === 'suggested')) {
      throw new Error('scoped guest suggestion did not preserve added-by identity');
    }
    assertHttpError(await request(`${status.baseUrl}/api/v1/jam/session/queue`, jamGuest.token, { method: 'POST', body: { action: 'add', trackId: body.tracks[0].id } }), 403, 'jam_permission_required', 'guest queue-add denial');
    assertHttpError(await request(`${status.baseUrl}/api/v1/jam/session`, jamGuest.token, { method: 'PATCH', body: { guestsCanControlPlayback: true } }), 403, 'owner_required', 'guest policy escalation denial');
    const jamPolicy = await request(`${status.baseUrl}/api/v1/jam/session`, status.token, {
      method: 'PATCH', body: { guestPolicy: { guestsCanView: true, guestsCanSuggest: true, guestsCanQueue: true, guestsCanEditQueue: true, guestsCanControlPlayback: true } },
    });
    if (jamPolicy.statusCode !== 200 || !jsonBody(jamPolicy).permissions?.guestsCanControlPlayback) throw new Error('owner could not edit the active J.A.M. guest policy');
    const jamExpand = await request(`${status.baseUrl}/api/v1/jam/session/participants/${jamGuest.device.id}`, status.token, {
      method: 'PATCH', body: { approved: true, role: 'controller', permissions: ['view', 'suggest', 'add', 'editQueue', 'controlPlayback'] },
    });
    if (jamExpand.statusCode !== 200) throw new Error('owner could not grant scoped J.A.M. controller permissions');
    const federatedDenied = await request(`${status.baseUrl}/api/v1/jam/session/queue`, jamGuest.token, {
      method: 'POST', body: { action: 'add', trackId: body.tracks[0].id, sourceDeviceId: jamGuest.device.id },
    });
    assertHttpError(federatedDenied, 409, 'federated_source_not_supported', 'federated J.A.M. source denial');
    const jamAdded = await request(`${status.baseUrl}/api/v1/jam/session/queue`, jamGuest.token, { method: 'POST', body: { action: 'add', trackId: body.tracks[0].id } });
    const jamAddedBody = jsonBody(jamAdded);
    const addedItem = jamAddedBody.queue?.find((item) => item.addedByDeviceId === jamGuest.device.id && item.playbackStatus === 'queued');
    if (jamAdded.statusCode !== 202 || !addedItem || addedItem.sourceDeviceId !== status.hostId || addedItem.cacheState !== 'host-owned' || addedItem.fallbackCandidates?.length) {
      throw new Error('J.A.M. queue item lost source ownership or single-host fallback constraints');
    }
    const missingJamAdd = await request(`${status.baseUrl}/api/v1/jam/session/queue`, jamGuest.token, { method: 'POST', body: { action: 'add', trackId: missingTrack.id } });
    if (missingJamAdd.statusCode !== 202 || !jsonBody(missingJamAdd).queue?.some((item) => item.trackId === missingTrack.id && item.availability === 'unavailable' && item.diagnostic)) {
      throw new Error('missing host-owned J.A.M. track did not surface an actionable unavailable state');
    }
    const jamPlayback = await request(`${status.baseUrl}/api/v1/jam/session/playback`, jamGuest.token, { method: 'POST', body: { action: 'next' } });
    if (jamPlayback.statusCode !== 202) throw new Error('approved J.A.M. controller could not send playback control');
    const jamRevisionLive = jsonBody(await request(`${status.baseUrl}/api/v1/live`, jamGuest.token));
    if (!jamRevisionLive.revisions?.jam || jamRevisionLive.networkSession?.kind !== 'jam-single-host' || jamRevisionLive.networkSession?.shuffle?.version !== 1 || jamRevisionLive.jamSession?.mode !== 'single-host') {
      throw new Error('live state did not expose the active J.A.M. revision and Android-visible session contract');
    }
    const jamRevoked = server.revokeTrustedDevice(jamGuest.device.id);
    if (!jamRevoked.ok) throw new Error('J.A.M. participant credential could not be revoked');
    const ownerDiagnostics = jsonBody(await request(`${status.baseUrl}/api/v1/jam/session/diagnostics`, status.token));
    if (ownerDiagnostics.diagnostics?.revokedParticipants !== 1) throw new Error('revoked J.A.M. participant was not visible in diagnostics');
    const jamStopped = await request(`${status.baseUrl}/api/v1/jam/session`, status.token, { method: 'DELETE' });
    if (jamStopped.statusCode !== 200 || jsonBody(jamStopped).active || !jsonBody(jamStopped).queueItemsCleared) throw new Error('J.A.M. stop did not clear ephemeral session state');
    const afterJamStop = jsonBody(await request(`${status.baseUrl}/api/v1/jam/session`, status.token));
    if (afterJamStop.active || afterJamStop.session) throw new Error('stopped J.A.M. session remained inspectable');

    const revoked = server.revokeTrustedDevice(trustedDevice.device.id);
    if (!revoked.ok) throw new Error('trusted device was not revoked');
    const rejectedAfterRevoke = await request(`${status.baseUrl}/api/v1/library/snapshot`, trustedDevice.token);
    assertHttpError(rejectedAfterRevoke, 401, 'auth_revoked', 'revoked credential');
    const stalePairing = await request(`${status.baseUrl}/api/v1/pair/start`, status.token, {
      method: 'POST',
      body: { deviceName: 'Stale pairing phone', permissions: ['browse', 'stream'] },
    });
    const stalePairingBody = JSON.parse(stalePairing.body.toString('utf8'));
    if (!stalePairingBody.pairingCode || !stalePairingBody.secret) throw new Error('stale-pairing lifecycle setup failed');
    if (!server.startJamSession({}).active) throw new Error('host-stop J.A.M. cleanup setup failed');

    const largeTrack = body.tracks.find((track) => track.title === 'Large Stream Test');
    if (!largeTrack?.streamUrl) throw new Error('large stream test track was not published');
    const activeStream = await openPausedRequest(`${status.baseUrl}${largeTrack.streamUrl}`, controllerDevice.token);
    const stalledSocket = await openStalledSocket(status.baseUrl);
    stalledSocket.on('error', () => {});
    const stopStartedAt = Date.now();
    const stopped = await server.stop();
    const stopElapsedMs = Date.now() - stopStartedAt;
    activeStream.req.destroy();
    activeStream.res.destroy();
    stalledSocket.destroy();
    if (stopElapsedMs > 1000) throw new Error(`Stop Hosting took too long with active clients: ${stopElapsedMs} ms`);
    if (stopped.enabled || stopped.token || stopped.baseUrl || stopped.networkDiagnostics?.listening) {
      throw new Error('stopped host still advertised live connection details');
    }
    await expectRequestFailure(`${status.baseUrl}/api/v1/health`, 'stopped host');

    const restarted = await server.start();
    if (restarted.hostId !== status.hostId) throw new Error('host identity changed across stop/start');
    if (!restarted.token || restarted.token === status.token) throw new Error('owner token did not rotate across stop/start');
    if (restarted.jamSession?.active) throw new Error('J.A.M. session survived host stop/restart');
    const staleOwner = await request(`${restarted.baseUrl}/api/v1/devices`, status.token);
    if (staleOwner.statusCode !== 401) throw new Error(`stale owner token returned ${staleOwner.statusCode}`);
    const currentOwner = await request(`${restarted.baseUrl}/api/v1/devices`, restarted.token);
    if (currentOwner.statusCode !== 200) throw new Error(`current owner token returned ${currentOwner.statusCode}`);
    const stalePairingCompletion = await request(`${restarted.baseUrl}/api/v1/pair/complete`, '', {
      method: 'POST',
      body: {
        pairingCode: stalePairingBody.pairingCode,
        secret: stalePairingBody.secret,
        deviceName: 'Should not pair',
      },
    });
    if (stalePairingCompletion.statusCode !== 400) throw new Error('pairing grant survived a host stop/restart');
    const persistentDeviceAfterRestart = await request(`${restarted.baseUrl}/api/v1/library/snapshot`, controllerDevice.token);
    if (persistentDeviceAfterRestart.statusCode !== 200) throw new Error('trusted device token did not survive host restart');
    await server.stop();

    recreatedServer = createPersonalServer({
      appVersion: 'test',
      platform: 'test',
      identityStorePath,
      deviceStorePath,
    });
    const recreatedStatus = await recreatedServer.start();
    if (recreatedStatus.hostId !== status.hostId) throw new Error('host identity changed across server recreation');
    const persistentDeviceAfterRecreation = await request(`${recreatedStatus.baseUrl}/api/v1/library/snapshot`, controllerDevice.token);
    if (persistentDeviceAfterRecreation.statusCode !== 200) throw new Error('trusted device token did not survive server recreation');
    const revokedAfterRecreation = await request(`${recreatedStatus.baseUrl}/api/v1/library/snapshot`, trustedDevice.token);
    if (revokedAfterRecreation.statusCode !== 401) throw new Error('revoked device token became valid after server recreation');
    await recreatedServer.stop();
    recreatedServer = null;
    await fs.rm(tempDir, { recursive: true, force: true });
    console.log('Server audit passed.');
  } catch (error) {
    await server.stop().catch(() => {});
    if (recreatedServer) await recreatedServer.stop().catch(() => {});
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    console.error(error);
    process.exitCode = 1;
  }
})();
