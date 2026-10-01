const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { LOGO_COLOR_KEYS } = require('./brand-mark');
const { PROFILE_IDS: DEVELOPMENT_PROFILE_IDS } = require('./development-profiles');

const MAX_PATH_CHARS = 32_767;
const AUDIO_EXTENSIONS = new Set(['.flac', '.wav', '.wave', '.aiff', '.aif', '.mp3', '.m4a', '.aac', '.ogg', '.opus']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);
const EXTERNAL_HTTPS_HOSTS = new Set(['musicbrainz.org', 'bandcamp.com', 'www.discogs.com']);
const BLOCKED_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const IPC_CONTRACTS = Object.freeze({
  'modules:open': { sender: 'main', payload: 'none', sideEffect: 'opens-module-shop', privacy: 'none' },
  'modules:request': { sender: 'module-shop', payload: 'module-request', sideEffect: 'local-module-and-notebook-storage', privacy: 'local-notes' },
  'mini:open': { sender: 'main', payload: 'none', sideEffect: 'opens-mini-window', privacy: 'none' },
  'app:set-brand-icon': { sender: 'main', payload: 'logo-color-key', sideEffect: 'sets-window-icon', privacy: 'none' },
  'mini:close': { sender: 'mini', payload: 'none', sideEffect: 'closes-mini-window', privacy: 'none' },
  'mini:restore-main': { sender: 'mini', payload: 'none', sideEffect: 'focuses-main-window', privacy: 'none' },
  'mini:command': { sender: 'mini', payload: 'transport-command', sideEffect: 'controls-playback', privacy: 'none' },
  'player:state': { sender: 'main', payload: 'player-state-128KiB', sideEffect: 'updates-mini-window', privacy: 'track-metadata' },
  'test:config': { sender: 'known-test-window', payload: 'none', sideEffect: 'none', privacy: 'test-only' },
  'test:status': { sender: 'known-test-window', payload: 'none', sideEffect: 'none', privacy: 'test-only' },
  'test:report': { sender: 'known-test-window', payload: 'event-and-json-128KiB', sideEffect: 'writes-sanitized-test-report', privacy: 'test-only-sanitized' },
  'test:action': { sender: 'main-test-window', payload: 'allowlisted-action', sideEffect: 'bounded-test-action', privacy: 'test-only' },
  'test:capture-failure': { sender: 'main-test-window', payload: 'label-80', sideEffect: 'writes-test-screenshot', privacy: 'test-only-sanitized' },
  'test:verify-sharing-privacy': { sender: 'main-test-window', payload: 'snapshot-32MiB', sideEffect: 'bounded-localhost-test', privacy: 'private-input-sanitized-output' },
  'test:finish': { sender: 'main-test-window', payload: 'result-128KiB', sideEffect: 'quits-test-process', privacy: 'test-only-sanitized' },
  'test:hostile-result': { sender: 'hostile-test-window', payload: 'result-128KiB', sideEffect: 'resolves-test-probe', privacy: 'test-only' },
  'app:runtime-info': { sender: 'main', payload: 'none', sideEffect: 'none', privacy: 'runtime-versions' },
  'app:relaunch-development-profile': { sender: 'main', payload: 'development-profile-id', sideEffect: 'restarts-app-in-development-builds', privacy: 'none' },
  'theme:list-packages': { sender: 'main', payload: 'none', sideEffect: 'reads-installed-theme-descriptors', privacy: 'local-theme-metadata' },
  'theme:import-package': { sender: 'main', payload: 'none', sideEffect: 'opens-file-dialog-validates-and-installs-theme', privacy: 'local-theme-file' },
  'theme:delete-package': { sender: 'main', payload: 'theme-package-identity', sideEffect: 'deletes-owned-installed-theme-version', privacy: 'local-theme-metadata' },
  'state:load-sync': { sender: 'main', payload: 'none', sideEffect: 'reads-durable-state', privacy: 'private-library' },
  'state:migrate-legacy': { sender: 'main', payload: 'state-64MiB-and-key-list', sideEffect: 'writes-durable-state', privacy: 'private-library' },
  'state:commit': { sender: 'main', payload: 'state-64MiB-and-reason', sideEffect: 'writes-durable-state', privacy: 'private-library' },
  'state:import-backup-v1': { sender: 'main', payload: 'backup-and-state-64MiB', sideEffect: 'writes-durable-state', privacy: 'private-library' },
  'state:diagnostics': { sender: 'main', payload: 'none', sideEffect: 'reads-path-hidden-diagnostics', privacy: 'sanitized' },
  'state:workspace-load': { sender: 'main', payload: 'none', sideEffect: 'reads-normalized-workspace-state', privacy: 'local-layout' },
  'state:workspace-commit': { sender: 'main', payload: 'workspace-graph-2MiB-and-revision', sideEffect: 'atomically-writes-workspace-state', privacy: 'local-layout' },
  'state:workspace-cancel': { sender: 'main', payload: 'workspace-revision', sideEffect: 'none', privacy: 'local-layout' },
  'state:workspace-startup': { sender: 'main', payload: 'workspace-startup-receipt', sideEffect: 'writes-watchdog-state', privacy: 'sanitized' },
  'app:clear-runtime-cache': { sender: 'main', payload: 'none', sideEffect: 'clears-app-owned-cache', privacy: 'none' },
  'app:wasapi-helper-status': { sender: 'main', payload: 'none', sideEffect: 'probes-helper', privacy: 'path-hidden-status' },
  'app:wasapi-helper-diagnostics': { sender: 'main', payload: 'wasapi-request-128KiB', sideEffect: 'runs-bounded-helper', privacy: 'device-identifiers' },
  'app:wasapi-helper-probe': { sender: 'main', payload: 'wasapi-request-128KiB', sideEffect: 'runs-bounded-helper', privacy: 'device-identifiers' },
  'app:wasapi-helper-loopback-prototype': { sender: 'main', payload: 'wasapi-request-128KiB', sideEffect: 'runs-dev-only-helper', privacy: 'device-identifiers' },
  'app:native-mixer-status': { sender: 'main', payload: 'none', sideEffect: 'probes-helper', privacy: 'path-hidden-status' },
  'app:native-mixer-clock-discipline-lab': { sender: 'main', payload: 'clock-request-16KiB', sideEffect: 'runs-dev-only-helper', privacy: 'device-identifiers' },
  'app:open-external': { sender: 'main', payload: 'allowlisted-https-url', sideEffect: 'opens-system-browser', privacy: 'query-may-contain-track-text' },
  'sharing:status': { sender: 'main', payload: 'none', sideEffect: 'reads-host-state', privacy: 'owner-token' },
  'sharing:update-snapshot': { sender: 'main', payload: 'snapshot-32MiB', sideEffect: 'updates-private-host', privacy: 'private-library' },
  'sharing:start': { sender: 'main', payload: 'snapshot-32MiB-and-mode', sideEffect: 'starts-explicit-host', privacy: 'private-library' },
  'sharing:stop': { sender: 'main', payload: 'none', sideEffect: 'stops-host', privacy: 'none' },
  'sharing:self-test': { sender: 'main', payload: 'none', sideEffect: 'localhost-http-test', privacy: 'owner-token-in-main-only' },
  'sharing:create-device': { sender: 'main', payload: 'device-options-16KiB', sideEffect: 'creates-credential', privacy: 'credential' },
  'sharing:revoke-device': { sender: 'main', payload: 'device-id-128', sideEffect: 'revokes-credential', privacy: 'private-id' },
  'sharing:delete-device': { sender: 'main', payload: 'device-id-128', sideEffect: 'deletes-credential-record', privacy: 'private-id' },
  'sharing:update-device-permissions': { sender: 'main', payload: 'device-id-and-permissions', sideEffect: 'changes-authorization', privacy: 'private-id' },
  'sharing:refresh-devices': { sender: 'main', payload: 'refresh-options-4KiB', sideEffect: 'emits-owner-command', privacy: 'none' },
  'sharing:start-pairing': { sender: 'main', payload: 'pairing-options-16KiB', sideEffect: 'creates-short-lived-secret', privacy: 'credential' },
  'sharing:jam-session': { sender: 'main', payload: 'none', sideEffect: 'reads-jam-session', privacy: 'participant-and-queue-metadata' },
  'sharing:start-jam-session': { sender: 'main', payload: 'jam-policy-4KiB', sideEffect: 'starts-explicit-jam-session', privacy: 'participant-and-queue-metadata' },
  'sharing:stop-jam-session': { sender: 'main', payload: 'none', sideEffect: 'stops-explicit-jam-session', privacy: 'participant-counts' },
  'sharing:update-jam-policy': { sender: 'main', payload: 'jam-policy-4KiB', sideEffect: 'changes-jam-authorization', privacy: 'none' },
  'sharing:approve-jam-participant': { sender: 'main', payload: 'device-id-and-jam-permissions', sideEffect: 'changes-jam-authorization', privacy: 'private-id' },
  'sharing:remove-jam-participant': { sender: 'main', payload: 'device-id-128', sideEffect: 'removes-jam-participant', privacy: 'private-id' },
  'music:choose-files': { sender: 'main', payload: 'none', sideEffect: 'opens-file-dialog-and-grants-media', privacy: 'local-paths' },
  'migration:choose-playlist-file': { sender: 'main', payload: 'none', sideEffect: 'opens-file-dialog-and-reads-10MiB', privacy: 'local-path-and-content' },
  'music:choose-image': { sender: 'main', payload: 'none', sideEffect: 'opens-file-dialog-and-grants-image', privacy: 'local-path' },
  'music:register-dropped-paths': { sender: 'main', payload: 'os-backed-audio-paths-10000', sideEffect: 'grants-media-paths', privacy: 'local-paths' },
  'app:cache-profile-image': { sender: 'main', payload: 'granted-image-path', sideEffect: 'copies-to-app-profile', privacy: 'local-path' },
  'app:cache-track-image': { sender: 'main', payload: 'granted-image-path-and-track-id', sideEffect: 'writes-app-artwork', privacy: 'local-path-and-private-id' },
  'app:optimize-artwork': { sender: 'main', payload: 'granted-image-path', sideEffect: 'writes-app-preview', privacy: 'local-path' },
  'music:scan-downloads': { sender: 'main', payload: 'none', sideEffect: 'lists-top-level-audio-and-grants-media', privacy: 'local-paths' },
  'music:exists': { sender: 'main', payload: 'granted-path', sideEffect: 'checks-file', privacy: 'local-path' },
  'app:export-backup': { sender: 'main', payload: 'backup-64MiB', sideEffect: 'save-dialog-write', privacy: 'private-library' },
  'app:import-backup': { sender: 'main', payload: 'none', sideEffect: 'open-dialog-read-64MiB', privacy: 'private-library' },
  'app:import-signal-report': { sender: 'main', payload: 'none', sideEffect: 'open-dialog-read-32MiB', privacy: 'listening-history' },
  'app:export-tuning-profiles': { sender: 'main', payload: 'profiles-16MiB', sideEffect: 'save-dialog-write', privacy: 'audio-profiles' },
  'playlist:export-m3u': { sender: 'main', payload: 'playlist-export-32MiB', sideEffect: 'save-dialog-write', privacy: 'local-paths' },
  'app:import-tuning-profiles': { sender: 'main', payload: 'none', sideEffect: 'open-dialog-read-16MiB', privacy: 'audio-profiles' },
  'music:choose-folder': { sender: 'main', payload: 'none', sideEffect: 'open-dialog-recursive-scan-and-grant', privacy: 'local-paths' },
  'music:inspect': { sender: 'main', payload: 'granted-audio-path', sideEffect: 'reads-metadata-and-caches-artwork', privacy: 'local-path-and-metadata' },
  'library:add-watched-folder': { sender: 'main', payload: 'none-or-folder-path', sideEffect: 'starts-folder-watcher-and-grants-media', privacy: 'local-paths' },
  'library:remove-watched-folder': { sender: 'main', payload: 'granted-path', sideEffect: 'stops-folder-watcher', privacy: 'local-path' },
  'library:get-watched-folders': { sender: 'main', payload: 'none', sideEffect: 'reads-watched-folder-metadata', privacy: 'local-paths' },
  'library:sync-watched-folders': { sender: 'main', payload: 'watched-folder-list-1MiB', sideEffect: 'syncs-and-arms-watchers', privacy: 'local-paths' },
  'library:rescan-watched-folders': { sender: 'main', payload: 'none', sideEffect: 'scans-watched-folders-and-grants-media', privacy: 'local-paths' },
});

