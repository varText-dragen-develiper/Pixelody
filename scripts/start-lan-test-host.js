const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { createPersonalServer } = require('../src/server');

const DEFAULT_PORT = 47814;

function getLanIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses;
}

function findSampleAudioFiles() {
  const audioDir = path.join(__dirname, '..', 'notes', 'same-reference-control-r1', 'isolated-application', 'audio');
  if (fs.existsSync(audioDir)) {
    const files = fs.readdirSync(audioDir).filter(f => f.endsWith('.wav'));
    if (files.length > 0) {
      return files.map((file, idx) => ({
        id: `host_track_${idx + 1}`,
        title: file.replace('.wav', '').replace(/^[0-9]+-/, '').replace(/-/g, ' '),
        artist: 'Pixelody Studio',
        album: 'LAN Test Suite',
        format: 'WAV',
        codec: 'PCM_16',
        lossless: true,
        sampleRate: 44100,
        bitDepth: 16,
        channels: 2,
        duration: 30,
        path: path.join(audioDir, file),
        favorite: idx === 0,
        missing: false,
      }));
    }
  }
  return [];
}

async function startTestHost(options = {}) {
  const port = options.port || DEFAULT_PORT;
  const tempDir = path.join(os.tmpdir(), `pixelody-test-host-${Date.now()}`);
  await fsp.mkdir(tempDir, { recursive: true });

  const identityStorePath = path.join(tempDir, 'host-identity.json');
  const deviceStorePath = path.join(tempDir, 'trusted-devices.json');

  const tracks = findSampleAudioFiles();
  const playlists = [
    {
      id: 'lan_playlist_1',
      name: 'LAN Reference Collection',
      virtual: false,
      collectionType: 'manual',
      trackIds: tracks.map(t => t.id),
    }
  ];

  const server = createPersonalServer({
    appVersion: '1.0.0-test',
    platform: 'windows',
    identityStorePath,
    deviceStorePath,
    initialSnapshot: {
      generatedAt: new Date().toISOString(),
      hostName: 'Pixelody Desktop Host',
      tracks,
      playlists,
      favorites: tracks.filter(t => t.favorite).map(t => t.id),
      queue: tracks.map(t => t.id),
      playback: {
        currentTrackId: tracks[0]?.id || null,
        paused: true,
        currentTime: 0,
        duration: 30,
      }
    }
  });

  const lanIps = getLanIpAddresses();
  const preferredLanIp = lanIps[0] || '127.0.0.1';

  const status = await server.start({
    port,
    visibility: 'lan',
    remoteBaseUrl: `http://${preferredLanIp}:${port}`,
  });

  const pairing = server.startPairing({
    deviceName: 'Pixelody Samsung Galaxy',
    permissions: ['browse', 'stream', 'cache', 'playback:read', 'playback:control', 'queue:read', 'queue:write'],
    accessProfile: 'personal-device',
  });

  const baseUrls = [
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    `http://${preferredLanIp}:${port}`,
    ...lanIps.map(ip => `http://${ip}:${port}`)
  ].filter((v, i, a) => a.indexOf(v) === i);

  const deepLink = `pixelody://connect?u=${encodeURIComponent(`http://127.0.0.1:${port}`)}&urls=${encodeURIComponent(baseUrls.join(','))}&c=${encodeURIComponent(pairing.pairingCode)}&s=${encodeURIComponent(pairing.secret)}`;
  const compactText = `pxd1|${encodeURIComponent(`http://127.0.0.1:${port}`)}|${encodeURIComponent(pairing.pairingCode)}|${encodeURIComponent(pairing.secret)}`;

  const info = {
    ok: true,
    hostId: status.hostId,
    hostName: 'Pixelody Desktop Host',
    port,
    localBaseUrl: `http://127.0.0.1:${port}`,
    lanBaseUrls: baseUrls,
    pairingCode: pairing.pairingCode,
    pairingSecret: pairing.secret,
    deepLink,
    compactText,
    trackCount: tracks.length,
    tempDir,
  };

  return { server, info, tempDir };
}

if (require.main === module) {
  (async () => {
    const infoFilePath = path.join(__dirname, '.lan-test-host-info.json');
    try {
      const { server, info, tempDir } = await startTestHost();
      await fsp.writeFile(infoFilePath, JSON.stringify(info, null, 2), 'utf8');
      console.log('PIXELODY_TEST_HOST_READY');
      console.log(JSON.stringify(info, null, 2));

      async function cleanup() {
        await server.stop().catch(() => {});
        await fsp.rm(infoFilePath, { force: true }).catch(() => {});
        await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        process.exit(0);
      }

      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);
    } catch (err) {
      console.error(err);
      await fsp.rm(infoFilePath, { force: true }).catch(() => {});
      process.exit(1);
    }
  })();
}

module.exports = { startTestHost };
