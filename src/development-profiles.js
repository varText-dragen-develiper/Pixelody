// Development presentations reachable from Settings > Themes in development
// builds. None of them is a registered theme: Studio stays the only built-in
// (src/themes/built-in-themes.json). Each entry says how to start Pixelody in
// it -- the same arguments and environment the Start Pixelody *.cmd launchers
// pass -- so the theme explorer can restart into one and back to Studio.
//
// The Singularity routes are chosen when the process starts, so
// switching to or from them is a restart, never an in-session swap. Those
// sessions are also "isolated": they read the owner's library and settings
// but do not write Studio's appearance or panel layout back (see
// DEVELOPMENT_SESSION_PRESENTATION_KEYS in renderer.js).
const STUDIO = Object.freeze({
  id: 'studio',
  label: 'Pixelody Studio',
  group: 'ready',
  status: 'Ready',
  summary: 'The registered presentation, for everyday listening.',
  isolated: false,
  launch: Object.freeze({ flags: Object.freeze([]), env: Object.freeze({}) }),
});

const PROFILES = Object.freeze([
  Object.freeze({
    id: 'canvas-studio',
    label: 'Canvas Studio',
    group: 'active',
    status: 'Active',
    summary: 'Compose modules on a near-blank canvas. Includes the 27 baseline theme ports.',
    isolated: false,
    // Canvas is seeded on every development launch, so a Studio session can
    // open and leave it in place; the flag only matters when restarting
    // into it from an isolated session.
    inSession: true,
    launch: Object.freeze({ flags: Object.freeze(['--pixelody-canvas']), env: Object.freeze({}) }),
  }),
  Object.freeze({
    id: 'singularity-graph',
    label: 'Singularity · Graph',
    group: 'active',
    status: 'Active · Stage 3',
    summary: 'Route H-B: complete panels pulled toward a central ring. Awaiting the owner route comparison.',
    isolated: true,
    launch: Object.freeze({ flags: Object.freeze(['--pixelody-singularity-probe=graph']), env: Object.freeze({}) }),
  }),
  Object.freeze({
    id: 'singularity-proxy',
    label: 'Singularity · Proxy',
    group: 'active',
    status: 'Active · Stage 3',
    summary: 'Route H-A: calmer proxies that lend one real panel to a portal. Awaiting the owner route comparison.',
    isolated: true,
    launch: Object.freeze({ flags: Object.freeze(['--pixelody-singularity-probe=proxy']), env: Object.freeze({}) }),
  }),
]);

const PROFILES_BY_ID = new Map([STUDIO, ...PROFILES].map((profile) => [profile.id, profile]));
const PROFILE_IDS = Object.freeze([...PROFILES_BY_ID.keys()]);
// Every argument and variable that selects a presentation. A restart strips
// all of them before adding the target's own, so profiles never stack.
const PROFILE_ARGUMENT = /^--pixelody-(?:canvas|canvas-foreground|composable-theme-experiment|singularity-probe=.*)$/;
const PROFILE_ENV_KEYS = Object.freeze(['PIXELODY_CANVAS_PROFILE', 'PIXELODY_SINGULARITY_PROBE']);

function get(id) {
  return PROFILES_BY_ID.get(id) || null;
}

// Which entry the running process is. Singularity outranks Canvas because
// its probe flag is the more specific request.
function activeProfileId({ canvasRequested = false, canvasProfileId = '', singularityProbeMode = '' } = {}) {
  if (singularityProbeMode === 'graph') return 'singularity-graph';
  if (singularityProbeMode === 'proxy') return 'singularity-proxy';
  if (canvasRequested) return 'canvas-studio';
  return 'studio';
}

// The command line and environment for a restart into `targetId`. Arguments
// that are not switches (the app path Electron was started with) are replaced
// by `appPath`, so the restart does not depend on the working directory.
// env values of null mean "unset".
function relaunchPlan(targetId, { argv = [], appPath = '' } = {}) {
  const profile = get(targetId);
  if (!profile) return null;
  const kept = argv.slice(1).filter((argument) => typeof argument === 'string' && argument.startsWith('--') && !PROFILE_ARGUMENT.test(argument));
  const env = {};
  for (const key of PROFILE_ENV_KEYS) env[key] = Object.prototype.hasOwnProperty.call(profile.launch.env, key) ? profile.launch.env[key] : null;
  return { args: [...(appPath ? [appPath] : []), ...kept, ...profile.launch.flags], env };
}

// What the renderer needs to draw the explorer.
function describe() {
  return [STUDIO, ...PROFILES].map(({ id, label, group, status, summary, isolated, inSession }) => ({ id, label, group, status, summary, isolated, inSession: inSession === true }));
}

module.exports = Object.freeze({ PROFILE_IDS, PROFILE_ENV_KEYS, activeProfileId, describe, get, relaunchPlan });
