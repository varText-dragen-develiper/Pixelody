const crypto = require('crypto');
const flowShuffleContract = require('../flow-shuffle-contract');
const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');
const os = require('os');
const path = require('path');
const { loadOrCreateHostIdentity } = require('./identity');

const API_PREFIX = '/api/v1';
const DEFAULT_HOST = '127.0.0.1';
const LAN_BIND_HOST = '0.0.0.0';
const DEVICE_TOKEN_PREFIX = 'pxd_';
const DEFAULT_DEVICE_PERMISSIONS = ['browse', 'stream', 'playback:read'];
const DEFAULT_DEVICE_ACCESS_PROFILE = 'personal-device';
const DEVICE_ACCESS_PROFILES = new Set([DEFAULT_DEVICE_ACCESS_PROFILE, 'jam-guest']);
const ORIGINAL_MEDIA_PERMISSIONS = new Set(['stream', 'cache']);
const MAX_PENDING_PAIRINGS = 16;
const LAST_SEEN_FLUSH_MS = 15_000;
const PAIRING_ATTEMPT_WINDOW_MS = 60_000;
const PAIRING_ATTEMPT_LIMIT = 20;
const COMMAND_WINDOW_MS = 10_000;
const COMMAND_LIMIT = 60;
const ALLOWED_DEVICE_PERMISSIONS = new Set([
  'browse',
  'stream',
  'cache',
  'playback:read',
  'playback:control',
  'queue:read',
  'queue:write',
  'jam:guest',
  'jam:view',
  'jam:suggest',
  'jam:queue',
  'jam:control',
]);
const MANAGEABLE_DEVICE_PERMISSIONS = [
  'browse', 'stream', 'playback:read', 'playback:control', 'queue:write',
  'jam:view', 'jam:suggest', 'jam:queue', 'jam:control',
];
const JAM_PERMISSION_KEYS = ['view', 'suggest', 'add', 'editQueue', 'controlPlayback'];

const MIME_TYPES = {
  FLAC: 'audio/flac',
  WAV: 'audio/wav',
  WAVE: 'audio/wav',
  AIFF: 'audio/aiff',
  AIF: 'audio/aiff',
  MP3: 'audio/mpeg',
  M4A: 'audio/mp4',
  AAC: 'audio/aac',
  OGG: 'audio/ogg',
  OPUS: 'audio/ogg',
  JPG: 'image/jpeg',
  JPEG: 'image/jpeg',
  PNG: 'image/png',
  WEBP: 'image/webp',
  GIF: 'image/gif',
  BMP: 'image/bmp',
};

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomDigits(length = 6) {
  const max = 10 ** length;
  return String(crypto.randomInt(0, max)).padStart(length, '0');
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function sendJson(response, statusCode, body) {
  const payload = JSON.stringify(body, null, 2);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  response.end(payload);
}

function sendError(response, statusCode, message, code = 'error') {
  sendJson(response, statusCode, { ok: false, code, message });
}

function contentTypeFor(filePath, fallbackFormat = '') {
  const extension = path.extname(filePath || '').replace('.', '').toUpperCase();
  return MIME_TYPES[extension] || MIME_TYPES[String(fallbackFormat || '').toUpperCase()] || 'application/octet-stream';
}

function safeString(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function publicTrackIdFor(privateId) {
  return crypto.createHash('sha256').update(String(privateId)).digest('hex').slice(0, 32);
}

function normalizeTrack(track = {}) {
  const id = safeString(track.id);
  if (!id) return null;
  return {
    id,
    publicId: safeString(track.publicId) || publicTrackIdFor(id),
    title: safeString(track.title, 'Untitled track'),
    artist: safeString(track.artist, 'Unknown artist'),
    album: safeString(track.album),
    year: Number.isFinite(Number(track.year)) ? Number(track.year) : null,
    trackNumber: Number.isFinite(Number(track.trackNumber)) ? Number(track.trackNumber) : null,
    duration: Number.isFinite(Number(track.duration)) ? Number(track.duration) : null,
    format: safeString(track.format).toUpperCase(),
    codec: safeString(track.codec),
    lossless: track.lossless === true,
    sampleRate: Number.isFinite(Number(track.sampleRate)) ? Number(track.sampleRate) : null,
    bitDepth: Number.isFinite(Number(track.bitDepth)) ? Number(track.bitDepth) : null,
    bitrate: Number.isFinite(Number(track.bitrate)) ? Number(track.bitrate) : null,
    channels: Number.isFinite(Number(track.channels)) ? Number(track.channels) : null,
    replayGainDb: Number.isFinite(Number(track.replayGainDb)) ? Number(track.replayGainDb) : null,
    dateAdded: Number.isFinite(Number(track.dateAdded)) ? Number(track.dateAdded) : null,
    favorite: track.favorite === true,
    missing: track.missing === true,
    path: safeString(track.path),
    artworkPath: safeString(track.artworkPath),
  };
}

function publicTrack(track, options = {}) {
  const encodedId = encodeURIComponent(track.publicId);
  const allowOriginalStream = options.allowOriginalStream !== false;
  return {
    id: track.publicId,
    title: track.title,
    artist: track.artist,
    album: track.album,
    year: track.year,
    trackNumber: track.trackNumber,
    duration: track.duration,
    format: track.format,
    codec: track.codec || track.format,
    lossless: track.lossless,
    sampleRate: track.sampleRate,
    bitDepth: track.bitDepth,
    bitrate: track.bitrate,
    channels: track.channels,
    replayGainDb: track.replayGainDb,
    artworkUrl: track.artworkPath && !track.missing ? `${API_PREFIX}/tracks/${encodedId}/artwork` : null,
    streamUrl: allowOriginalStream && track.path && !track.missing ? `${API_PREFIX}/tracks/${encodedId}/stream` : null,
    dateAdded: track.dateAdded,
    favorite: track.favorite,
    missing: track.missing,
  };
}

function publicIdMap(snapshot) {
  return new Map(snapshot.tracks.map((track) => [track.id, track.publicId]));
}

function publicTrackIds(ids, idMap) {
  return ids.map((id) => idMap.get(id) || '').filter(Boolean);
}

function publicPlaylist(playlist, idMap) {
  return { ...playlist, trackIds: publicTrackIds(playlist.trackIds, idMap) };
}

function publicTrackSummary(track) {
  if (!track) return null;
  return {
    id: track.publicId,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
    format: track.format,
    codec: track.codec || track.format,
    lossless: track.lossless,
    sampleRate: track.sampleRate,
    bitDepth: track.bitDepth,
    missing: track.missing,
  };
}

function clampInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(number)));
}

function normalizeSnapshot(raw = {}) {
  const tracks = Array.isArray(raw.tracks) ? raw.tracks.map(normalizeTrack).filter(Boolean) : [];
  const playlists = Array.isArray(raw.playlists) ? raw.playlists.map((playlist) => ({
    id: safeString(playlist.id),
    name: safeString(playlist.name, 'Playlist'),
    virtual: playlist.virtual === true,
    collectionType: safeString(playlist.collectionType),
    trackIds: Array.isArray(playlist.trackIds) ? playlist.trackIds.map((id) => safeString(id)).filter(Boolean) : [],
  })).filter((playlist) => playlist.id) : [];
  return {
    version: 1,
    generatedAt: raw.generatedAt || new Date().toISOString(),
    hostName: safeString(raw.hostName, os.hostname()),
    tracks,
    playlists,
    favorites: Array.isArray(raw.favorites) ? raw.favorites.map((id) => safeString(id)).filter(Boolean) : [],
    queue: Array.isArray(raw.queue) ? raw.queue.map((id) => safeString(id)).filter(Boolean) : [],
    playback: raw.playback && typeof raw.playback === 'object' ? raw.playback : {},
    flowShuffle: flowShuffleContract.normalizeSnapshot(raw.flowShuffle || {}),
    audioProfiles: raw.audioProfiles && typeof raw.audioProfiles === 'object' ? raw.audioProfiles : {},
  };
}

function snapshotStats(snapshot) {
  return {
    generatedAt: snapshot.generatedAt,
    tracks: snapshot.tracks.length,
    playlists: snapshot.playlists.length,
    favorites: snapshot.favorites.length,
    queue: snapshot.queue.length,
  };
}

function jsonFingerprint(value) {
  return JSON.stringify(value);
}

function libraryFingerprint(value) {
  return jsonFingerprint({
    hostName: value.hostName,
    tracks: value.tracks.map(({ favorite, ...track }) => track),
    playlists: value.playlists,
    audioProfiles: value.audioProfiles,
  });
}

function playbackPositionAt(playback = {}, atMs = Date.now()) {
  const base = Math.max(0, Number(playback.currentTime ?? playback.positionSeconds ?? 0) || 0);
  const duration = Math.max(0, Number(playback.duration ?? playback.durationSeconds ?? 0) || 0);
  const paused = playback.paused === true || playback.playing === false;
  if (paused) return duration ? Math.min(base, duration) : base;
  const estimatedStartedAt = Date.parse(safeString(playback.estimatedStartedAt));
  const positionUpdatedAt = Date.parse(safeString(playback.positionUpdatedAt));
  let projected = base;
  if (Number.isFinite(estimatedStartedAt)) projected = Math.max(0, (atMs - estimatedStartedAt) / 1000);
  else if (Number.isFinite(positionUpdatedAt)) projected = base + Math.max(0, (atMs - positionUpdatedAt) / 1000);
  return duration ? Math.min(projected, duration) : projected;
}

function playbackStateFingerprint(playback = {}) {
  return jsonFingerprint({
    currentTrackId: safeString(playback.currentTrackId),
    paused: playback.paused === true || playback.playing === false,
    duration: Number(playback.duration ?? playback.durationSeconds ?? 0) || 0,
    shuffle: playback.shuffle === true,
    repeat: safeString(playback.repeat),
    volume: Number(playback.volume ?? 0),
  });
}

function shuffleFingerprint(shuffle = {}) { return jsonFingerprint(flowShuffleContract.normalizeSnapshot(shuffle)); }

function playbackMeaningfullyChanged(previous = {}, next = {}) {
  if (playbackStateFingerprint(previous) !== playbackStateFingerprint(next)) return true;
  const nextAnchor = Date.parse(safeString(next.positionUpdatedAt));
  const atMs = Number.isFinite(nextAnchor) ? nextAnchor : Date.now();
  const expected = playbackPositionAt(previous, atMs);
  const actual = Math.max(0, Number(next.currentTime ?? next.positionSeconds ?? 0) || 0);
  const paused = next.paused === true || next.playing === false;
  return Math.abs(actual - expected) > (paused ? 0.05 : 1.25);
}

function parseRange(rangeHeader, size) {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match) return { invalid: true };
  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : size - 1;
  if (!match[1] && match[2]) {
    const suffixLength = Number(match[2]);
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) return { invalid: true };
  return { start, end: Math.min(end, size - 1) };
}

function readToken(request, url) {
  const authorization = request.headers.authorization || '';
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization);
  return bearer?.[1] || '';
}

async function readJsonBody(request, maxBytes = 16_384) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) throw Object.assign(new Error('Request body is too large.'), { statusCode: 413, code: 'body_too_large' });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const bodyText = Buffer.concat(chunks).toString('utf8').trim();
  if (!bodyText) return {};
  try {
    return JSON.parse(bodyText);
  } catch {
    throw Object.assign(new Error('Request body must be valid JSON.'), { statusCode: 400, code: 'invalid_json' });
  }
}

