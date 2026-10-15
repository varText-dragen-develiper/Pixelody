const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  AUDIO_EXTENSIONS,
  IMAGE_EXTENSIONS,
  validAbsolutePath,
} = require('../src/electron-security');

const root = path.resolve(__dirname, '..');
const macConfig = require('../electron-builder.mac.cjs');
const linuxConfig = require('../electron-builder.linux.cjs');
const winConfig = require('../electron-builder.windows.cjs');
const rendererSrc = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');
const preloadSrc = fs.readFileSync(path.join(root, 'src', 'preload.js'), 'utf8');
const mainSrc = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
const stylesSrc = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');

// 1. Validate cross-platform path validation in electron-security.js
assert.equal(validAbsolutePath('/Users/listener/Music/album/track01.flac', AUDIO_EXTENSIONS), true, 'POSIX macOS audio path must be accepted.');
assert.equal(validAbsolutePath('/home/user/Music/track02.wav', AUDIO_EXTENSIONS), true, 'POSIX Linux audio path must be accepted.');
assert.equal(validAbsolutePath('C:\\Users\\User\\Music\\track03.flac', AUDIO_EXTENSIONS), true, 'Windows audio path must be accepted.');
assert.equal(validAbsolutePath('/Users/listener/Pictures/cover.jpg', IMAGE_EXTENSIONS), true, 'POSIX image path must be accepted.');
assert.equal(validAbsolutePath('C:\\Users\\User\\Pictures\\cover.png', IMAGE_EXTENSIONS), true, 'Windows image path must be accepted.');

assert.equal(validAbsolutePath('../secret.flac', AUDIO_EXTENSIONS), false, 'Relative POSIX path must be rejected.');
assert.equal(validAbsolutePath('..\\secret.flac', AUDIO_EXTENSIONS), false, 'Relative Windows path must be rejected.');
assert.equal(validAbsolutePath('/home/user/song.flac\0.evil', AUDIO_EXTENSIONS), false, 'Null byte path must be rejected.');
assert.equal(validAbsolutePath('/home/user/executable.bin', AUDIO_EXTENSIONS), false, 'Disallowed extension must be rejected.');

// 2. Preload cross-platform assertions
assert.match(preloadSrc, /process\.platform === 'win32' \? normalized\.toLowerCase\(\) : normalized/, 'Preload pathKey must preserve case on non-Windows platforms.');
assert.match(preloadSrc, /normalized\.startsWith\('\/'\)/, 'Preload toApprovedFileUrl must support POSIX paths.');
assert.match(preloadSrc, /platform: process\.platform/, 'Preload runtimeSecurity must expose platform.');

// 3. Main process windowing assertions
assert.match(mainSrc, /trafficLightPosition = \{ x: 16, y: 16 \}/, 'macOS traffic light position must be configured.');
assert.match(stylesSrc, /body\[data-platform="darwin"\] \.topbar/, 'macOS topbar padding inset must be styled.');

// 4. Keyboard shortcuts & navigation
assert.match(rendererSrc, /function isMacPlatform\(\)/, 'Renderer must define isMacPlatform.');
assert.match(rendererSrc, /function isPrimaryModifier\(/, 'Renderer must define isPrimaryModifier.');
assert.match(rendererSrc, /function updatePlatformShortcutsUi\(\)/, 'Renderer must define updatePlatformShortcutsUi.');

// 5. MediaSession / MPRIS / macOS media controls
assert.match(rendererSrc, /function syncMediaSessionPlaybackState\(\)/, 'Renderer must define syncMediaSessionPlaybackState.');
assert.match(rendererSrc, /audio\.addEventListener\('play', syncMediaSessionPlaybackState\)/, 'MediaSession must sync on audio play event.');
assert.match(rendererSrc, /audio\.addEventListener\('pause', syncMediaSessionPlaybackState\)/, 'MediaSession must sync on audio pause event.');

// 6. Packaging targets
assert.equal(macConfig.productName, 'Pixelody');
assert.ok(macConfig.mac.target.some((t) => t.target === 'dmg'), 'macOS target must include dmg.');
assert.ok(macConfig.mac.target.some((t) => t.target === 'zip'), 'macOS target must include zip.');
assert.equal(macConfig.mac.category, 'public.app-category.music');
assert.equal(macConfig.mac.hardenedRuntime, true);

assert.equal(linuxConfig.productName, 'Pixelody');
assert.ok(linuxConfig.linux.target.some((t) => t.target === 'AppImage'), 'Linux target must include AppImage.');
assert.ok(linuxConfig.linux.target.some((t) => t.target === 'deb'), 'Linux target must include deb.');
assert.equal(linuxConfig.linux.category, 'Audio;Music;');
assert.ok(Array.isArray(linuxConfig.linux.mimeTypes) && linuxConfig.linux.mimeTypes.includes('audio/flac'), 'Linux target must associate audio mime types.');

console.log('Cross-platform desktop audit passed: path normalization, macOS/Linux windowing, dynamic shortcuts, MediaSession/MPRIS, and packaging configurations verified.');
