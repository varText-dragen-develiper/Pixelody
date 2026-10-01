const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'src', 'preload.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
const directBinding = /\$\('#([^']+)'\)\.(?:onclick|onchange|oninput|oncontextmenu|addEventListener)\b/g;
const htmlIds = new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]));
const missing = new Set();
const startupGuardErrors = [];

for (const match of renderer.matchAll(directBinding)) {
  if (!htmlIds.has(match[1])) missing.add(match[1]);
}

if (!/const STARTUP_REVEAL_WATCHDOG_MS = \d+;/.test(renderer)) {
  startupGuardErrors.push('startup reveal watchdog is missing');
}
if (!/const waitForPaint = \(timeoutMs = PAINT_WAIT_FALLBACK_MS\)[\s\S]*?setTimeout\(finish/.test(renderer)) {
  startupGuardErrors.push('paint wait has no bounded timer fallback');
}
if (!/startupLoad\.slow = true;[\s\S]*?dataset\.startupLoadSlow = 'true'/.test(renderer)
  || /startupLoad\.forced = true;[\s\S]*?classList\.add\('hidden'\)/.test(renderer)) {
  startupGuardErrors.push('startup watchdog can still expose unresolved program state');
}
if (/requestAnimationFrame\(\(\) => requestAnimationFrame\(\(\) => \{\s*const revealMs = hideThemeLoadScreen/.test(renderer)) {
  startupGuardErrors.push('startup reveal still depends on an unbounded double animation frame');
}
if (!/screen\.classList\.remove\('hidden', 'active', 'leaving'\);[\s\S]*?void screen\.offsetWidth;[\s\S]*?screen\.classList\.add\('active'\)/.test(renderer)) {
  startupGuardErrors.push('theme-load entry does not rebuild a hidden-to-active transition edge');
}
if (!/id="themeLoadScreen"[^>]*data-load-phase="preparing"/.test(html)
  || !/screen\.dataset\.loadPhase = 'preparing'/.test(renderer)
  || !/screen\.classList\.add\('active'\);[\s\S]*?startThemeLoadAnimation\(durationMs\)/.test(renderer)
  || !/function startThemeLoadAnimation\([^)]*\)[\s\S]*?screen\.dataset\.loadPhase = 'animating'/.test(renderer)) {
  startupGuardErrors.push('theme-load animation does not begin beneath preparation work');
}
if (/Math\.min\(280, configuredExitMs\)/.test(renderer)
  || !/function waitForThemeLoadAnimation\(\)[\s\S]*?animationEndsAt[\s\S]*?remainingMs[\s\S]*?await wait\(remainingMs\)/.test(renderer)
  || !/await waitForThemeLoadAnimation\(\)/.test(renderer)) {
  startupGuardErrors.push('theme-load animation or exit can still be cut short');
}
if (!/const targetElement = animationTarget\?\.element \|\| animationTarget;[\s\S]*?targetElement\?\.closest\?\.\('#themeLoadScreen'\)\) return;/.test(renderer)) {
  startupGuardErrors.push('performance tuning can still accelerate the theme-load transition');
}
if (!/function themeAssetSettleDisabled\(\) \{[\s\S]*?document\.body\.dataset\.performance === 'conserve' && !audio\.paused/.test(renderer)) {
  startupGuardErrors.push('idle theme arrival motion is still suppressed in Conserve mode');
}
if (!/show: false,[\s\S]*?if \(developmentMaximizedLaunch\) win\.maximize\(\);[\s\S]*?win\.once\('ready-to-show',[\s\S]*?win\.show\(\)/.test(main)) {
  startupGuardErrors.push('main window can become visible before its final bounds and first renderer paint');
}
if (!/startThemeLoadAnimation\(durationMs\);[\s\S]*?async function waitForThemeLoadAnimation\(\)[\s\S]*?animationEndsAt - performance\.now\(\)/.test(renderer)) {
  startupGuardErrors.push('startup loader does not overlap its receipt with real preparation work');
}

if (!/class="sharing-devices collapsible-card" data-card="trusted-devices"/.test(html)
  || !/data-delete-device/.test(renderer)
  || !/async function deleteSharingDevice\(/.test(renderer)
  || !/deleteSharingDevice: \(deviceId\)/.test(preload)) {
  startupGuardErrors.push('trusted-device collapse/delete controls are not fully wired');
}

if (!/id="mainStageResizer"[^>]*role="separator"[^>]*tabindex="0"/.test(html)
  || !/function installMainStageResizer\(element\)/.test(renderer)
  || !/installMainStageResizer\(\$\('#mainStageResizer'\)\)/.test(renderer)
  || !/function scheduleViewportLayoutSync\(\)[\s\S]*?setTimeout\([\s\S]*?applyLayout\(\)/.test(renderer)
  || !/window\.addEventListener\('resize', scheduleViewportLayoutSync, \{ passive: true \}\)/.test(renderer)
  || /window\.addEventListener\('resize', \(\) => \{ applyLayout\(\)/.test(renderer)) {
  startupGuardErrors.push('persistent middle-section resizing is not fully wired');
}

if (!/id="backgroundButton"[^>]*aria-controls="backgroundCabinet"/.test(html)
  || !/id="clearBackgroundImage"/.test(html)
  || !/function clearBackground\(playlistId = state\.activePlaylistId\)[\s\S]*?delete playlist\.background;[\s\S]*?state\.collectionBackgrounds\[playlistId\] = null;[\s\S]*?persist\(\);[\s\S]*?renderTracks\(\)/.test(renderer)
  || !/\$\('#clearBackgroundImage'\)\.onclick = \(\) => \{ clearBackground\(\)/.test(renderer)) {
  startupGuardErrors.push('collection artwork cabinet cannot durably restore theme artwork');
}

if (missing.size || startupGuardErrors.length) {
  console.error(`Renderer event bindings reference missing elements: ${[...missing].sort().join(', ')}`);
  startupGuardErrors.forEach((error) => console.error(`Startup guard failure: ${error}`));
  process.exitCode = 1;
} else {
  console.log('Renderer event binding targets are present and startup reveal guards are bounded.');
}