const PLAYLIST_EXPORT_KEYS = new Set(['name', 'entries']);
const PLAYLIST_EXPORT_ENTRY_KEYS = new Set(['path', 'title', 'artist', 'duration']);
const MAX_PLAYLIST_EXPORT_ENTRIES = 100_000;

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function boundedJson(value, maxBytes, options = {}) {
  const maxDepth = options.maxDepth || 24;
  const maxEntries = options.maxEntries || 1_000_000;
  const maxArrayLength = options.maxArrayLength || 100_000;
  const maxStringLength = options.maxStringLength || 2 * 1024 * 1024;
  const seen = new Set();
  let entries = 0;
  let bytes = 0;
  function visit(item, depth) {
    if (depth > maxDepth || entries++ > maxEntries) return false;
    if (item === null || typeof item === 'boolean') { bytes += 5; return bytes <= maxBytes; }
    if (typeof item === 'number') { if (!Number.isFinite(item)) return false; bytes += 24; return bytes <= maxBytes; }
    if (typeof item === 'string') { if (item.length > maxStringLength) return false; bytes += Buffer.byteLength(item, 'utf8') + 2; return bytes <= maxBytes; }
    if (typeof item !== 'object' || seen.has(item)) return false;
    seen.add(item);
    if (Array.isArray(item)) {
      if (item.length > maxArrayLength) return false;
      for (const child of item) if (!visit(child, depth + 1)) return false;
    } else {
      if (!isPlainRecord(item)) return false;
      const keys = Object.keys(item);
      if (keys.some((key) => BLOCKED_OBJECT_KEYS.has(key))) return false;
      for (const key of keys) {
        if (key.length > 512) return false;
        bytes += Buffer.byteLength(key, 'utf8') + 2;
        if (bytes > maxBytes || !visit(item[key], depth + 1)) return false;
      }
    }
    seen.delete(item);
    return bytes <= maxBytes;
  }
  return visit(value, 0);
}

