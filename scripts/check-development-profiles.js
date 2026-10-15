const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The theme explorer's development entries (src/development-profiles.js) and
// the rules that keep them from leaving anything behind in Studio.
const root = path.resolve(__dirname, '..');
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), 'utf8').replace(/\r\n/g, '\n');
const profiles = require('../src/development-profiles');
const { PixelodyStateStore } = require('../src/state-store');

// Registry: Studio is the only "ready" entry; nothing here is a registered theme.
const described = profiles.describe();
assert.deepEqual(described.map((profile) => profile.id), ['studio', 'canvas-studio', 'singularity-graph', 'singularity-proxy']);
assert.deepEqual(described.filter((profile) => profile.group === 'ready').map((profile) => profile.id), ['studio'], 'Only Studio may be listed as ready to use.');
assert.deepEqual(JSON.parse(read('src', 'themes', 'built-in-themes.json')).themes.map((theme) => theme.runtimeKey), ['studio'], 'Development entries must not register themes.');
assert.deepEqual(described.filter((profile) => profile.isolated).map((profile) => profile.id), ['singularity-graph', 'singularity-proxy'], 'Process-scoped profiles must be isolated.');
assert.equal(profiles.get('canvas-studio').inSession, true, 'Canvas opens in place from a Studio session.');

// Each entry starts Pixelody the way its Start Pixelody *.cmd launcher does.
const launcher = read('Launch Pixelody.ps1');
assert.match(launcher, /if \(\$Canvas\) \{ \$launchArguments \+= '--pixelody-canvas-foreground' \}/);
assert.match(launcher, /if \(\$CanvasProfile\) \{ \$env:PIXELODY_CANVAS_PROFILE = \$CanvasProfile \}/);
assert.match(launcher, /\$launchArguments \+= "--pixelody-singularity-probe=\$SingularityProbe"/);
const launcherPlans = {
  'Start Pixelody Singularity Graph.cmd': 'singularity-graph',
  'Start Pixelody Singularity Proxy.cmd': 'singularity-proxy',
};
for (const [file, profileId] of Object.entries(launcherPlans)) {
  const command = read(file);
  const flags = [];
  const env = {};
  if (/ -Canvas(?:\s|$)/.test(command)) flags.push('--pixelody-canvas-foreground');
  const canvasProfile = command.match(/-CanvasProfile (\S+)/)?.[1];
  if (canvasProfile) env.PIXELODY_CANVAS_PROFILE = canvasProfile;
  const probe = command.match(/-SingularityProbe (\S+)/)?.[1];
  if (probe) flags.push(`--pixelody-singularity-probe=${probe}`);
  const launch = profiles.get(profileId);
  const plan = profiles.relaunchPlan(profileId, { argv: ['electron', '.'], appPath: '/app' });
  assert.deepEqual(plan.args.slice(1), flags, `${profileId} does not start like ${file}.`);
  for (const key of profiles.PROFILE_ENV_KEYS) assert.equal(plan.env[key], env[key] ?? null, `${profileId} ${key} differs from ${file}.`);
  assert.ok(launch.label && launch.summary && launch.status);
}

// Which entry is running.
assert.equal(profiles.activeProfileId({}), 'studio');
assert.equal(profiles.activeProfileId({ canvasRequested: true, canvasProfileId: 'canvas-studio-r1' }), 'canvas-studio');
assert.equal(profiles.activeProfileId({ singularityProbeMode: 'graph' }), 'singularity-graph');
assert.equal(profiles.activeProfileId({ singularityProbeMode: 'proxy', canvasRequested: true }), 'singularity-proxy');

// A restart keeps every unrelated switch, replaces the app path, and strips
// every profile selector before adding the target's, so profiles never stack.
const argv = ['electron', '.', '--pixelody-dev-user-data=/profiles/qa', '--pixelody-canvas-foreground', '--pixelody-singularity-probe=graph', '--pixelody-composable-theme-experiment', '--pixelody-canvas', '--remote-debugging-port=9333'];
const toStudio = profiles.relaunchPlan('studio', { argv, appPath: '/app' });
assert.deepEqual(toStudio.args, ['/app', '--pixelody-dev-user-data=/profiles/qa', '--remote-debugging-port=9333']);
assert.deepEqual(toStudio.env, { PIXELODY_CANVAS_PROFILE: null, PIXELODY_SINGULARITY_PROBE: null });
const toProxy = profiles.relaunchPlan('singularity-proxy', { argv, appPath: '/app' });
assert.deepEqual(toProxy.args, ['/app', '--pixelody-dev-user-data=/profiles/qa', '--remote-debugging-port=9333', '--pixelody-singularity-probe=proxy']);
assert.equal(toProxy.env.PIXELODY_CANVAS_PROFILE, null, 'Leaving Canvas for Singularity must unset its profile.');
assert.deepEqual(profiles.relaunchPlan('canvas-studio', { argv: ['electron', '.'] }).args, ['--pixelody-canvas'], 'A packaged-style restart has no app path argument.');
for (const unknown of ['', 'foreground-stage', '__proto__', 'canvas --no-sandbox']) assert.equal(profiles.relaunchPlan(unknown, { argv }), null);