function normalizedPermissions(permissions) {
  const selected = Array.isArray(permissions) ? permissions : DEFAULT_DEVICE_PERMISSIONS;
  const normalized = selected.map((permission) => safeString(permission)).filter((permission) => ALLOWED_DEVICE_PERMISSIONS.has(permission));
  return [...new Set(normalized)];
}

function validatedPermissions(permissions) {
  if (permissions === undefined) return { ok: true, permissions: [...DEFAULT_DEVICE_PERMISSIONS] };
  if (!Array.isArray(permissions)) return { ok: false, code: 'permissions_invalid', message: 'Permissions must be an array.' };
  const selected = permissions.map((permission) => safeString(permission));
  const invalid = selected.filter((permission) => !ALLOWED_DEVICE_PERMISSIONS.has(permission));
  if (invalid.length) return { ok: false, code: 'permissions_invalid', message: 'One or more requested permissions are not supported.' };
  return { ok: true, permissions: [...new Set(selected)] };
}

function inferredDeviceAccessProfile(device = {}) {
  const requested = safeString(device.accessProfile);
  if (DEVICE_ACCESS_PROFILES.has(requested)) return requested;
  if (requested) return 'jam-guest';
  return safeString(device.pairingMethod) === 'jam-quick-copy' ? 'jam-guest' : DEFAULT_DEVICE_ACCESS_PROFILE;
}

function validatedDeviceAccessProfile(accessProfile) {
  if (accessProfile === undefined) return { ok: true, accessProfile: DEFAULT_DEVICE_ACCESS_PROFILE };
  const normalized = safeString(accessProfile);
  if (!DEVICE_ACCESS_PROFILES.has(normalized)) {
    return { ok: false, code: 'access_profile_invalid', message: 'Trusted-device access profile is invalid.' };
  }
  return { ok: true, accessProfile: normalized };
}

function permissionsForAccessProfile(permissions, accessProfile) {
  if (accessProfile !== 'jam-guest') return [...permissions];
  return permissions.filter((permission) => !ORIGINAL_MEDIA_PERMISSIONS.has(permission));
}

function validateProfilePermissions(permissions, accessProfile) {
  const forbidden = accessProfile === 'jam-guest'
    ? permissions.filter((permission) => ORIGINAL_MEDIA_PERMISSIONS.has(permission))
    : [];
  if (forbidden.length) {
    return {
      ok: false,
      code: 'access_profile_permission_conflict',
      message: 'J.A.M. guest devices cannot receive original-file stream or cache permissions.',
    };
  }
  return { ok: true };
}

function normalizeTrustedDevice(device = {}) {
  const id = safeString(device.id) || crypto.randomUUID();
  const createdAt = safeString(device.createdAt) || new Date().toISOString();
  const accessProfile = inferredDeviceAccessProfile(device);
  return {
    id,
    name: safeString(device.name, 'Trusted device'),
    tokenHash: safeString(device.tokenHash),
    tokenPreview: safeString(device.tokenPreview),
    permissions: permissionsForAccessProfile(normalizedPermissions(device.permissions), accessProfile),
    accessProfile,
    publicKey: safeString(device.publicKey),
    createdAt,
    lastSeenAt: safeString(device.lastSeenAt),
    revokedAt: safeString(device.revokedAt),
    expiresAt: safeString(device.expiresAt),
    pairingMethod: safeString(device.pairingMethod, 'manual'),
  };
}

function publicTrustedDevice(device = {}) {
  return {
    id: device.id,
    name: device.name,
    permissions: device.permissions,
    accessProfile: device.accessProfile || DEFAULT_DEVICE_ACCESS_PROFILE,
    originalStreamAccess: !device.revokedAt && device.accessProfile === DEFAULT_DEVICE_ACCESS_PROFILE && device.permissions?.includes('stream'),
    tokenPreview: device.tokenPreview,
    publicKey: device.publicKey || '',
    createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt || '',
    revokedAt: device.revokedAt || '',
    expiresAt: device.expiresAt || '',
    status: device.revokedAt ? 'revoked' : 'active',
    pairingMethod: device.pairingMethod || 'manual',
  };
}

function networkAddressScope(address) {
  const parts = String(address || '').split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return 'network';
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return 'private-vpn';
  if (parts[0] === 10) return 'private-network';
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return 'private-network';
  if (parts[0] === 192 && parts[1] === 168) return 'private-network';
  return 'network';
}

function localNetworkAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const [interfaceName, entries] of Object.entries(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal && entry.address) {
        addresses.push({
          address: entry.address,
          interfaceName,
          scope: networkAddressScope(entry.address),
        });
      }
    }
  }
  return addresses;
}

function preferredNetworkAddress() {
  const addresses = localNetworkAddresses();
  return addresses.find((entry) => entry.scope === 'private-vpn')?.address
    || addresses.find((entry) => entry.scope === 'private-network')?.address
    || addresses[0]?.address
    || DEFAULT_HOST;
}

function networkBaseUrls(port) {
  return localNetworkAddresses().map((entry) => ({
    ...entry,
    baseUrl: `http://${entry.address}:${port}`,
  }));
}

function networkScopeLabel(scope) {
  if (scope === 'private-vpn') return 'Private VPN';
  if (scope === 'private-network') return 'Private network';
  return 'Network';
}