function hasOnlyKeys(value, allowed) {
  return isPlainRecord(value) && Object.keys(value).every((key) => allowed.has(key));
}

function validString(value, maxLength, options = {}) {
  return typeof value === 'string' && value.length <= maxLength && (!options.nonEmpty || Boolean(value.trim()));
}

function validAbsolutePath(value, extensions = null) {
  if (!validString(value, MAX_PATH_CHARS, { nonEmpty: true }) || value.includes('\0')) return false;
  const isAbs = path.isAbsolute(value) || path.win32.isAbsolute(value) || path.posix.isAbsolute(value);
  if (!isAbs) return false;
  return !extensions || extensions.has(path.extname(value).toLowerCase());
}

function expectedDocumentUrl(sourceDirectory, fileName) {
  return pathToFileURL(path.join(sourceDirectory, fileName)).href;
}

function sameDocumentUrl(candidate, expected) {
  try {
    const parsed = new URL(candidate);
    const wanted = new URL(expected);
    parsed.search = '';
    parsed.hash = '';
    wanted.search = '';
    wanted.hash = '';
    return process.platform === 'win32' ? parsed.href.toLowerCase() === wanted.href.toLowerCase() : parsed.href === wanted.href;
  } catch {
    return false;
  }
}

function allowedExternalUrl(value) {
  if (!validString(value, 2048, { nonEmpty: true })) return '';
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !EXTERNAL_HTTPS_HOSTS.has(parsed.hostname.toLowerCase())) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function validateStringArray(value, maxItems, maxLength, allowedValues = null) {
  return Array.isArray(value) && value.length <= maxItems && value.every((item) => validString(item, maxLength, { nonEmpty: true }) && (!allowedValues || allowedValues.has(item)));
}