// The isolation premise: a commit that omits a key keeps its stored value.
{
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pixelody-dev-profiles-'));
  try {
    const store = new PixelodyStateStore({ directory, backupIntervalMs: 0 });
    store.loadSync();
    assert.equal(store.commitSync({ 'pixelody.appearance': { theme: 'studio', motion: 'calm' }, 'pixelody.layout': { libraryWidth: 290 }, 'pixelody.volume': 0.5 }, { reason: 'audit' }).ok, true);
    assert.equal(store.commitSync({ 'pixelody.volume': 0.8 }, { reason: 'audit' }).ok, true);
    const values = new PixelodyStateStore({ directory, backupIntervalMs: 0 }).loadSync().state.values;
    assert.deepEqual(values['pixelody.appearance'], { theme: 'studio', motion: 'calm' }, 'An omitted appearance key was not kept.');
    assert.deepEqual(values['pixelody.layout'], { libraryWidth: 290 }, 'An omitted layout key was not kept.');
    assert.equal(values['pixelody.volume'], 0.8);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

// Main process: development builds only, never under the integration harness.
const main = read('src', 'main.js');
assert.match(main, /const developmentExplorerEnabled = isDevelopment && !integrationTestMode;/);
assert.match(main, /registerHandle\('app:relaunch-development-profile', \(_event, profileId\) => \{\n  if \(!developmentExplorerEnabled\) return \{ ok: false/);
assert.match(main, /app\.relaunch\(\{ args: plan\.args \}\);\n  setTimeout\(\(\) => app\.quit\(\), 0\);/, 'A restart must quit normally so the durable store drains.');
assert.match(main, /developmentProfiles: developmentExplorerEnabled \? developmentProfiles\.describe\(\) : \[\]/);

// Renderer: what an isolated session may not write, and the ways out.
const renderer = read('src', 'renderer.js');
const functionSource = (name) => renderer.match(new RegExp(`\\n(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0] || '';
const keys = renderer.match(/const DEVELOPMENT_SESSION_PRESENTATION_KEYS = new Set\(\[([\s\S]*?)\]\);/)?.[1];
assert.ok(keys, 'DEVELOPMENT_SESSION_PRESENTATION_KEYS is missing.');
for (const key of ['pixelody.appearance', 'pixelody.layout', 'pixelody.motionEffects']) assert.ok(keys.includes(`'${key}'`), `${key} must stay out of isolated-session writes.`);
assert.match(functionSource('setLocalStorageItem'), /if \(developmentSessionIsolated && DEVELOPMENT_SESSION_PRESENTATION_KEYS\.has\(key\)\) return true;/);
assert.match(functionSource('buildDurableStateValues'), /if \(developmentSessionIsolated\) for \(const key of DEVELOPMENT_SESSION_PRESENTATION_KEYS\) delete values\[key\];\n  if \(!DURABLE_LIBRARY_OMITTED_REASONS\.has\(reason\)\) return values;/, 'Isolated sessions must omit presentation keys from every durable commit.');
assert.match(renderer, /developmentSessionIsolated = runtimeInfo\.activeDevelopmentProfileIsolated === true;/);
// Canvas's expressive motion must not outlive the canvas.
const selectTheme = functionSource('selectTheme');
assert.equal((selectTheme.match(/appearance\.studioMotion = appearance\.motion;/g) || []).length, 2, 'Entering an alternate theme must keep Studio\'s motion.');
assert.match(selectTheme, /\} else if \(requestedTheme === 'studio'\) \{\n    if \(appearance\.theme !== 'studio' && appearance\.studioMotion\) appearance\.motion = appearance\.studioMotion;/);
assert.match(renderer, /if \(appearance\.theme !== 'studio' && appearance\.studioMotion\) appearance\.motion = appearance\.studioMotion;\n\/\/ Canvas selection can be persisted/, 'A launch after a session that ended in Canvas must restore Studio\'s motion.');
// Leaving: in place for Canvas, by restart for isolated sessions.
assert.match(functionSource('selectThemeFromSettings'), /if \(developmentSessionIsolated && theme === 'studio'\) \{\n    await restartIntoDevelopmentProfile\('studio'\);/);
assert.match(renderer, /returnToLegacy: async \(\) => \{[\s\S]{0,200}if \(developmentSessionIsolated\) \{\n          await restartIntoDevelopmentProfile\('studio'\);/);
assert.match(functionSource('syncProductionWorkspaceHost'), /if \(!document\.body\.classList\.contains\('cw-production-host-active'\)\) \{\n    delete document\.body\.dataset\.compositionMode;/);
assert.match(functionSource('restartIntoDevelopmentProfile'), /await Promise\.resolve\(durableStateController\.flush\('development-restart'\)\)/, 'A restart must save before it asks the main process to quit.');
assert.match(read('src', 'preload.js'), /relaunchDevelopmentProfile: \(profileId\) => ipcRenderer\.invoke\('app:relaunch-development-profile', String\(profileId \|\| ''\)\)/);

console.log('Development profile audit passed: the theme explorer lists Studio as ready and the development presentations by status, each starts like its launcher, restarts never stack profiles, and isolated sessions leave Studio\'s appearance and layout untouched.');