function createPersonalServer(options = {}) {
  const appVersion = options.appVersion || '0.1.0';
  const platform = options.platform || process.platform;
  const maxPendingPairings = clampInteger(options.maxPendingPairings, MAX_PENDING_PAIRINGS, 1, 100);
  const pairingAttemptLimit = clampInteger(options.pairingAttemptLimit, PAIRING_ATTEMPT_LIMIT, 1, 1_000);
  const commandLimit = clampInteger(options.commandRateLimit, COMMAND_LIMIT, 1, 10_000);
  const identity = loadOrCreateHostIdentity({
    hostId: options.hostId,
    identityStorePath: options.identityStorePath,
    legacyDeviceStorePath: options.deviceStorePath,
  });
  const hostId = identity.hostId;
  const onRemoteCommand = typeof options.onRemoteCommand === 'function' ? options.onRemoteCommand : null;
  let ownerToken = '';
  const deviceStorePath = options.deviceStorePath || '';
  const trustedDevices = new Map();
  const pendingPairings = new Map();
  const requestWindows = new Map();
  const commandLog = [];
  const activeSockets = new Set();
  const activeMediaResponses = new Map();
  let snapshot = normalizeSnapshot({ hostName: os.hostname() });
  let snapshotRevision = 0;
  const revisions = {
    library: 0,
    playback: 0,
    queue: 0,
    favorites: 0,
    permissions: 0,
    deviceRefresh: 0,
    jam: 0,
  };
  let commandSequence = 0;
  let deviceRefreshSequence = 0;
  let latestDeviceRefresh = null;
  let jamSession = null;
  let jamQueueSequence = 0;
  let server = null;
  let stoppingPromise = null;
  let deviceStoreDirty = false;
  let deviceStoreFlushTimer = null;
  let status = {
    enabled: false,
    visibility: 'off',
    bindHost: DEFAULT_HOST,
    port: null,
    baseUrl: '',
    localBaseUrl: '',
    remoteBaseUrl: '',
    networkBaseUrls: [],
    startedAt: null,
    stoppedAt: null,
    lastError: identity.error,
    selfTest: null,
  };

  function revisionPayload() {
    return { overall: snapshotRevision, ...revisions };
  }

  function advanceRevisions(domains = []) {
    const changed = [...new Set(domains.filter((domain) => Object.hasOwn(revisions, domain)))];
    if (!changed.length) return false;
    snapshotRevision += 1;
    for (const domain of changed) revisions[domain] = snapshotRevision;
    return true;
  }

  function loadTrustedDevices() {
    if (!deviceStorePath) return;
    try {
      const raw = JSON.parse(fs.readFileSync(deviceStorePath, 'utf8'));
      const devices = Array.isArray(raw.devices) ? raw.devices : [];
      trustedDevices.clear();
      for (const device of devices.map(normalizeTrustedDevice).filter((item) => item.tokenHash)) {
        trustedDevices.set(device.id, device);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') status.lastError = error.message || String(error);
    }
  }

  function saveTrustedDevices() {
    if (deviceStoreFlushTimer) clearTimeout(deviceStoreFlushTimer);
    deviceStoreFlushTimer = null;
    if (!deviceStorePath) {
      deviceStoreDirty = false;
      return { ok: true, durable: false };
    }
    try {
      fs.mkdirSync(path.dirname(deviceStorePath), { recursive: true });
      fs.writeFileSync(deviceStorePath, JSON.stringify({
        version: 2,
        hostId,
        updatedAt: new Date().toISOString(),
        devices: [...trustedDevices.values()].map(publicDeviceRecordForStorage),
      }, null, 2));
      deviceStoreDirty = false;
      return { ok: true, durable: true };
    } catch (error) {
      status.lastError = error.message || String(error);
      return { ok: false, durable: false, code: 'device_store_write_failed', message: 'Trusted-device changes could not be saved.' };
    }
  }

  function flushTrustedDevices() {
    if (deviceStoreFlushTimer) clearTimeout(deviceStoreFlushTimer);
    deviceStoreFlushTimer = null;
    if (!deviceStoreDirty) return { ok: true, durable: Boolean(deviceStorePath) };
    return saveTrustedDevices();
  }

  function scheduleTrustedDeviceFlush() {
    deviceStoreDirty = true;
    if (!deviceStorePath || deviceStoreFlushTimer) return;
    deviceStoreFlushTimer = setTimeout(() => {
      deviceStoreFlushTimer = null;
      saveTrustedDevices();
    }, LAST_SEEN_FLUSH_MS);
    deviceStoreFlushTimer.unref?.();
  }

  function publicDeviceRecordForStorage(device) {
    return {
      id: device.id,
      name: device.name,
      tokenHash: device.tokenHash,
      tokenPreview: device.tokenPreview,
      permissions: device.permissions,
      accessProfile: device.accessProfile || DEFAULT_DEVICE_ACCESS_PROFILE,
      publicKey: device.publicKey || '',
      createdAt: device.createdAt,
      lastSeenAt: device.lastSeenAt || '',
      revokedAt: device.revokedAt || '',
      expiresAt: device.expiresAt || '',
      pairingMethod: device.pairingMethod || 'manual',
    };
  }

  loadTrustedDevices();

  function getTrack(id) {
    if (!id) return null;
    return snapshot.tracks.find((track) => track.publicId === id || track.id === id);
  }

  function networkDiagnosticsPayload() {
    const checkedAt = new Date().toISOString();
    const addresses = localNetworkAddresses();
    const isLan = status.enabled && status.visibility === 'lan';
    const hasPrivateNetwork = addresses.some((entry) => entry.scope === 'private-network');
    const hasPrivateVpn = addresses.some((entry) => entry.scope === 'private-vpn');
    const addressCandidates = [];
    if (status.enabled && status.localBaseUrl) {
      addressCandidates.push({
        label: 'This PC',
        scope: 'loopback',
        interfaceName: 'Loopback',
        address: '127.0.0.1',
        baseUrl: status.localBaseUrl,
        reachableFrom: ['desktop', 'android-emulator-adb-reverse'],
        note: 'Only this Windows session can reach this address directly.',
      });
    }
    if (status.enabled) {
      for (const entry of status.networkBaseUrls || []) {
        addressCandidates.push({
          ...entry,
          label: networkScopeLabel(entry.scope),
          reachableFrom: entry.scope === 'private-vpn'
            ? ['desktop', 'trusted-private-vpn-devices']
            : entry.scope === 'private-network'
              ? ['desktop', 'same-wifi-or-lan-devices']
              : ['desktop', 'unknown-network-devices'],
          note: entry.scope === 'private-vpn'
            ? 'Best candidate for trusted private VPN access.'
            : entry.scope === 'private-network'
              ? 'Use this for phones on the same Wi-Fi or LAN.'
              : 'Non-private IPv4 address detected; avoid sharing unless you understand this network.',
        });
      }
    } else {
      for (const entry of addresses) {
        addressCandidates.push({
          ...entry,
          label: networkScopeLabel(entry.scope),
          baseUrl: '',
          reachableFrom: [],
          note: 'Detected adapter. Start J.A.M. hosting to advertise a URL.',
        });
      }
    }
    const warnings = [];
    const nextSteps = [];
    if (!status.enabled) {
      nextSteps.push('Start the J.A.M. host before pairing another device.');
    } else if (status.visibility === 'localhost') {
      warnings.push({ level: 'info', code: 'localhost_only', message: 'Host is bound to this PC only; phones on Wi-Fi cannot reach it directly.' });
      nextSteps.push('Use private-network hosting for phones, or ADB reverse for an Android emulator.');
    } else if (isLan) {
      if (!hasPrivateNetwork && !hasPrivateVpn) {
        warnings.push({ level: 'warning', code: 'no_private_ipv4', message: 'LAN hosting is active, but no private IPv4 adapter was detected.' });
        nextSteps.push('Confirm Wi-Fi, Ethernet, or private VPN is connected before pairing.');
      }
      if (platform === 'win32') {
        warnings.push({ level: 'info', code: 'windows_firewall_private', message: 'Windows may prompt to allow Pixelody on private networks.' });
        nextSteps.push('If a phone cannot connect, allow Pixelody/Electron through Windows Firewall for Private networks.');
      }
      if (addresses.some((entry) => entry.scope === 'network')) {
        warnings.push({ level: 'warning', code: 'non_private_adapter', message: 'A non-private IPv4 adapter was detected while LAN hosting is active.' });
        nextSteps.push('Use the private Wi-Fi/VPN URL when possible and do not publish copied tokens.');
      }
    }
    return {
      checkedAt,
      platform,
      visibility: status.visibility,
      bindHost: status.bindHost,
      port: status.port,
      listening: Boolean(status.enabled),
      listeningOnAllInterfaces: status.enabled && status.bindHost === LAN_BIND_HOST,
      preferredBaseUrl: status.remoteBaseUrl || status.baseUrl || status.localBaseUrl || '',
      localBaseUrl: status.localBaseUrl || '',
      remoteBaseUrl: status.remoteBaseUrl || '',
      hasPrivateNetwork,
      hasPrivateVpn,
      addressCandidates,
      reachability: {
        thisPc: Boolean(status.enabled && status.localBaseUrl),
        androidEmulator: Boolean(status.enabled && status.localBaseUrl),
        sameWifiOrLan: Boolean(isLan && hasPrivateNetwork),
        privateVpn: Boolean(isLan && hasPrivateVpn),
      },
      firewall: {
        platform,
        status: platform === 'win32' && isLan ? 'allow-private-network-if-prompted' : 'not-required-for-current-mode',
        canDetectRuleInApp: false,
        guidance: platform === 'win32' && isLan
          ? 'If pairing or streaming fails from a phone, check Windows Security > Firewall & network protection and allow Pixelody on Private networks.'
          : 'No Windows LAN firewall action is needed for the current mode.',
      },
      warnings,
      nextSteps,
      riskLevel: !status.enabled ? 'off' : status.visibility === 'localhost' ? 'local-only' : warnings.some((item) => item.level === 'warning') ? 'check-network' : 'private-network',
    };
  }

  function statusPayload() {
    const devices = [...trustedDevices.values()].map(publicTrustedDevice);
    return {
      ...status,
      hostId,
      hostName: snapshot.hostName,
      token: status.enabled ? ownerToken : '',
      auth: status.enabled ? 'owner-or-device-token' : 'off',
      devices,
      activeDevices: devices.filter((device) => device.status === 'active').length,
      availableDevicePermissions: [...MANAGEABLE_DEVICE_PERMISSIONS],
      availableDeviceAccessProfiles: [DEFAULT_DEVICE_ACCESS_PROFILE, 'jam-guest'],
      deviceRefresh: latestDeviceRefresh,
      jamSession: jamSession ? jamSessionPayload({ kind: 'owner' }) : null,
      networkDiagnostics: networkDiagnosticsPayload(),
      revision: snapshotRevision,
      revisions: revisionPayload(),
      routes: status.enabled ? [
        `${API_PREFIX}/health`,
        `${API_PREFIX}/server-info`,
        `${API_PREFIX}/host/capabilities`,
        `${API_PREFIX}/devices`,
        `${API_PREFIX}/devices/refresh`,
        `${API_PREFIX}/pair/start`,
        `${API_PREFIX}/pair/complete`,
        `${API_PREFIX}/live`,
        `${API_PREFIX}/library/snapshot`,
        `${API_PREFIX}/library/tracks`,
        `${API_PREFIX}/commands/playback`,
        `${API_PREFIX}/commands/queue`,
        `${API_PREFIX}/commands/shuffle`,
        `${API_PREFIX}/jam/session`,
        `${API_PREFIX}/jam/session/join`,
        `${API_PREFIX}/jam/session/participants`,
        `${API_PREFIX}/jam/session/queue`,
        `${API_PREFIX}/jam/session/playback`,
        `${API_PREFIX}/jam/session/diagnostics`,
        `${API_PREFIX}/tracks/:id/stream`,
        `${API_PREFIX}/tracks/:id/artwork`,
      ] : [],
      snapshot: snapshotStats(snapshot),
    };
  }

  function serverInfo() {
    return {
      ok: true,
      name: 'Pixelody Personal Server',
      version: appVersion,
      apiVersion: 1,
      hostId,
      hostName: snapshot.hostName,
      platform,
      visibility: status.visibility,
      startedAt: status.startedAt,
      authRequired: true,
      publicInternetExposure: false,
    };
  }

  function capabilities() {
    return {
      hostId,
      hostName: snapshot.hostName,
      platform,
      roles: ['libraryHost', 'jamCoordinator', 'playbackDevice', 'controller'],
      visibility: status.visibility,
      canBackgroundHost: platform !== 'android',
      canImport: true,
      canEditMetadata: true,
      canStream: true,
      canRemoteControl: true,
      canJamCoordinate: true,
      auth: {
        trustedDevices: true,
        revocation: true,
        shortLivedPairing: true,
        deviceRefresh: true,
        permissionEditing: true,
        accessProfiles: true,
        jamGuestOriginalStreams: false,
        remoteRelay: false,
      },
      live: {
        polling: true,
        webSocket: false,
        endpoint: `${API_PREFIX}/live`,
        recommendedPollMs: 1000,
      },
      commands: {
        playback: `${API_PREFIX}/commands/playback`,
        queue: `${API_PREFIX}/commands/queue`,
        shuffle: `${API_PREFIX}/commands/shuffle`,
        version: flowShuffleContract.VERSION,
        permissions: ['playback:control', 'queue:write'],
      },
      jam: {
        personalLibrarySession: true,
        singleHostV1: true,
        endpoint: `${API_PREFIX}/jam/session`,
        federatedSources: false,
      },
      limits: {
        requiresForegroundService: false,
        batterySensitive: false,
        lanExposureEnabled: status.visibility === 'lan',
        maxLibrarySnapshotTracks: snapshot.tracks.length,
        maxPageSize: 250,
      },
    };
  }

  function findDeviceByToken(token) {
    if (!token) return null;
    const hash = tokenHash(token);
    for (const device of trustedDevices.values()) {
      if (device.tokenHash === hash) return device;
    }
    return null;
  }

  function consumeRequestWindow(key, limit, windowMs) {
    const now = Date.now();
    for (const [windowKey, value] of requestWindows) {
      if (value.resetAt <= now) requestWindows.delete(windowKey);
    }
    const current = requestWindows.get(key);
    if (!current || current.resetAt <= now) {
      requestWindows.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    current.count += 1;
    return current.count <= limit;
  }

  function authRateKey(auth, request, scope) {
    const identityKey = auth?.kind === 'device' ? auth.device.id : auth?.kind || request.socket?.remoteAddress || 'unknown';
    return `${scope}:${identityKey}`;
  }

  function authenticate(request, url) {
    const token = readToken(request, url);
    if (!token) return { ok: false, code: 'auth_required', message: 'A Pixelody sharing token is required.' };
    if (token && ownerToken && constantTimeEqual(token, ownerToken)) return { ok: true, kind: 'owner', permissions: ['owner'] };
    const device = findDeviceByToken(token);
    if (!device) return { ok: false, code: 'auth_invalid', message: 'The sharing credential is not valid.' };
    if (device.revokedAt) return { ok: false, code: 'auth_revoked', message: 'This trusted-device credential has been revoked.' };
    if (device.expiresAt && Date.parse(device.expiresAt) <= Date.now()) {
      return { ok: false, code: 'auth_expired', message: 'This trusted-device credential has expired.' };
    }
    device.lastSeenAt = new Date().toISOString();
    scheduleTrustedDeviceFlush();
    return { ok: true, kind: 'device', device, permissions: device.permissions };
  }

  function requireAuth(request, response, url) {
    const auth = authenticate(request, url);
    if (auth.ok) return auth;
    sendError(response, 401, auth.message, auth.code);
    return null;
  }

  function requireOwner(auth, response) {
    if (auth?.kind === 'owner') return true;
    sendError(response, 403, 'Owner approval is required for this action.', 'owner_required');
    return false;
  }

  function requirePermission(auth, response, permission) {
    if (auth?.kind === 'owner' || auth?.permissions?.includes(permission)) return true;
    sendError(response, 403, `Permission is required: ${permission}`, 'permission_required');
    return false;
  }

  function canReceiveOriginalStream(auth) {
    if (auth?.kind === 'owner') return true;
    return auth?.kind === 'device'
      && auth.device?.accessProfile === DEFAULT_DEVICE_ACCESS_PROFILE
      && auth.permissions?.includes('stream');
  }

  function requireOriginalStreamAccess(auth, response) {
    if (canReceiveOriginalStream(auth)) return true;
    if (auth?.kind === 'device' && auth.device?.accessProfile === 'jam-guest') {
      sendError(response, 403, 'J.A.M. guest devices cannot receive original-file streams.', 'original_stream_requires_personal_device');
      return false;
    }
    return requirePermission(auth, response, 'stream');
  }

  function trustedDevicesPayload() {
    return { devices: [...trustedDevices.values()].map(publicTrustedDevice) };
  }

  function normalizeJamPolicy(raw = {}) {
    return {
      guestsCanView: raw.guestsCanView !== false,
      guestsCanSuggest: raw.guestsCanSuggest !== false,
      guestsCanQueue: raw.guestsCanQueue === true,
      guestsCanEditQueue: raw.guestsCanEditQueue === true,
      guestsCanControlPlayback: raw.guestsCanControlPlayback === true,
      federatedSourcesEnabled: false,
      temporaryContributionCache: false,
    };
  }

  function jamPermissionsForPolicy(policy) {
    return [
      policy.guestsCanView && 'view',
      policy.guestsCanSuggest && 'suggest',
      policy.guestsCanQueue && 'add',
      policy.guestsCanEditQueue && 'editQueue',
      policy.guestsCanControlPlayback && 'controlPlayback',
    ].filter(Boolean);
  }

  function jamParticipantFor(auth) {
    if (!jamSession) return null;
    if (auth.kind === 'owner') return jamSession.participants.find((item) => item.deviceId === hostId) || null;
    return jamSession.participants.find((item) => item.deviceId === auth.device?.id) || null;
  }

  function publicJamParticipant(participant) {
    const trusted = trustedDevices.get(participant.deviceId);
    return {
      deviceId: participant.deviceId,
      name: participant.deviceId === hostId ? snapshot.hostName : trusted?.name || participant.name || 'Trusted device',
      role: participant.role,
      status: trusted?.revokedAt ? 'revoked' : participant.status,
      permissions: participant.permissions,
      requestedAt: participant.requestedAt || '',
      approvedAt: participant.approvedAt || '',
      lastSeenAt: participant.deviceId === hostId ? jamSession.updatedAt : trusted?.lastSeenAt || '',
    };
  }

  function jamQueueItem(track, addedByDeviceId, playbackStatus = 'queued') {
    const available = Boolean(track?.path && !track.missing && fs.existsSync(track.path));
    return {
      queueItemId: `jamq_${++jamQueueSequence}_${randomToken(6)}`,
      trackId: track?.publicId || '',
      title: track?.title || 'Unavailable track',
      artist: track?.artist || '',
      addedByDeviceId,
      sourceDeviceId: hostId,
      sourceLibraryId: `${hostId}:library`,
      availability: available ? 'available' : 'unavailable',
      cacheState: 'host-owned',
      cacheExpiresAt: null,
      playbackStatus,
      fallbackCandidates: [],
      diagnostic: available ? '' : 'The host-owned source is missing or unavailable.',
    };
  }

  function jamDiagnostics() {
    if (!jamSession) return { active: false, lastIssue: '', recommendedAction: 'start-session' };
    const revoked = jamSession.participants.filter((item) => publicJamParticipant(item).status === 'revoked').length;
    const unavailable = jamSession.queue.filter((item) => item.availability !== 'available').length;
    return {
      active: true,
      sessionRevision: revisions.jam,
      participantCount: jamSession.participants.length,
      pendingParticipants: jamSession.participants.filter((item) => item.status === 'pending').length,
      revokedParticipants: revoked,
      unavailableQueueItems: unavailable,
      lastIssue: unavailable ? 'One or more host-owned queue items are unavailable.' : revoked ? 'A participant no longer has trusted-device access.' : '',
      recommendedAction: unavailable ? 'Remove or replace unavailable host tracks.' : revoked ? 'Remove the revoked participant or pair it again.' : 'none',
      lastRefreshId: latestDeviceRefresh?.id || '',
      lastRefreshAt: latestDeviceRefresh?.requestedAt || '',
    };
  }

  function jamSessionPayload(auth) {
    if (!jamSession) return { ok: true, version: 1, active: false, session: null, diagnostics: jamDiagnostics() };
    const participant = jamParticipantFor(auth);
    const owner = auth.kind === 'owner';
    const canView = owner || (participant?.status === 'active' && participant.permissions.includes('view'));
    if (!canView) return { ok: false, code: participant?.status === 'pending' ? 'jam_approval_pending' : 'jam_permission_required', message: participant?.status === 'pending' ? 'J.A.M. participation is waiting for owner approval.' : 'This device cannot view the active J.A.M. session.' };
    return {
      ok: true,
      version: 1,
      active: true,
      sessionId: jamSession.sessionId,
      mode: 'single-host',
      status: jamSession.status,
      createdAt: jamSession.createdAt,
      updatedAt: jamSession.updatedAt,
      roles: {
        libraryHostDeviceId: hostId,
        coordinatorDeviceId: hostId,
        playbackDeviceId: hostId,
      },
      authority: {
        version: flowShuffleContract.VERSION,
        playback: 'desktop-host',
        queue: 'desktop-host-serialized',
        shuffle: 'desktop-host',
        simultaneousCommands: 'server-command-order',
      },
      permissions: jamSession.policy,
      currentParticipant: participant ? publicJamParticipant(participant) : null,
      participants: jamSession.participants.map(publicJamParticipant),
      queue: jamSession.queue,
      revision: snapshotRevision,
      revisions: revisionPayload(),
      diagnostics: jamDiagnostics(),
    };
  }

  function startJamSession(options = {}) {
    if (!status.enabled) return { ok: false, active: false, code: 'host_not_running', message: 'Start the private Pixelody host before starting a J.A.M. session.' };
    if (jamSession?.status === 'active') return { ...jamSessionPayload({ kind: 'owner' }), unchanged: true };
    const now = new Date().toISOString();
    const policy = normalizeJamPolicy(options.permissions || options.guestPolicy || {});
    const idMap = publicIdMap(snapshot);
    const currentPublicId = idMap.get(snapshot.playback?.currentTrackId) || '';
    jamSession = {
      sessionId: `jam_${crypto.randomUUID()}`,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      policy,
      participants: [{ deviceId: hostId, name: snapshot.hostName, role: 'owner', status: 'active', permissions: JAM_PERMISSION_KEYS, requestedAt: now, approvedAt: now }],
      queue: snapshot.queue.map((privateId) => {
        const track = snapshot.tracks.find((item) => item.id === privateId);
        return jamQueueItem(track, hostId, track?.publicId === currentPublicId ? 'playing' : 'queued');
      }),
    };
    advanceRevisions(['jam']);
    return jamSessionPayload({ kind: 'owner' });
  }

  function stopJamSession(auth = { kind: 'owner' }) {
    if (!jamSession) return { ok: true, active: false, unchanged: true, stoppedAt: new Date().toISOString() };
    const stopped = { sessionId: jamSession.sessionId, stoppedAt: new Date().toISOString(), participantCount: jamSession.participants.length, queueItemsCleared: jamSession.queue.length };
    jamSession = null;
    advanceRevisions(['jam']);
    if (onRemoteCommand) commandAcceptedPayload('jam-stopped', stopped, auth);
    return { ok: true, active: false, ...stopped };
  }

  function requestJamJoin(auth, options = {}) {
    if (!jamSession) return { ok: false, code: 'jam_not_active', message: 'No J.A.M. session is active.' };
    if (auth.kind !== 'device') return jamSessionPayload(auth);
    let participant = jamParticipantFor(auth);
    if (!participant) {
      participant = {
        deviceId: auth.device.id,
        name: auth.device.name,
        role: ['guest', 'controller'].includes(safeString(options.role)) ? safeString(options.role) : 'guest',
        status: 'pending',
        permissions: [],
        requestedAt: new Date().toISOString(),
        approvedAt: '',
      };
      jamSession.participants.push(participant);
      jamSession.updatedAt = new Date().toISOString();
      advanceRevisions(['jam']);
    }
    return { ok: true, accepted: true, participant: publicJamParticipant(participant), approvalRequired: participant.status === 'pending' };
  }

  function approveJamParticipant(deviceId, options = {}) {
    if (!jamSession) return { ok: false, code: 'jam_not_active', message: 'No J.A.M. session is active.' };
    const participant = jamSession.participants.find((item) => item.deviceId === safeString(deviceId));
    if (!participant || participant.deviceId === hostId) return { ok: false, code: 'jam_participant_not_found', message: 'J.A.M. participant was not found.' };
    const requested = Array.isArray(options.permissions) ? options.permissions.map(safeString) : jamPermissionsForPolicy(jamSession.policy);
    const invalid = requested.filter((permission) => !JAM_PERMISSION_KEYS.includes(permission));
    if (invalid.length) return { ok: false, code: 'jam_permissions_invalid', message: 'One or more J.A.M. permissions are unsupported.' };
    participant.role = ['guest', 'controller'].includes(safeString(options.role)) ? safeString(options.role) : participant.role;
    participant.permissions = [...new Set(requested)];
    participant.status = options.approved === false ? 'denied' : 'active';
    participant.approvedAt = new Date().toISOString();
    jamSession.updatedAt = participant.approvedAt;
    advanceRevisions(['jam']);
    return { ok: true, participant: publicJamParticipant(participant), session: jamSessionPayload({ kind: 'owner' }) };
  }

  function removeJamParticipant(deviceId) {
    if (!jamSession) return { ok: false, code: 'jam_not_active', message: 'No J.A.M. session is active.' };
    const index = jamSession.participants.findIndex((item) => item.deviceId === safeString(deviceId) && item.deviceId !== hostId);
    if (index < 0) return { ok: false, code: 'jam_participant_not_found', message: 'J.A.M. participant was not found.' };
    const [removed] = jamSession.participants.splice(index, 1);
    jamSession.updatedAt = new Date().toISOString();
    advanceRevisions(['jam']);
    return { ok: true, removed: publicJamParticipant(removed), session: jamSessionPayload({ kind: 'owner' }) };
  }

  function requireJamPermission(auth, permission) {
    if (auth.kind === 'owner') return true;
    const participant = jamParticipantFor(auth);
    return Boolean(participant?.status === 'active' && participant.permissions.includes(permission));
  }

  function mutateJamQueue(auth, body = {}) {
    if (!jamSession) throw Object.assign(new Error('No J.A.M. session is active.'), { statusCode: 409, code: 'jam_not_active' });
    const action = safeString(body.action, 'add').toLowerCase();
    const permission = ['suggest'].includes(action) ? 'suggest' : ['add', 'addtrack'].includes(action) ? 'add' : 'editQueue';
    if (!requireJamPermission(auth, permission)) throw Object.assign(new Error(`J.A.M. permission is required: ${permission}`), { statusCode: 403, code: 'jam_permission_required' });
    if (['suggest', 'add', 'addtrack'].includes(action)) {
      if (safeString(body.sourceDeviceId) && safeString(body.sourceDeviceId) !== hostId) throw Object.assign(new Error('Single-host J.A.M. accepts only coordinator-owned tracks.'), { statusCode: 409, code: 'federated_source_not_supported' });
      const track = getTrack(safeString(body.trackId || body.publicTrackId));
      if (!track) throw Object.assign(new Error('Host-owned track was not found.'), { statusCode: 404, code: 'track_not_found' });
      const item = jamQueueItem(track, auth.kind === 'owner' ? hostId : auth.device.id, action === 'suggest' ? 'suggested' : 'queued');
      jamSession.queue.push(item);
      if (action !== 'suggest') commandAcceptedPayload('queue', { action: 'addtrack', publicTrackId: track.publicId, trackId: track.id, jamQueueItemId: item.queueItemId }, auth);
    } else if (action === 'remove' || action === 'removetrack') {
      const index = jamSession.queue.findIndex((item) => item.queueItemId === safeString(body.queueItemId));
      if (index < 0) throw Object.assign(new Error('J.A.M. queue item was not found.'), { statusCode: 404, code: 'jam_queue_item_not_found' });
      const [item] = jamSession.queue.splice(index, 1);
      commandAcceptedPayload('queue', { action: 'removetrack', publicTrackId: item.trackId, trackId: getTrack(item.trackId)?.id || '', jamQueueItemId: item.queueItemId }, auth);
    } else if (action === 'move' || action === 'movetrack') {
      const index = jamSession.queue.findIndex((item) => item.queueItemId === safeString(body.queueItemId));
      const toIndex = clampInteger(body.toIndex, -1, 0, Math.max(0, jamSession.queue.length - 1));
      if (index < 0 || toIndex < 0) throw Object.assign(new Error('Move requires a valid queue item and destination.'), { statusCode: 400, code: 'invalid_queue_index' });
      const [item] = jamSession.queue.splice(index, 1);
      jamSession.queue.splice(toIndex, 0, item);
      commandAcceptedPayload('queue', { action: 'movetrack', publicTrackId: item.trackId, trackId: getTrack(item.trackId)?.id || '', toIndex, jamQueueItemId: item.queueItemId }, auth);
    } else if (action === 'clear') {
      jamSession.queue = [];
      commandAcceptedPayload('queue', { action: 'clear' }, auth);
    } else {
      throw Object.assign(new Error('Unsupported J.A.M. queue action.'), { statusCode: 400, code: 'unsupported_jam_queue_action' });
    }
    jamSession.updatedAt = new Date().toISOString();
    advanceRevisions(['jam', 'queue']);
    return jamSessionPayload(auth);
  }

  function reconcileJamQueue(nextSnapshot) {
    if (!jamSession) return false;
    const previous = jamSession.queue;
    const used = new Set();
    const currentPublicId = nextSnapshot.tracks.find((track) => track.id === nextSnapshot.playback?.currentTrackId)?.publicId || '';
    const queued = nextSnapshot.queue.map((privateId) => {
      const track = nextSnapshot.tracks.find((item) => item.id === privateId);
      const existingIndex = previous.findIndex((item, index) => !used.has(index) && item.trackId === track?.publicId && item.playbackStatus !== 'suggested');
      if (existingIndex >= 0) {
        used.add(existingIndex);
        const existing = previous[existingIndex];
        const available = Boolean(track?.path && !track.missing && fs.existsSync(track.path));
        return { ...existing, title: track?.title || existing.title, artist: track?.artist || existing.artist, availability: available ? 'available' : 'unavailable', playbackStatus: track?.publicId === currentPublicId ? 'playing' : 'queued', diagnostic: available ? '' : 'The host-owned source is missing or unavailable.' };
      }
      return jamQueueItem(track, hostId, track?.publicId === currentPublicId ? 'playing' : 'queued');
    });
    const suggestions = previous.filter((item) => item.playbackStatus === 'suggested');
    jamSession.queue = [...queued, ...suggestions];
    const changed = jsonFingerprint(previous) !== jsonFingerprint(jamSession.queue);
    if (changed) jamSession.updatedAt = new Date().toISOString();
    return changed;
  }

  function publicPlayback(idMap) {
    const paused = snapshot.playback?.paused === true || snapshot.playback?.playing === false;
    const checkedAtMs = Date.now();
    const currentTime = playbackPositionAt(snapshot.playback, checkedAtMs);
    const duration = Number(snapshot.playback?.duration ?? snapshot.playback?.durationSeconds ?? 0) || 0;
    const positionUpdatedAt = new Date(checkedAtMs).toISOString();
    const estimatedStartedAt = safeString(snapshot.playback?.estimatedStartedAt)
      || (!paused && currentTime >= 0 ? new Date(checkedAtMs - currentTime * 1000).toISOString() : '');
    return {
      ...snapshot.playback,
      currentTrackId: snapshot.playback?.currentTrackId ? idMap.get(snapshot.playback.currentTrackId) || null : null,
      playing: snapshot.playback?.playing === true || (!paused && Boolean(snapshot.playback?.currentTrackId)),
      paused,
      currentTime,
      positionSeconds: currentTime,
      duration,
      durationSeconds: duration,
      positionUpdatedAt,
      estimatedStartedAt,
    };
  }

  function networkSessionPayload(auth, idMap, checkedAt) {
    const playback = publicPlayback(idMap);
    const currentPrivateId = safeString(snapshot.playback?.currentTrackId);
    const currentIndex = currentPrivateId ? snapshot.queue.indexOf(currentPrivateId) : -1;
    const upcomingPrivateIds = snapshot.queue
      .slice(currentIndex >= 0 ? currentIndex + 1 : 0)
      .filter((id) => id !== currentPrivateId)
      .slice(0, 10);
    const currentTrack = publicTrackSummary(snapshot.tracks.find((track) => track.id === currentPrivateId));
    const upcomingTracks = upcomingPrivateIds
      .map((id) => publicTrackSummary(snapshot.tracks.find((track) => track.id === id)))
      .filter(Boolean);
    return {
      kind: jamSession ? 'jam-single-host' : 'personal-library',
      sessionId: jamSession?.sessionId || `${hostId}:personal-library`,
      host: {
        id: hostId,
        name: snapshot.hostName,
        platform,
        visibility: status.visibility,
        roles: ['libraryHost', ...(jamSession ? ['jamCoordinator'] : []), 'playbackDevice', 'controller'],
      },
      auth: {
        kind: auth.kind,
        permissions: auth.kind === 'owner' ? ['owner'] : auth.permissions || [],
        accessProfile: auth.kind === 'owner' ? 'owner' : auth.device?.accessProfile || '',
        originalStreamAccess: canReceiveOriginalStream(auth),
      },
      sync: {
        revision: snapshotRevision,
        revisions: revisionPayload(),
        generatedAt: snapshot.generatedAt,
        checkedAt,
        pollAfterMs: 1000,
      },
      playback: {
        ...playback,
        state: playback.playing ? 'playing' : 'paused',
        currentTrack,
        elapsedSeconds: playback.positionSeconds,
        positionUpdatedAt: playback.positionUpdatedAt,
        estimatedStartedAt: playback.estimatedStartedAt,
      },
      shuffle: flowShuffleContract.publicSnapshot(snapshot.flowShuffle, (id) => idMap.get(id) || ''),
      queue: {
        trackIds: publicTrackIds(snapshot.queue, idMap),
        currentIndex,
        upcomingTrackIds: publicTrackIds(upcomingPrivateIds, idMap),
        upcomingTracks,
      },
      diagnostics: {
        activeDevices: [...trustedDevices.values()].filter((device) => !device.revokedAt).length,
        lastError: status.lastError || '',
        recentCommandCount: commandLog.length,
        jam: jamDiagnostics(),
      },
    };
  }

  function liveStatePayload(auth) {
    const idMap = publicIdMap(snapshot);
    const checkedAt = new Date().toISOString();
    const networkSession = networkSessionPayload(auth, idMap, checkedAt);
    return {
      ok: true,
      version: 1,
      revision: snapshotRevision,
      revisions: revisionPayload(),
      hostId,
      hostName: snapshot.hostName,
      visibility: status.visibility,
      generatedAt: snapshot.generatedAt,
      checkedAt,
      pollAfterMs: 1000,
      auth: {
        kind: auth.kind,
        permissions: auth.kind === 'owner' ? ['owner'] : auth.permissions || [],
      },
      snapshot: snapshotStats(snapshot),
      playback: publicPlayback(idMap),
      shuffle: flowShuffleContract.publicSnapshot(snapshot.flowShuffle, (id) => idMap.get(id) || ''),
      queue: publicTrackIds(snapshot.queue, idMap),
      networkSession,
      jamSession: jamSession ? jamSessionPayload(auth) : null,
      favorites: publicTrackIds(snapshot.favorites, idMap),
      devices: auth.kind === 'owner' ? trustedDevicesPayload().devices : undefined,
      deviceRefresh: latestDeviceRefresh,
      recentCommands: auth.kind === 'owner' ? commandLog.slice(-12) : undefined,
    };
  }

  function requestedRevision(url) {
    const value = Number(url.searchParams.get('sinceRevision'));
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  function unchangedPayload() {
    return {
      ok: true,
      unchanged: true,
      revision: snapshotRevision,
      revisions: revisionPayload(),
      checkedAt: new Date().toISOString(),
      pollAfterMs: 1000,
    };
  }

  function pagedTracksPayload(url, options = {}) {
    const offset = clampInteger(url.searchParams.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = clampInteger(url.searchParams.get('limit'), 100, 1, 250);
    const query = safeString(url.searchParams.get('q')).toLocaleLowerCase();
    const playlistId = safeString(url.searchParams.get('playlistId'));
    let sourceTracks = snapshot.tracks;
    if (playlistId) {
      const playlist = snapshot.playlists.find((item) => item.id === playlistId);
      if (playlist) {
        const ids = new Set(playlist.trackIds);
        sourceTracks = snapshot.tracks.filter((track) => ids.has(track.id));
      } else {
        sourceTracks = [];
      }
    }
    if (query) {
      sourceTracks = sourceTracks.filter((track) => `${track.title} ${track.artist} ${track.album} ${track.format}`.toLocaleLowerCase().includes(query));
    }
    const page = sourceTracks.slice(offset, offset + limit).map((track) => publicTrack(track, options));
    return {
      revision: snapshotRevision,
      revisions: revisionPayload(),
      tracks: page,
      page: {
        offset,
        limit,
        returned: page.length,
        total: sourceTracks.length,
        nextOffset: offset + page.length < sourceTracks.length ? offset + page.length : null,
      },
    };
  }

  function authSummary(auth) {
    return {
      kind: auth.kind,
      deviceId: auth.device?.id || '',
      deviceName: auth.device?.name || '',
      permissions: auth.kind === 'owner' ? ['owner'] : auth.permissions || [],
    };
  }

  function commandAcceptedPayload(type, payload, auth) {
    const command = {
      id: `cmd_${++commandSequence}`,
      type,
      version: flowShuffleContract.VERSION,
      receivedAt: new Date().toISOString(),
      auth: authSummary(auth),
      payload,
    };
    commandLog.push({
      id: command.id,
      type,
      receivedAt: command.receivedAt,
      deviceId: command.auth.deviceId,
      action: payload.action || payload.command || '',
      trackId: payload.publicTrackId || '',
    });
    while (commandLog.length > 50) commandLog.shift();
    if (onRemoteCommand) onRemoteCommand(command);
    return {
      ok: true,
      accepted: true,
      commandId: command.id,
      commandVersion: flowShuffleContract.VERSION,
      receivedAt: command.receivedAt,
      note: onRemoteCommand ? 'Command sent to the active Pixelody renderer.' : 'Command accepted by the host API; no renderer bridge is attached in this context.',
    };
  }

  function playbackCommandPayload(body = {}) {
    const action = safeString(body.action || body.command).toLowerCase();
    const allowed = new Set(['play', 'pause', 'toggle', 'next', 'previous', 'seek', 'playtrack']);
    if (!allowed.has(action)) {
      throw Object.assign(new Error('Unsupported playback command.'), { statusCode: 400, code: 'unsupported_playback_command' });
    }
    const payload = { action };
    if (action === 'seek') {
      const seconds = Number(body.seconds ?? body.currentTime);
      if (!Number.isFinite(seconds) || seconds < 0) throw Object.assign(new Error('Seek command requires a non-negative seconds value.'), { statusCode: 400, code: 'invalid_seek_time' });
      payload.seconds = seconds;
    }
    if (action === 'playtrack') {
      const publicTrackId = safeString(body.trackId || body.publicTrackId);
      const track = getTrack(publicTrackId);
      if (!track) throw Object.assign(new Error('Track was not found for playback command.'), { statusCode: 404, code: 'track_not_found' });
      payload.publicTrackId = track.publicId;
      payload.trackId = track.id;
    }
    return payload;
  }

  function queueCommandPayload(body = {}) {
    const action = safeString(body.action || body.command).toLowerCase();
    const allowed = new Set(['addtrack', 'removetrack', 'movetrack', 'clear']);
    if (!allowed.has(action)) {
      throw Object.assign(new Error('Unsupported queue command.'), { statusCode: 400, code: 'unsupported_queue_command' });
    }
    const payload = { action };
    if (action !== 'clear') {
      const publicTrackId = safeString(body.trackId || body.publicTrackId);
      const track = getTrack(publicTrackId);
      if (!track) throw Object.assign(new Error('Track was not found for queue command.'), { statusCode: 404, code: 'track_not_found' });
      payload.publicTrackId = track.publicId;
      payload.trackId = track.id;
    }
    if (action === 'movetrack') {
      payload.toIndex = clampInteger(body.toIndex, -1, 0, 100_000);
      if (payload.toIndex < 0) throw Object.assign(new Error('Move command requires a valid toIndex.'), { statusCode: 400, code: 'invalid_queue_index' });
    }
    return payload;
  }

  function shuffleCommandPayload(body = {}) { return flowShuffleContract.commandPayload(body); }

  function createTrustedDevice(options = {}) {
    const permissionResult = validatedPermissions(options.permissions);
    if (!permissionResult.ok) return { ...permissionResult, devices: trustedDevicesPayload().devices };
    const profileResult = validatedDeviceAccessProfile(options.accessProfile);
    if (!profileResult.ok) return { ...profileResult, devices: trustedDevicesPayload().devices };
    const compatibility = validateProfilePermissions(permissionResult.permissions, profileResult.accessProfile);
    if (!compatibility.ok) return { ...compatibility, devices: trustedDevicesPayload().devices };
    const token = `${DEVICE_TOKEN_PREFIX}${randomToken(30)}`;
    const preview = `${token.slice(0, 7)}...${token.slice(-5)}`;
    const device = normalizeTrustedDevice({
      id: options.id || crypto.randomUUID(),
      name: safeString(options.name, 'Trusted device'),
      tokenHash: tokenHash(token),
      tokenPreview: preview,
      permissions: permissionResult.permissions,
      accessProfile: profileResult.accessProfile,
      publicKey: safeString(options.publicKey),
      expiresAt: safeString(options.expiresAt),
      pairingMethod: safeString(options.pairingMethod, 'manual'),
    });
    trustedDevices.set(device.id, device);
    const stored = saveTrustedDevices();
    if (!stored.ok) {
      trustedDevices.delete(device.id);
      return { ...stored, devices: trustedDevicesPayload().devices };
    }
    advanceRevisions(['permissions']);
    return { ok: true, durable: stored.durable, device: publicTrustedDevice(device), token, auth: 'trusted-device-token' };
  }

  function revokeTrustedDevice(deviceId) {
    const device = trustedDevices.get(safeString(deviceId));
    if (!device) return { ok: false, code: 'device_not_found', message: 'Trusted device was not found.', devices: trustedDevicesPayload().devices };
    const previousRevokedAt = device.revokedAt;
    device.revokedAt = device.revokedAt || new Date().toISOString();
    if (previousRevokedAt) return { ok: true, durable: Boolean(deviceStorePath), device: publicTrustedDevice(device), devices: trustedDevicesPayload().devices };
    const stored = saveTrustedDevices();
    if (!stored.ok) {
      device.revokedAt = previousRevokedAt;
      return { ...stored, devices: trustedDevicesPayload().devices };
    }
    closeUnauthorizedMedia(device.id);
    const domains = ['permissions'];
    if (jamSession?.participants.some((item) => item.deviceId === device.id)) domains.push('jam');
    advanceRevisions(domains);
    return { ok: true, durable: stored.durable, device: publicTrustedDevice(device), devices: trustedDevicesPayload().devices };
  }

  function deleteTrustedDevice(deviceId) {
    const id = safeString(deviceId);
    const device = trustedDevices.get(id);
    if (!device) return { ok: false, code: 'device_not_found', message: 'Trusted device was not found.', devices: trustedDevicesPayload().devices };
    trustedDevices.delete(id);
    const stored = saveTrustedDevices();
    if (!stored.ok) {
      trustedDevices.set(id, device);
      return { ...stored, devices: trustedDevicesPayload().devices };
    }
    closeUnauthorizedMedia(id);
    const domains = ['permissions'];
    if (jamSession) {
      const participantIndex = jamSession.participants.findIndex((item) => item.deviceId === id);
      if (participantIndex >= 0) {
        jamSession.participants.splice(participantIndex, 1);
        jamSession.updatedAt = new Date().toISOString();
        domains.push('jam');
      }
    }
    advanceRevisions(domains);
    return { ok: true, durable: stored.durable, deletedDeviceId: id, devices: trustedDevicesPayload().devices };
  }

  function updateTrustedDeviceAccess(deviceId, options = {}) {
    const device = trustedDevices.get(safeString(deviceId));
    if (!device) return { ok: false, code: 'device_not_found', message: 'Trusted device was not found.', devices: trustedDevicesPayload().devices };
    if (device.revokedAt) return { ok: false, code: 'device_revoked', message: 'Revoked devices cannot be edited.', devices: trustedDevicesPayload().devices };
    const profileResult = options.accessProfile === undefined
      ? { ok: true, accessProfile: device.accessProfile }
      : validatedDeviceAccessProfile(options.accessProfile);
    if (!profileResult.ok) return { ...profileResult, devices: trustedDevicesPayload().devices };
    const permissionResult = options.permissions === undefined
      ? { ok: true, permissions: [...device.permissions] }
      : validatedPermissions(options.permissions);
    if (!permissionResult.ok) return { ...permissionResult, devices: trustedDevicesPayload().devices };
    const switchingToGuest = device.accessProfile !== 'jam-guest' && profileResult.accessProfile === 'jam-guest' && options.permissions === undefined;
    const nextPermissions = switchingToGuest
      ? permissionsForAccessProfile(permissionResult.permissions, profileResult.accessProfile)
      : permissionResult.permissions;
    const compatibility = validateProfilePermissions(nextPermissions, profileResult.accessProfile);
    if (!compatibility.ok) return { ...compatibility, devices: trustedDevicesPayload().devices };
    const previousPermissions = device.permissions;
    const previousAccessProfile = device.accessProfile;
    device.permissions = nextPermissions;
    device.accessProfile = profileResult.accessProfile;
    if (jsonFingerprint(previousPermissions) === jsonFingerprint(device.permissions) && previousAccessProfile === device.accessProfile) {
      return { ok: true, unchanged: true, durable: Boolean(deviceStorePath), device: publicTrustedDevice(device), devices: trustedDevicesPayload().devices };
    }
    const stored = saveTrustedDevices();
    if (!stored.ok) {
      device.permissions = previousPermissions;
      device.accessProfile = previousAccessProfile;
      return { ...stored, devices: trustedDevicesPayload().devices };
    }
    closeUnauthorizedMedia(device.id);
    advanceRevisions(['permissions']);
    return { ok: true, durable: stored.durable, device: publicTrustedDevice(device), devices: trustedDevicesPayload().devices };
  }

  function updateTrustedDevicePermissions(deviceId, permissions) {
    return updateTrustedDeviceAccess(deviceId, { permissions });
  }

  function requestDeviceRefresh(options = {}, auth = { kind: 'owner' }) {
    const reason = safeString(options.reason, 'Trusted-device soft refresh').slice(0, 180);
    const scope = ['jam', 'trusted-devices', 'all'].includes(safeString(options.scope)) ? safeString(options.scope) : 'jam';
    latestDeviceRefresh = {
      id: `refresh_${++deviceRefreshSequence}`,
      action: 'soft-refresh',
      scope,
      reason,
      requestedAt: new Date().toISOString(),
      requestedBy: authSummary(auth),
    };
    advanceRevisions(['deviceRefresh']);
    const accepted = commandAcceptedPayload('device-refresh', latestDeviceRefresh, auth);
    return {
      ...accepted,
      refresh: latestDeviceRefresh,
      devices: auth.kind === 'owner' ? trustedDevicesPayload().devices : undefined,
    };
  }

  function startPairing(options = {}) {
    const now = Date.now();
    for (const [code, pairing] of pendingPairings) {
      if (Date.parse(pairing.expiresAt) <= now) pendingPairings.delete(code);
    }
    if (pendingPairings.size >= maxPendingPairings) {
      return { ok: false, code: 'pairing_capacity', message: 'Too many pairing requests are already pending. Wait for one to expire.' };
    }
    const permissionResult = validatedPermissions(options.permissions);
    if (!permissionResult.ok) return permissionResult;
    const profileResult = validatedDeviceAccessProfile(options.accessProfile);
    if (!profileResult.ok) return profileResult;
    const compatibility = validateProfilePermissions(permissionResult.permissions, profileResult.accessProfile);
    if (!compatibility.ok) return compatibility;
    let pairingCode = randomDigits();
    while (pendingPairings.has(pairingCode)) pairingCode = randomDigits();
    const secret = randomToken(18);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const pairing = {
      pairingCode,
      secret,
      deviceName: safeString(options.deviceName, 'Trusted device'),
      permissions: permissionResult.permissions,
      accessProfile: profileResult.accessProfile,
      expiresAt,
      createdAt: new Date().toISOString(),
    };
    pendingPairings.set(pairingCode, pairing);
    return {
      ok: true,
      pairingCode,
      secret,
      expiresAt,
      permissions: pairing.permissions,
      accessProfile: pairing.accessProfile,
      pairingPayload: {
        version: 1,
        hostId,
        hostName: snapshot.hostName,
        baseUrl: status.baseUrl,
        remoteBaseUrl: status.remoteBaseUrl || '',
        baseUrls: [status.remoteBaseUrl, status.baseUrl, ...status.networkBaseUrls.map((entry) => entry.baseUrl), status.localBaseUrl].filter(Boolean),
        pairingCode,
        secret,
        expiresAt,
        permissions: pairing.permissions,
        accessProfile: pairing.accessProfile,
      },
    };
  }

  function completePairing(options = {}) {
    const pairingCode = safeString(options.pairingCode);
    const now = Date.now();
    for (const [code, candidate] of pendingPairings) {
      if (Date.parse(candidate.expiresAt) <= now && code !== pairingCode) pendingPairings.delete(code);
    }
    const pairing = pendingPairings.get(pairingCode);
    if (!pairing) return { ok: false, code: 'pairing_not_found', message: 'Pairing code was not found or has expired.' };
    if (Date.parse(pairing.expiresAt) < Date.now()) {
      pendingPairings.delete(pairingCode);
      return { ok: false, code: 'pairing_expired', message: 'Pairing code has expired.' };
    }
    if (!constantTimeEqual(safeString(options.secret), pairing.secret)) {
      return { ok: false, code: 'pairing_secret_invalid', message: 'Pairing secret was invalid.' };
    }
    pendingPairings.delete(pairingCode);
    return createTrustedDevice({
      name: safeString(options.deviceName, pairing.deviceName),
      permissions: pairing.permissions,
      accessProfile: pairing.accessProfile,
      publicKey: safeString(options.publicKey),
      pairingMethod: 'short-code',
    });
  }

  function closeUnauthorizedMedia(deviceId) {
    const device = trustedDevices.get(deviceId);
    for (const [response, transfer] of activeMediaResponses) {
      if (transfer.deviceId !== deviceId) continue;
      const allowed = device && !device.revokedAt
        && device.permissions.includes(transfer.permission)
        && (transfer.permission !== 'stream' || device.accessProfile === DEFAULT_DEVICE_ACCESS_PROFILE);
      if (!allowed) response.destroy();
    }
  }

  async function sendFile(request, response, filePath, typeHint = '', auth, permission) {
    // Register before filesystem I/O so revocation during stat also cancels the response.
    activeMediaResponses.set(response, { deviceId: auth?.device?.id, permission });
    let stream;
    response.once('close', () => {
      activeMediaResponses.delete(response);
      stream?.destroy();
    });
    let stat;
    try {
      stat = await fsp.stat(filePath);
      if (!stat.isFile()) throw new Error('not a file');
    } catch {
      if (response.destroyed) return;
      sendError(response, 404, 'Media is unavailable.', 'media_unavailable');
      return;
    }
    if (response.destroyed) return;
    const range = parseRange(request.headers.range, stat.size);
    if (range?.invalid) {
      response.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      response.end();
      return;
    }
    const start = range ? range.start : 0;
    const end = range ? range.end : stat.size - 1;
    const statusCode = range ? 206 : 200;
    const headers = {
      'Accept-Ranges': 'bytes',
      'Content-Type': contentTypeFor(filePath, typeHint),
      'Content-Length': String(end - start + 1),
      'Cache-Control': 'private, max-age=60',
    };
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    response.writeHead(statusCode, headers);
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    stream = fs.createReadStream(filePath, { start, end });
    stream.on('error', () => {
      if (!response.headersSent) sendError(response, 500, 'Could not read media.', 'media_read_error');
      else response.destroy();
    });
    stream.pipe(response);
  }

  async function handleRequest(request, response) {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);
    try {
      if (request.method === 'OPTIONS') {
        response.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, POST, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range',
          'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
        });
        response.end();
        return;
      }
      if (!['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'].includes(request.method)) {
        sendError(response, 405, 'Method not allowed.', 'method_not_allowed');
        return;
      }
      if (pathname === `${API_PREFIX}/health`) {
        sendJson(response, 200, { ok: true, status: status.enabled ? 'running' : 'stopped', startedAt: status.startedAt });
        return;
      }
      if (pathname === `${API_PREFIX}/server-info`) {
        sendJson(response, 200, serverInfo());
        return;
      }
      if (pathname === `${API_PREFIX}/pair/complete` && request.method === 'POST') {
        const pairingRateKey = `pair-complete:${request.socket?.remoteAddress || 'unknown'}`;
        if (!consumeRequestWindow(pairingRateKey, pairingAttemptLimit, PAIRING_ATTEMPT_WINDOW_MS)) {
          sendError(response, 429, 'Too many pairing attempts. Wait before trying again.', 'pairing_rate_limited');
          return;
        }
        const body = await readJsonBody(request);
        const pairingResult = completePairing(body);
        sendJson(response, pairingResult.ok ? 200 : pairingResult.code === 'device_store_write_failed' ? 503 : 400, pairingResult);
        return;
      }
      let auth = requireAuth(request, response, url);
      if (!auth) return;
      const readAuthorizedBody = async (permission = '', sameJam = false) => {
        const sessionId = jamSession?.sessionId;
        const body = await readJsonBody(request);
        // Reading a request body yields: authority may have ended while it was arriving.
        const currentAuth = authenticate(request, url);
        if (!currentAuth.ok) throw Object.assign(new Error(currentAuth.message), { statusCode: 401, code: currentAuth.code });
        auth = currentAuth;
        if (permission && auth.kind !== 'owner' && !auth.permissions.includes(permission)) {
          throw Object.assign(new Error(`Permission is required: ${permission}`), { statusCode: 403, code: 'permission_required' });
        }
        if (sameJam && (!sessionId || jamSession?.sessionId !== sessionId)) {
          throw Object.assign(new Error('The J.A.M. session ended or changed. Refresh before trying again.'), { statusCode: 409, code: 'jam_not_active' });
        }
        return body;
      };
      if (pathname === `${API_PREFIX}/devices` && request.method === 'GET') {
        if (!requireOwner(auth, response)) return;
        sendJson(response, 200, trustedDevicesPayload());
        return;
      }
      if (pathname === `${API_PREFIX}/devices/refresh` && request.method === 'POST') {
        if (!requirePermission(auth, response, 'playback:read')) return;
        const body = await readAuthorizedBody('playback:read');
        sendJson(response, 202, requestDeviceRefresh(body, auth));
        return;
      }
      const deviceMatch = new RegExp(`^${API_PREFIX}/devices/([^/]+)$`).exec(pathname);
      if (deviceMatch && request.method === 'PATCH') {
        if (!requireOwner(auth, response)) return;
        const body = await readAuthorizedBody();
        const result = updateTrustedDeviceAccess(deviceMatch[1], body);
        sendJson(response, result.ok ? 200 : result.code === 'device_not_found' ? 404 : result.code === 'device_store_write_failed' ? 503 : result.code === 'access_profile_permission_conflict' ? 409 : 400, result);
        return;
      }
      if (deviceMatch && request.method === 'DELETE') {
        if (!requireOwner(auth, response)) return;
        const result = revokeTrustedDevice(deviceMatch[1]);
        sendJson(response, result.ok ? 200 : result.code === 'device_not_found' ? 404 : result.code === 'device_store_write_failed' ? 503 : 400, result);
        return;
      }
      if (pathname === `${API_PREFIX}/pair/start` && request.method === 'POST') {
        if (!requireOwner(auth, response)) return;
        const body = await readAuthorizedBody();
        const pairingResult = startPairing(body);
        sendJson(response, pairingResult.ok ? 200 : pairingResult.code === 'pairing_capacity' ? 429 : 400, pairingResult);
        return;
      }
      if (pathname === `${API_PREFIX}/host/capabilities`) {
        sendJson(response, 200, capabilities());
        return;
      }
      if (pathname === `${API_PREFIX}/live`) {
        if (!requirePermission(auth, response, 'playback:read')) return;
        if (requestedRevision(url) === snapshotRevision) {
          sendJson(response, 200, unchangedPayload());
          return;
        }
        sendJson(response, 200, liveStatePayload(auth));
        return;
      }
      if (pathname === `${API_PREFIX}/library/snapshot`) {
        if (!requirePermission(auth, response, 'browse')) return;
        if (requestedRevision(url) === snapshotRevision) {
          sendJson(response, 200, unchangedPayload());
          return;
        }
        const idMap = publicIdMap(snapshot);
        const includeTracks = url.searchParams.get('includeTracks') !== 'false';
        sendJson(response, 200, {
          version: snapshot.version,
          revision: snapshotRevision,
          revisions: revisionPayload(),
          generatedAt: snapshot.generatedAt,
          hostName: snapshot.hostName,
          tracks: includeTracks ? snapshot.tracks.map((track) => publicTrack(track, { allowOriginalStream: canReceiveOriginalStream(auth) })) : [],
          tracksOmitted: !includeTracks,
          playlists: snapshot.playlists.map((playlist) => publicPlaylist(playlist, idMap)),
          favorites: publicTrackIds(snapshot.favorites, idMap),
          queue: publicTrackIds(snapshot.queue, idMap),
          playback: publicPlayback(idMap),
          shuffle: flowShuffleContract.publicSnapshot(snapshot.flowShuffle, (id) => idMap.get(id) || ''),
          audioProfiles: snapshot.audioProfiles,
        });
        return;
      }
      if (pathname === `${API_PREFIX}/library/tracks`) {
        if (!requirePermission(auth, response, 'browse')) return;
        if (requestedRevision(url) === snapshotRevision) {
          sendJson(response, 200, unchangedPayload());
          return;
        }
        sendJson(response, 200, pagedTracksPayload(url, { allowOriginalStream: canReceiveOriginalStream(auth) }));
        return;
      }
      if (pathname === `${API_PREFIX}/tracks`) {
        if (!requirePermission(auth, response, 'browse')) return;
        sendJson(response, 200, { tracks: snapshot.tracks.map((track) => publicTrack(track, { allowOriginalStream: canReceiveOriginalStream(auth) })) });
        return;
      }
      if (pathname === `${API_PREFIX}/commands/playback` && request.method === 'POST') {
        if (!requirePermission(auth, response, 'playback:control')) return;
        if (!consumeRequestWindow(authRateKey(auth, request, 'commands'), commandLimit, COMMAND_WINDOW_MS)) {
          sendError(response, 429, 'Too many remote commands. Wait before trying again.', 'command_rate_limited');
          return;
        }
        const body = await readAuthorizedBody('playback:control');
        sendJson(response, 202, commandAcceptedPayload('playback', playbackCommandPayload(body), auth));
        return;
      }
      if (pathname === `${API_PREFIX}/commands/queue` && request.method === 'POST') {
        if (!requirePermission(auth, response, 'queue:write')) return;
        if (!consumeRequestWindow(authRateKey(auth, request, 'commands'), commandLimit, COMMAND_WINDOW_MS)) {
          sendError(response, 429, 'Too many remote commands. Wait before trying again.', 'command_rate_limited');
          return;
        }
        const body = await readAuthorizedBody('queue:write');
        sendJson(response, 202, commandAcceptedPayload('queue', queueCommandPayload(body), auth));
        return;
      }
      if (pathname === `${API_PREFIX}/commands/shuffle` && request.method === 'POST') {
        if (!requirePermission(auth, response, 'playback:control')) return;
        if (!consumeRequestWindow(authRateKey(auth, request, 'commands'), commandLimit, COMMAND_WINDOW_MS)) {
          sendError(response, 429, 'Too many remote commands. Wait before trying again.', 'command_rate_limited');
          return;
        }
        const body = await readAuthorizedBody('playback:control');
        sendJson(response, 202, commandAcceptedPayload('shuffle', shuffleCommandPayload(body), auth));
        return;
      }
      if (pathname === `${API_PREFIX}/jam/session` && request.method === 'POST') {
        if (!requireOwner(auth, response)) return;
        const body = await readAuthorizedBody();
        sendJson(response, 201, startJamSession(body));
        return;
      }
      if (pathname === `${API_PREFIX}/jam/session` && request.method === 'GET') {
        const payload = jamSessionPayload(auth);
        sendJson(response, payload.ok ? 200 : payload.code === 'jam_approval_pending' ? 409 : 403, payload);
        return;
      }
      if (pathname === `${API_PREFIX}/jam/session` && request.method === 'PATCH') {
        if (!requireOwner(auth, response)) return;
        if (!jamSession) { sendError(response, 409, 'No J.A.M. session is active.', 'jam_not_active'); return; }
        const body = await readAuthorizedBody('', true);
        jamSession.policy = normalizeJamPolicy(body.permissions || body.guestPolicy || body);
        jamSession.updatedAt = new Date().toISOString();
        advanceRevisions(['jam']);
        sendJson(response, 200, jamSessionPayload(auth));
        return;
      }
      if (pathname === `${API_PREFIX}/jam/session` && request.method === 'DELETE') {
        if (!requireOwner(auth, response)) return;
        sendJson(response, 200, stopJamSession(auth));
        return;
      }
      if (pathname === `${API_PREFIX}/jam/session/join` && request.method === 'POST') {
        const body = await readAuthorizedBody('', true);
        const result = requestJamJoin(auth, body);
        sendJson(response, result.ok ? 202 : 409, result);
        return;
      }
      if (pathname === `${API_PREFIX}/jam/session/participants` && request.method === 'GET') {
        const payload = jamSessionPayload(auth);
        sendJson(response, payload.ok ? 200 : 403, payload.ok ? { ok: true, participants: payload.participants, currentParticipant: payload.currentParticipant, revision: payload.revision, revisions: payload.revisions } : payload);
        return;
      }
      const jamParticipantMatch = new RegExp(`^${API_PREFIX}/jam/session/participants/([^/]+)$`).exec(pathname);
      if (jamParticipantMatch && request.method === 'PATCH') {
        if (!requireOwner(auth, response)) return;
        const body = await readAuthorizedBody('', true);
        const result = approveJamParticipant(jamParticipantMatch[1], body);
        sendJson(response, result.ok ? 200 : result.code === 'jam_participant_not_found' ? 404 : 409, result);
        return;
      }
      if (jamParticipantMatch && request.method === 'DELETE') {
        if (!requireOwner(auth, response)) return;
        const result = removeJamParticipant(jamParticipantMatch[1]);
        sendJson(response, result.ok ? 200 : result.code === 'jam_participant_not_found' ? 404 : 409, result);
        return;
      }
      if (pathname === `${API_PREFIX}/jam/session/queue` && request.method === 'GET') {
        const payload = jamSessionPayload(auth);
        sendJson(response, payload.ok ? 200 : 403, payload.ok ? { ok: true, queue: payload.queue, revision: payload.revision, revisions: payload.revisions, diagnostics: payload.diagnostics } : payload);
        return;
      }
      if (pathname === `${API_PREFIX}/jam/session/queue` && request.method === 'POST') {
        const body = await readAuthorizedBody('', true);
        sendJson(response, 202, mutateJamQueue(auth, body));
        return;
      }
      if (pathname === `${API_PREFIX}/jam/session/playback` && request.method === 'POST') {
        if (!jamSession) { sendError(response, 409, 'No J.A.M. session is active.', 'jam_not_active'); return; }
        if (!requireJamPermission(auth, 'controlPlayback')) { sendError(response, 403, 'J.A.M. playback-control permission is required.', 'jam_permission_required'); return; }
        if (!consumeRequestWindow(authRateKey(auth, request, 'jam-commands'), commandLimit, COMMAND_WINDOW_MS)) {
          sendError(response, 429, 'Too many J.A.M. commands. Wait before trying again.', 'command_rate_limited');
          return;
        }
        const body = await readAuthorizedBody('', true);
        if (!requireJamPermission(auth, 'controlPlayback')) { sendError(response, 403, 'J.A.M. playback-control permission is required.', 'jam_permission_required'); return; }
        sendJson(response, 202, commandAcceptedPayload('playback', playbackCommandPayload(body), auth));
        return;
      }
      if (pathname === `${API_PREFIX}/jam/session/diagnostics` && request.method === 'GET') {
        const payload = jamSessionPayload(auth);
        sendJson(response, payload.ok ? 200 : 403, payload.ok ? { ok: true, diagnostics: payload.diagnostics, revision: payload.revision, revisions: payload.revisions } : payload);
        return;
      }
      const trackMatch = new RegExp(`^${API_PREFIX}/tracks/(.+?)(?:/(stream|artwork))?$`).exec(pathname);
      if (trackMatch) {
        const track = getTrack(trackMatch[1]);
        if (!track) {
          sendError(response, 404, 'Track was not found.', 'track_not_found');
          return;
        }
        const action = trackMatch[2] || '';
        if (!action) {
          if (!requirePermission(auth, response, 'browse')) return;
          sendJson(response, 200, publicTrack(track, { allowOriginalStream: canReceiveOriginalStream(auth) }));
          return;
        }
        if (action === 'stream') {
          if (!requireOriginalStreamAccess(auth, response)) return;
          await sendFile(request, response, track.path, track.format, auth, 'stream');
          return;
        }
        if (action === 'artwork') {
          if (!requirePermission(auth, response, 'browse')) return;
          await sendFile(request, response, track.artworkPath, 'jpg', auth, 'browse');
          return;
        }
      }
      sendError(response, 404, 'Route was not found.', 'route_not_found');
    } catch (error) {
      status.lastError = error.message || String(error);
      sendError(response, error.statusCode || 500, status.lastError, error.code || 'server_error');
    }
  }

  async function start(startOptions = {}) {
    if (stoppingPromise) await stoppingPromise;
    if (server) return statusPayload();
    const bindHost = startOptions.host || DEFAULT_HOST;
    const port = Number.isFinite(Number(startOptions.port)) ? Number(startOptions.port) : 0;
    ownerToken = randomToken();
    pendingPairings.clear();
    requestWindows.clear();
    jamSession = null;
    server = http.createServer(handleRequest);
    server.requestTimeout = 15_000;
    server.headersTimeout = 10_000;
    server.keepAliveTimeout = 5_000;
    server.on('connection', (socket) => {
      activeSockets.add(socket);
      socket.once('close', () => activeSockets.delete(socket));
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen({ host: bindHost, port }, resolve);
    }).catch((error) => {
      server = null;
      ownerToken = '';
      status.lastError = error.message || String(error);
      throw error;
    });
    const address = server.address();
    const networkUrls = bindHost === LAN_BIND_HOST ? networkBaseUrls(address.port) : [];
    const remoteBaseUrl = networkUrls.find((entry) => entry.scope === 'private-vpn')?.baseUrl || '';
    const advertisedHost = startOptions.publicHost || (bindHost === LAN_BIND_HOST ? preferredNetworkAddress() : bindHost);
    status = {
      ...status,
      enabled: true,
      visibility: bindHost === DEFAULT_HOST ? 'localhost' : 'lan',
      bindHost,
      port: address.port,
      baseUrl: `http://${advertisedHost}:${address.port}`,
      localBaseUrl: `http://127.0.0.1:${address.port}`,
      remoteBaseUrl,
      networkBaseUrls: networkUrls,
      startedAt: new Date().toISOString(),
      stoppedAt: null,
      lastError: identity.error,
    };
    return statusPayload();
  }

  async function stop() {
    if (stoppingPromise) {
      await stoppingPromise;
      return statusPayload();
    }
    if (!server) {
      flushTrustedDevices();
      ownerToken = '';
      pendingPairings.clear();
      if (jamSession) {
        jamSession = null;
        advanceRevisions(['jam']);
      }
      status = { ...status, enabled: false, visibility: 'off', baseUrl: '', localBaseUrl: '', remoteBaseUrl: '', networkBaseUrls: [], port: null, stoppedAt: new Date().toISOString() };
      return statusPayload();
    }
    const closing = server;
    server = null;
    ownerToken = '';
    pendingPairings.clear();
    requestWindows.clear();
    if (jamSession) {
      jamSession = null;
      advanceRevisions(['jam']);
    }
    flushTrustedDevices();
    stoppingPromise = new Promise((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(forceCloseTimer);
        resolve();
      };
      const forceCloseTimer = setTimeout(() => {
        for (const socket of activeSockets) socket.destroy();
        closing.closeAllConnections?.();
        finish();
      }, 750);
      forceCloseTimer.unref?.();
      closing.close(finish);
      closing.closeIdleConnections?.();
      for (const socket of activeSockets) socket.destroy();
      closing.closeAllConnections?.();
    });
    await stoppingPromise;
    stoppingPromise = null;
    status = { ...status, enabled: false, visibility: 'off', baseUrl: '', localBaseUrl: '', remoteBaseUrl: '', networkBaseUrls: [], port: null, stoppedAt: new Date().toISOString() };
    return statusPayload();
  }

  function updateSnapshot(rawSnapshot) {
    const nextSnapshot = normalizeSnapshot(rawSnapshot);
    const changedDomains = [];
    if (libraryFingerprint(snapshot) !== libraryFingerprint(nextSnapshot)) changedDomains.push('library');
    if (jsonFingerprint(snapshot.queue) !== jsonFingerprint(nextSnapshot.queue)) changedDomains.push('queue');
    if (jsonFingerprint(snapshot.favorites) !== jsonFingerprint(nextSnapshot.favorites)) changedDomains.push('favorites');
    if (playbackMeaningfullyChanged(snapshot.playback, nextSnapshot.playback)) changedDomains.push('playback');
    if (shuffleFingerprint(snapshot.flowShuffle) !== shuffleFingerprint(nextSnapshot.flowShuffle)) changedDomains.push('playback');
    if (reconcileJamQueue(nextSnapshot)) changedDomains.push('jam');
    if (!changedDomains.length) nextSnapshot.generatedAt = snapshot.generatedAt;
    snapshot = nextSnapshot;
    advanceRevisions(changedDomains);
    return statusPayload();
  }

  async function requestJson(targetUrl, token = '') {
    return new Promise((resolve, reject) => {
      const req = http.request(targetUrl, { headers: token ? { Authorization: `Bearer ${token}` } : {} }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            resolve({ statusCode: res.statusCode, body: body ? JSON.parse(body) : null });
          } catch (error) {
            reject(error);
          }
        });
      });
      req.on('error', reject);
      req.end();
    });
  }

  async function selfTest() {
    if (!status.enabled || !status.baseUrl) {
      status.selfTest = { ok: false, message: 'Server is not running.', checkedAt: new Date().toISOString() };
      return statusPayload();
    }
    const checkedAt = new Date().toISOString();
    const testBaseUrl = status.localBaseUrl || status.baseUrl;
    const health = await requestJson(`${testBaseUrl}${API_PREFIX}/health`);
    const info = await requestJson(`${testBaseUrl}${API_PREFIX}/server-info`);
    const unauthorized = await requestJson(`${testBaseUrl}${API_PREFIX}/library/snapshot`);
    const library = await requestJson(`${testBaseUrl}${API_PREFIX}/library/snapshot`, ownerToken);
    status.selfTest = {
      ok: health.statusCode === 200 && info.statusCode === 200 && unauthorized.statusCode === 401 && library.statusCode === 200,
      checkedAt,
      health: health.statusCode,
      serverInfo: info.statusCode,
      unauthorized: unauthorized.statusCode,
      library: library.statusCode,
      tracks: library.body?.tracks?.length || 0,
    };
    return statusPayload();
  }

  return {
    start,
    stop,
    updateSnapshot,
    status: statusPayload,
    selfTest,
    trustedDevices: trustedDevicesPayload,
    createTrustedDevice,
    revokeTrustedDevice,
    deleteTrustedDevice,
    updateTrustedDeviceAccess,
    updateTrustedDevicePermissions,
    requestDeviceRefresh: (options = {}) => requestDeviceRefresh(options, { kind: 'owner' }),
    startPairing,
    completePairing,
    startJamSession,
    stopJamSession: () => stopJamSession({ kind: 'owner' }),
    jamSession: () => jamSessionPayload({ kind: 'owner' }),
    updateJamPolicy: (options = {}) => {
      if (!jamSession) return { ok: false, code: 'jam_not_active', message: 'No J.A.M. session is active.' };
      jamSession.policy = normalizeJamPolicy(options.permissions || options.guestPolicy || options);
      jamSession.updatedAt = new Date().toISOString();
      advanceRevisions(['jam']);
      return jamSessionPayload({ kind: 'owner' });
    },
    approveJamParticipant,
    removeJamParticipant,
  };
}

module.exports = { createPersonalServer };