function validateOptions(value, keys, maxBytes = 16 * 1024) {
  return hasOnlyKeys(value, keys) && boundedJson(value, maxBytes, { maxDepth: 8, maxEntries: 256, maxArrayLength: 32, maxStringLength: 2048 });
}

function validateIpcArguments(channel, args) {
  const fail = (message) => ({ ok: false, code: 'invalid_payload', message });
  const pass = (normalizedArgs = args) => ({ ok: true, args: normalizedArgs });
  const none = new Set([
    'mini:open', 'mini:close', 'mini:restore-main', 'test:config', 'test:status', 'app:runtime-info', 'theme:list-packages', 'theme:import-package', 'state:load-sync', 'state:diagnostics', 'state:workspace-load',
    'app:clear-runtime-cache', 'app:wasapi-helper-status', 'app:native-mixer-status', 'sharing:status', 'sharing:stop', 'sharing:self-test',
    'sharing:jam-session', 'sharing:stop-jam-session',
    'music:choose-files', 'migration:choose-playlist-file', 'music:choose-image', 'music:scan-downloads', 'app:import-backup', 'app:import-signal-report',
    'app:import-tuning-profiles', 'music:choose-folder',
  ]);
  if (channel === 'modules:open') return args.length === 0 ? pass([]) : fail('No arguments expected.');
  if (channel === 'modules:request') return args.length === 1 && require('./module-shop/contract').validRequest(args[0]) ? pass() : fail('Invalid module request.');
  if (none.has(channel)) return args.length === 0 ? pass([]) : fail('This channel does not accept arguments.');
  if (channel === 'theme:delete-package') {
    const identity = args[0];
    const valid = args.length === 1 && hasOnlyKeys(identity, new Set(['id', 'version', 'hash']))
      && validString(identity.id, 64, { nonEmpty: true }) && /^[a-z0-9][a-z0-9._-]{2,63}$/.test(identity.id)
      && validString(identity.version, 32, { nonEmpty: true }) && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(identity.version)
      && validString(identity.hash, 64, { nonEmpty: true }) && /^[a-f0-9]{64}$/.test(identity.hash);
    return valid ? pass() : fail('Theme-package identity is invalid.');
  }
  if (channel === 'app:set-brand-icon') return (args.length === 1 || args.length === 2) && LOGO_COLOR_KEYS.includes(args[0]) && (args.length === 1 || args[1] === '' || (typeof args[1] === 'string' && /^#[0-9a-f]{6}$/i.test(args[1]))) ? pass() : fail('Unknown logo colour or invalid theme accent.');
  if (channel === 'app:relaunch-development-profile') return args.length === 1 && DEVELOPMENT_PROFILE_IDS.includes(args[0]) ? pass() : fail('Unknown development presentation.');
  if (channel === 'mini:command') return args.length === 1 && ['previous', 'toggle', 'next'].includes(args[0]) ? pass() : fail('Invalid transport command.');
  if (channel === 'player:state') return args.length === 1 && isPlainRecord(args[0]) && boundedJson(args[0], 128 * 1024, { maxDepth: 8, maxEntries: 512, maxArrayLength: 64, maxStringLength: 4096 }) ? pass() : fail('Player state is invalid or oversized.');
  if (channel === 'test:report') return args.length === 2 && validString(args[0], 80, { nonEmpty: true }) && boundedJson(args[1], 128 * 1024, { maxDepth: 12, maxEntries: 2048, maxArrayLength: 100, maxStringLength: 4096 }) ? pass() : fail('Test report is invalid.');
  if (channel === 'test:action' && args.length === 1 && /^capture-theme-imprint-[a-z0-9-]{1,80}$/.test(args[0])) return pass();
  if (channel === 'test:action' && args.length === 1 && /^capture-singularity-(?:proxy-)?(?:main-(?:rest|playing|failure|intermediate|narrow|compact|zoom-200|restored-maximized)|mini-compact)$/.test(args[0])) return pass();
  if (channel === 'test:action' && args.length === 1 && args[0] === 'inspect-singularity-accessibility') return pass();
  if (channel === 'test:action' && args.length === 1 && [
    'set-singularity-zoom-200',
    'reset-singularity-zoom',
    'resize-singularity-intermediate',
    'singularity-keyboard-enter',
    'singularity-keyboard-escape',
  ].includes(args[0])) return pass();
  if (channel === 'test:action' && args.length === 2 && [
    'singularity-pointer-preview-enter',
    'singularity-pointer-preview-leave',
    'singularity-pointer-activate',
  ].includes(args[0])) {
    const point = args[1];
    const valid = isPlainRecord(point)
      && hasOnlyKeys(point, new Set(['x', 'y', 'target']))
      && Number.isInteger(point.x) && point.x >= 0 && point.x <= 4096
      && Number.isInteger(point.y) && point.y >= 0 && point.y <= 4096
      && ['library', 'tracks', 'secondary', 'outside'].includes(point.target);
    return valid ? pass() : fail('Singularity pointer input is invalid.');
  }
  if (channel === 'test:action' && args.length === 2 && args[0] === 'singularity-wheel-scroll') {
    const wheel = args[1];
    const valid = isPlainRecord(wheel)
      && hasOnlyKeys(wheel, new Set(['x', 'y', 'target', 'deltaY']))
      && Number.isInteger(wheel.x) && wheel.x >= 0 && wheel.x <= 4096
      && Number.isInteger(wheel.y) && wheel.y >= 0 && wheel.y <= 4096
      && wheel.target === 'tracks'
      && Number.isInteger(wheel.deltaY) && wheel.deltaY !== 0 && Math.abs(wheel.deltaY) <= 1200;
    return valid ? pass() : fail('Singularity wheel input is invalid.');
  }
  if (channel === 'test:action') return args.length === 1 && [
    'maximize-main',
    'resize-main-narrow',
    'resize-main-compact',
    'close-mini',
    'install-theme-package-fixture',
    'run-security-probes',
    'capture-main-wide',
    'capture-main-playing',
    'capture-main-paused',
    'capture-main-failure',
    'capture-main-empty',
    'capture-main-loading',
    'capture-main-grayscale',
    'capture-main-reduced-motion',
    'capture-workspace-theme-experiment',
    'capture-workspace-theme-experiment-remix',
    'capture-canvas-cartridge-quest-wide',
    'capture-canvas-cartridge-quest-playing',
    'capture-canvas-cartridge-quest-narrow',
    'capture-canvas-cartridge-quest-mini',
    'capture-canvas-cartridge-quest-playing-mini',
    'capture-main-narrow',
    'capture-main-narrow-fold',
    'capture-main-narrow-aperture',
    'capture-main-narrow-paused',
    'capture-mini-playing',
    'capture-mini-compact',
    'capture-mini-paused',
    'capture-mini-paused-full',
    'resize-mini-compact',
  ].includes(args[0]) ? pass() : fail('Test action is not allowlisted.');
  if (channel === 'test:capture-failure') return args.length === 1 && validString(args[0], 80, { nonEmpty: true }) ? pass() : fail('Failure label is invalid.');
  if (channel === 'test:verify-sharing-privacy') return args.length === 1 && isPlainRecord(args[0]) && boundedJson(args[0], 32 * 1024 * 1024) ? pass() : fail('Test snapshot is invalid.');
  if (channel === 'test:finish' || channel === 'test:hostile-result') return args.length === 1 && isPlainRecord(args[0]) && boundedJson(args[0], 128 * 1024, { maxDepth: 12, maxEntries: 4096, maxArrayLength: 256, maxStringLength: 8192 }) ? pass() : fail('Test result is invalid.');
  if (channel === 'state:migrate-legacy') {
    return args.length === 2 && isPlainRecord(args[0]) && boundedJson(args[0], 64 * 1024 * 1024) && validateStringArray(args[1], 1024, 256) ? pass() : fail('Legacy state migration payload is invalid.');
  }
  if (channel === 'state:commit') {
    const options = args[1];
    return args.length === 2 && isPlainRecord(args[0]) && boundedJson(args[0], 64 * 1024 * 1024) && validateOptions(options, new Set(['reason']), 1024) && (!Object.hasOwn(options, 'reason') || validString(options.reason, 128)) ? pass() : fail('State commit payload is invalid.');
  }
  if (channel === 'state:import-backup-v1') return args.length === 2 && isPlainRecord(args[0]) && isPlainRecord(args[1]) && boundedJson(args[0], 64 * 1024 * 1024) && boundedJson(args[1], 64 * 1024 * 1024) ? pass() : fail('Backup import payload is invalid.');
  if (channel === 'state:workspace-commit') {
    const options = args[1];
    const valid = args.length === 2 && isPlainRecord(args[0]) && boundedJson(args[0], 2 * 1024 * 1024, { maxDepth: 64, maxEntries: 20000, maxArrayLength: 256, maxStringLength: 8192 })
      && validateOptions(options, new Set(['expectedRevision', 'activeThemeId', 'reason']), 2048)
      && Number.isInteger(options.expectedRevision) && options.expectedRevision >= 1
      && (!Object.hasOwn(options, 'activeThemeId') || validString(options.activeThemeId, 120, { nonEmpty: true }))
      && (!Object.hasOwn(options, 'reason') || validString(options.reason, 128));
    return valid ? pass() : fail('Workspace composition commit is invalid.');
  }
  if (channel === 'state:workspace-cancel') {
    const options = args[0];
    return args.length === 1 && validateOptions(options, new Set(['expectedRevision']), 512) && Number.isInteger(options.expectedRevision) && options.expectedRevision >= 1 ? pass() : fail('Workspace composition cancellation is invalid.');
  }
  if (channel === 'state:workspace-startup') {
    const action = args[0];
    const detail = args[1];
    const valid = args.length === 2 && ['begin', 'healthy', 'failed'].includes(action)
      && validateOptions(detail, new Set(['watchdogMs', 'errorCode']), 1024)
      && (!Object.hasOwn(detail, 'watchdogMs') || (Number.isInteger(detail.watchdogMs) && detail.watchdogMs >= 1000 && detail.watchdogMs <= 30000))
      && (!Object.hasOwn(detail, 'errorCode') || validString(detail.errorCode, 120, { nonEmpty: true }));
    return valid ? pass() : fail('Workspace startup receipt is invalid.');
  }
  if (['app:wasapi-helper-diagnostics', 'app:wasapi-helper-probe', 'app:wasapi-helper-loopback-prototype'].includes(channel)) {
    const request = args[0];
    const keys = new Set(['outputLabel', 'sinkId', 'eqProfile', 'durationMs']);
    const valid = args.length === 1 && validateOptions(request, keys, 128 * 1024)
      && (!Object.hasOwn(request, 'outputLabel') || validString(request.outputLabel, 240))
      && (!Object.hasOwn(request, 'sinkId') || validString(request.sinkId, 240))
      && (!Object.hasOwn(request, 'durationMs') || Number.isFinite(request.durationMs))
      && (!Object.hasOwn(request, 'eqProfile') || (isPlainRecord(request.eqProfile) && boundedJson(request.eqProfile, 96 * 1024, { maxDepth: 12, maxEntries: 4096, maxArrayLength: 128, maxStringLength: 2048 })));
    return valid ? pass() : fail('WASAPI request is invalid.');
  }
  if (channel === 'app:native-mixer-clock-discipline-lab') {
    const request = args[0];
    const valid = args.length === 1 && validateOptions(request, new Set(['leaderEndpointId', 'followerEndpointId', 'durationMs']), 16 * 1024)
      && validString(request.leaderEndpointId, 240, { nonEmpty: true }) && validString(request.followerEndpointId, 240, { nonEmpty: true })
      && (!Object.hasOwn(request, 'durationMs') || Number.isFinite(request.durationMs));
    return valid ? pass() : fail('Native mixer request is invalid.');
  }
  if (channel === 'app:open-external') {
    const normalized = args.length === 1 ? allowedExternalUrl(args[0]) : '';
    return normalized ? pass([normalized]) : fail('External URL is not allowlisted HTTPS.');
  }
  if (['sharing:update-snapshot'].includes(channel)) return args.length === 1 && isPlainRecord(args[0]) && boundedJson(args[0], 32 * 1024 * 1024) ? pass() : fail('Sharing snapshot is invalid.');
  if (channel === 'sharing:start') {
    const options = args[1];
    return args.length === 2 && isPlainRecord(args[0]) && boundedJson(args[0], 32 * 1024 * 1024) && validateOptions(options, new Set(['mode']), 1024) && ['lan', 'localhost'].includes(options.mode) ? pass() : fail('Sharing start payload is invalid.');
  }
  if (channel === 'sharing:create-device') {
    const options = args[0];
    const valid = args.length === 1 && validateOptions(options, new Set(['id', 'name', 'permissions', 'accessProfile', 'publicKey', 'expiresAt', 'pairingMethod']))
      && (!Object.hasOwn(options, 'accessProfile') || ['personal-device', 'jam-guest'].includes(options.accessProfile))
      && (!Object.hasOwn(options, 'id') || validString(options.id, 128)) && (!Object.hasOwn(options, 'name') || validString(options.name, 160))
      && (!Object.hasOwn(options, 'permissions') || validateStringArray(options.permissions, 16, 64))
      && (!Object.hasOwn(options, 'publicKey') || validString(options.publicKey, 2048)) && (!Object.hasOwn(options, 'expiresAt') || validString(options.expiresAt, 64))
      && (!Object.hasOwn(options, 'pairingMethod') || validString(options.pairingMethod, 80));
    return valid ? pass() : fail('Trusted-device options are invalid.');
  }
  if (channel === 'sharing:revoke-device') return args.length === 1 && validString(args[0], 128, { nonEmpty: true }) ? pass() : fail('Device ID is invalid.');
  if (channel === 'sharing:delete-device') return args.length === 1 && validString(args[0], 128, { nonEmpty: true }) ? pass() : fail('Device ID is invalid.');
  if (channel === 'sharing:update-device-permissions') return [2, 3].includes(args.length) && validString(args[0], 128, { nonEmpty: true }) && validateStringArray(args[1], 16, 64) && (args.length === 2 || ['personal-device', 'jam-guest'].includes(args[2])) ? pass() : fail('Device permission payload is invalid.');
  if (channel === 'sharing:refresh-devices') {
    const options = args[0];
    return args.length === 1 && validateOptions(options, new Set(['scope', 'reason']), 4096) && ['jam', 'trusted-devices', 'all'].includes(options.scope) && validString(options.reason, 180) ? pass() : fail('Refresh options are invalid.');
  }
  if (channel === 'sharing:start-pairing') {
    const options = args[0];
    return args.length === 1 && validateOptions(options, new Set(['deviceName', 'permissions', 'accessProfile'])) && validString(options.deviceName, 160) && validateStringArray(options.permissions, 16, 64) && (!Object.hasOwn(options, 'accessProfile') || ['personal-device', 'jam-guest'].includes(options.accessProfile)) ? pass() : fail('Pairing options are invalid.');
  }
  if (channel === 'sharing:start-jam-session' || channel === 'sharing:update-jam-policy') {
    const options = args[0];
    const policyKeys = new Set(['guestsCanView', 'guestsCanSuggest', 'guestsCanQueue', 'guestsCanEditQueue', 'guestsCanControlPlayback']);
    const policy = isPlainRecord(options) ? (options.guestPolicy || options.permissions) : null;
    const validPolicy = isPlainRecord(policy) && hasOnlyKeys(policy, policyKeys) && Object.values(policy).every((value) => typeof value === 'boolean');
    return args.length === 1 && validateOptions(options, new Set(['guestPolicy', 'permissions']), 4096) && validPolicy ? pass() : fail('J.A.M. policy is invalid.');
  }
  if (channel === 'sharing:approve-jam-participant') {
    const deviceId = args[0];
    const options = args[1];
    const permissions = new Set(['view', 'suggest', 'add', 'editQueue', 'controlPlayback']);
    const valid = args.length === 2 && validString(deviceId, 128, { nonEmpty: true })
      && validateOptions(options, new Set(['approved', 'role', 'permissions']), 4096)
      && (!Object.hasOwn(options, 'approved') || typeof options.approved === 'boolean')
      && (!Object.hasOwn(options, 'role') || ['guest', 'controller'].includes(options.role))
      && (!Object.hasOwn(options, 'permissions') || validateStringArray(options.permissions, 5, 32, permissions));
    return valid ? pass() : fail('J.A.M. participant approval is invalid.');
  }
  if (channel === 'sharing:remove-jam-participant') return args.length === 1 && validString(args[0], 128, { nonEmpty: true }) ? pass() : fail('J.A.M. participant ID is invalid.');
  if (channel === 'music:register-dropped-paths') return args.length === 1 && Array.isArray(args[0]) && args[0].length <= 10_000 && args[0].every((item) => validAbsolutePath(item, AUDIO_EXTENSIONS)) ? pass() : fail('Dropped media paths are invalid.');
  if (['app:cache-profile-image', 'app:optimize-artwork'].includes(channel)) return args.length === 1 && validAbsolutePath(args[0], IMAGE_EXTENSIONS) ? pass() : fail('Image path is invalid.');
  if (channel === 'app:cache-track-image') return args.length === 2 && validAbsolutePath(args[0], IMAGE_EXTENSIONS) && validString(args[1], 256, { nonEmpty: true }) ? pass() : fail('Track artwork payload is invalid.');
  if (channel === 'music:exists') return args.length === 1 && validAbsolutePath(args[0]) ? pass() : fail('Path is invalid.');
  if (channel === 'music:inspect') return args.length === 1 && validAbsolutePath(args[0], AUDIO_EXTENSIONS) ? pass() : fail('Audio path is invalid.');
  if (channel === 'app:export-backup') return args.length === 1 && isPlainRecord(args[0]) && boundedJson(args[0], 64 * 1024 * 1024) ? pass() : fail('Backup export is invalid or oversized.');
  if (channel === 'playlist:export-m3u') {
    const playlist = args[0];
    const validEntry = (entry) => hasOnlyKeys(entry, PLAYLIST_EXPORT_ENTRY_KEYS)
      && validAbsolutePath(entry.path, AUDIO_EXTENSIONS)
      && validString(entry.title, 1024) && validString(entry.artist, 1024)
      && (entry.duration === null || (typeof entry.duration === 'number' && Number.isFinite(entry.duration) && entry.duration >= 0));
    return args.length === 1 && hasOnlyKeys(playlist, PLAYLIST_EXPORT_KEYS) && validString(playlist.name, 256)
      && Array.isArray(playlist.entries) && playlist.entries.length <= MAX_PLAYLIST_EXPORT_ENTRIES && playlist.entries.every(validEntry)
      && boundedJson(playlist, 32 * 1024 * 1024)
      ? pass() : fail('Playlist export is invalid or oversized.');
  }
  if (channel === 'app:export-tuning-profiles') return args.length === 1 && isPlainRecord(args[0]) && boundedJson(args[0], 16 * 1024 * 1024) ? pass() : fail('Tuning profile export is invalid or oversized.');
  if (['library:get-watched-folders', 'library:rescan-watched-folders'].includes(channel)) return args.length === 0 ? pass() : fail('Channel does not accept arguments.');
  if (channel === 'library:add-watched-folder') return args.length === 0 || (args.length === 1 && validAbsolutePath(args[0])) ? pass() : fail('Watched folder path is invalid.');
  if (channel === 'library:remove-watched-folder') return args.length === 1 && validAbsolutePath(args[0]) ? pass() : fail('Watched folder path is invalid.');
  if (channel === 'library:sync-watched-folders') return args.length === 1 && Array.isArray(args[0]) && args[0].length <= 256 && args[0].every((item) => validAbsolutePath(item)) ? pass() : fail('Watched folder list is invalid.');
  return fail(`No validator is registered for ${channel}.`);
}

module.exports = {
  AUDIO_EXTENSIONS,
  EXTERNAL_HTTPS_HOSTS,
  IMAGE_EXTENSIONS,
  IPC_CONTRACTS,
  allowedExternalUrl,
  boundedJson,
  expectedDocumentUrl,
  isPlainRecord,
  sameDocumentUrl,
  validateIpcArguments,
  validAbsolutePath,
};
