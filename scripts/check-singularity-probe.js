'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const main = read('src/main.js');
const index = read('src/index.html');
const renderer = read('src/renderer.js');
const live = read('src/workspace-composition/singularity-live-host.js');
const profile = read('src/workspace-composition/singularity-profile.js');
const panelModel = read('src/workspace-composition/singularity-panel-model.js');
const css = read('src/singularity-probe.css');
const mini = read('src/mini-player.js');
const miniHtml = read('src/mini-player.html');
const miniCss = read('src/mini-singularity-probe.css');
const integrationRunner = read('src/integration-test-runner.js');
const windowsIntegration = read('scripts/check-windows-integration.js');
const receiptAudit = read('scripts/check-singularity-receipts.js');
const launcher = read('Launch Pixelody.ps1');
const proxyLauncher = read('Start Pixelody Singularity Proxy.cmd');
const graphLauncher = read('Start Pixelody Singularity Graph.cmd');

for (const file of [
  'src/workspace-composition/singularity-contract.js',
  'src/workspace-composition/singularity-profile.js',
  'src/workspace-composition/singularity-panel-model.js',
  'src/workspace-composition/singularity-proxy-portal-probe.js',
  'src/workspace-composition/singularity-graph-projection-probe.js',
  'src/workspace-composition/singularity-live-host.js',
  'src/singularity-probe.css',
  'src/mini-singularity-probe.css',
]) assert.equal(fs.existsSync(path.join(root, file)), true, `Missing singularity probe file: ${file}`);

assert.match(main, /--pixelody-singularity-probe=/, 'Main process must accept the explicit development probe argument.');
assert.match(main, /const singularityProbeMode = isDevelopment && \['proxy', 'graph'\]\.includes\(singularityProbeCandidate\)/, 'Probe mode must be development-gated and allowlisted.');
assert.match(main, /singularityProbeMode,\s*\n\s*cachePolicy:/, 'Runtime info must expose only the bounded probe mode.');
assert.doesNotMatch(main, /PIXELODY_SINGULARITY_PROBE[^\n]+builtInThemeRegistry/, 'Probe must not mutate theme registry authority.');
assert.match(launcher, /\[ValidateSet\('', 'proxy', 'graph'\)\]/, 'Launcher must allow only the two probe routes.');
assert.match(launcher, /--pixelody-singularity-probe=\$SingularityProbe/, 'Launcher must forward probe mode as an explicit Electron argument.');
assert.match(proxyLauncher, /-SingularityProbe proxy/, 'Proxy launcher must select H-A.');
assert.match(graphLauncher, /-SingularityProbe graph/, 'Graph launcher must select H-B.');

const contractIndex = index.indexOf('workspace-composition/singularity-contract.js');
const profileIndex = index.indexOf('workspace-composition/singularity-profile.js');
const panelModelIndex = index.indexOf('workspace-composition/singularity-panel-model.js');
const proxyIndex = index.indexOf('workspace-composition/singularity-proxy-portal-probe.js');
const graphIndex = index.indexOf('workspace-composition/singularity-graph-projection-probe.js');
const liveIndex = index.indexOf('workspace-composition/singularity-live-host.js');
const rendererIndex = index.indexOf('renderer.js');
assert.ok(contractIndex > 0 && contractIndex < profileIndex && profileIndex < panelModelIndex && panelModelIndex < proxyIndex && proxyIndex < graphIndex && graphIndex < liveIndex && liveIndex < rendererIndex, 'Probe scripts must load profile/model dependencies before the probes and renderer.');
assert.match(index, /<link rel="stylesheet" href="singularity-probe\.css">/, 'Probe stylesheet must be present.');

assert.match(renderer, /const singularityLiveHostDomain = window\.PixelodySingularityLiveHost;/, 'Renderer must bind the live host.');
assert.match(renderer, /runtimeInfo\.isDevelopment === true && \['proxy', 'graph'\]\.includes\(runtimeInfo\.singularityProbeMode\)/, 'Renderer activation must repeat the development and allowlist gate.');
assert.match(renderer, /confirmedPublishedOutputSnapshot/, 'Live seam must read confirmed playback ownership.');
assert.match(renderer, /typeof optimizedArtwork === 'string' && optimizedArtwork/, 'Artwork optimization failure must not replace a usable path with a structured IPC rejection.');

assert.match(live, /const ROOT_SELECTORS = profile\.rootSelectors\(\)/, 'Live host must receive product-root selectors from the dedicated profile.');
for (const rootKey of ['library.browser', 'tracks.browser', 'track.information']) assert.ok(profile.includes(rootKey), `Singularity profile is missing ${rootKey}.`);
assert.match(profile, /singularity-gravitational-field-r2/, 'The dedicated gravitational profile must be versioned.');
assert.match(panelModel, /singularity-projective-panel-r1|profile\.MODEL_ID/, 'The dedicated whole-panel model must be versioned.');
assert.match(index, /data-singularity-product-root="albums\.collection"/, 'The collection hero must expose a bounded Stage 3 projection root.');
assert.match(index, /data-singularity-product-root="tracks\.collection"/, 'The track collection must expose a bounded Stage 3 projection root.');
assert.match(profile, /albums\.collection[^\n]+available: true/, 'Albums must use the theme-scoped split root.');
assert.match(live, /originalLocations\.set/, 'Live host must retain original DOM locations.');
assert.match(live, /restoreAllRoots\(\)/, 'Live host must provide complete root restoration.');
assert.match(live, /code: 'product-root-missing'/, 'A missing required product root must fail closed.');
assert.match(live, /code: 'mount-failed'/, 'An unexpected mount failure must return a bounded failure after teardown.');
assert.match(live, /element\.inert = !interactive/, 'Dormant real roots must be removed from interaction.');
assert.match(live, /projected\.visuallyPresent === true/, 'Graph roots must remain visually present while dormant.');
assert.match(live, /createElement\('div', 'sg-gravity-plane'\)/, 'H-B must create a dedicated whole-panel projection surface.');
assert.match(live, /plane\.style\.transform = projected\.model\.transform/, 'The custom model must drive the whole-panel surface transform.');
assert.match(live, /function normalizeGraphRoot\(element\)/, 'The custom profile host must neutralize conflicting legacy root layout.');
assert.match(live, /element\.style\.setProperty\(name, value, 'important'\)/, 'Whole-panel root normalization must outrank legacy important rules and remain teardown-restorable.');
assert.match(live, /mode === 'graph' \? 'none' : contract\.cssPolygon/, 'H-B must not clip the real module into a proxy wedge.');
assert.match(live, /setBox\(shell, projected\.contentRect\)/, 'H-B shell must own the projected module bounds.');
assert.match(live, /shell\.addEventListener\('pointerenter'/, 'The full projected surface must own hover rectification.');
assert.match(live, /shell\.addEventListener\('click'/, 'The full projected surface must support click-to-hold.');
assert.match(live, /event\.key !== 'Escape'/, 'Opened planes must support Escape return.');
assert.match(live, /applicationSurfaceOpen\(\)/, 'Plane Escape must defer to open product dialogs and menus.');
assert.match(live, /event\.stopPropagation/, 'A handled plane return must not also pop Pixelody navigation history.');
assert.match(live, /returnFocusId/, 'Close must retain a focus-return target.');
assert.match(live, /function visibleFocusEntry\(rootElement\)/, 'An opened product root must have a visible focus entry or become a temporary programmatic target.');
assert.match(live, /mode === 'proxy' \? portal\.id : shell\.id/, 'Proxy gates must control the real shared product portal rather than decorative shells.');
assert.match(live, /\$\{LABELS\[snapshot\.portal\.moduleId\]\} readable surface/, 'The active Proxy portal must expose the borrowed product job in its accessible label.');
assert.match(live, /temporaryFocusTargets/, 'Temporary root focusability must be tracked for exact restoration.');
assert.match(live, /aria-expanded/, 'Module gates must expose their held-open state to assistive technology.');
assert.match(live, /aria-controls/, 'Module gates must identify the projected surface they control.');

assert.match(css, /body\[data-singularity-probe\]>\.workspace\{visibility:hidden;pointer-events:none\}/, 'Legacy workspace must be visually and interactively suppressed only while the probe is active.');
assert.match(css, /--sg-paper:#f4f3ee/, 'Probe must retain the selected high-key material field.');
assert.match(css, /prefers-reduced-motion:reduce/, 'Probe must include a reduced-motion equivalent.');
assert.match(css, /prefers-reduced-motion:reduce[^}]+transition:none!important/, 'Reduced-motion must outrank the projective model transition.');
assert.match(css, /prefers-reduced-motion:reduce[^}]+will-change:auto!important/, 'Reduced-motion must release persistent projective layer hints.');
assert.match(css, /forced-colors:active/, 'Probe must retain an explicit forced-colors equivalent.');
assert.match(css, /\.sg-product-mount \.track-row:focus-visible,\.sg-shell-mount \.track-row:focus-visible\{outline:3px solid var\(--sg-ink\)/, 'Released track rows must have a theme-scoped high-contrast keyboard focus treatment.');
assert.match(css, /\.sg-gate:focus-visible,\.sg-product-mount \.track-row:focus-visible,\.sg-shell-mount \.track-row:focus-visible\{outline:2px solid Highlight;box-shadow:none\}/, 'Released track-row focus must retain a forced-colors equivalent.');
assert.match(css, /\.sg-confirmed-seam\[data-phase="paused"\]/, 'Paused confirmation must have a static structural distinction.');
assert.match(css, /\.sg-confirmed-seam\[data-phase="requested"\]/, 'A request must remain visually distinct from confirmed output.');
assert.match(css, /\.sg-confirmed-seam\[data-phase="failed"\]/, 'A failed request must remain visually distinct while confirmed output is retained.');
assert.match(panelModel, /perspective: 480, sideTurn: 58, sideSkew: 10/, 'Wide dormant panels must use the authored semi-extreme projection tokens.');
assert.match(panelModel, /rotateY\(\$\{tokens\.sideTurn\}deg\)/, 'Dormant Library must receive the custom centerward perspective turn.');
assert.match(panelModel, /rotateY\(-\$\{tokens\.sideTurn\}deg\)/, 'Dormant Tracks must mirror the custom perspective turn.');
assert.match(panelModel, /rotateX\(\$\{tokens\.depthTurn\}deg\)/, 'Dormant secondary work must fold toward the center in depth.');
assert.match(css, /\.sg-gravity-plane\{/, 'The custom gravitational plane must own transition and compositing behavior.');
assert.match(css, /transform:none!important/, 'Product roots must remain untransformed inside the custom plane.');
assert.match(css, /data-state="rectified-preview"/, 'Hover/focus preview must have a rectified visual state.');
assert.match(css, /#queueDrawer[^}]+z-index:110|#trackMenu,#playlistMenu,#queueDrawer/, 'Product dialogs and menus must remain reachable above the projection host.');
assert.match(renderer, /requestedId: published\.pending\?\.requestedId/, 'The live probe must consume the authoritative pending transition.');
assert.match(renderer, /failedRequestId: published\.failedId/, 'The live probe must consume authoritative failure truth.');
assert.match(renderer, /function observeConfirmedOutputTransition[\s\S]+singularityLiveHost\?\.refreshPlayback\(\)/, 'Playback transition receipts must refresh the center projection immediately.');
assert.doesNotMatch(live, /setInterval\(paintPlayback/, 'The center projection must not poll continuously while idle.');
assert.match(renderer, /singularityProbe: runtimeInfo\.isDevelopment === true/, 'The mini projection flag must remain development-gated.');
assert.match(miniHtml, /mini-singularity-probe\.css/, 'The mini probe relation must load its scoped stylesheet.');
assert.match(mini, /state\.singularityProbe/, 'The mini player must receive the development projection relation.');
assert.match(miniCss, /data-singularity-probe="graph"/, 'The mini probe treatment must remain scoped to the development mode.');
assert.match(miniCss, /body\[data-theme="studio"\]\[data-singularity-probe\] \.mini-shell/, 'The mini probe must outrank the Studio mini shell instead of relying on shadowed tokens.');
assert.match(mini, /bodyBackgroundColor/, 'The mini runtime receipt must report the actual high-key material state.');
assert.match(mini, /artworkApplied/, 'The mini runtime receipt must report confirmed-track artwork agreement.');
assert.match(miniCss, /forced-colors:active/, 'The mini projection must retain a forced-colors equivalent.');
assert.match(windowsIntegration, /'singularity-stage3'/, 'The Windows harness must expose the isolated Stage 3 scenario.');
assert.match(windowsIntegration, /'singularity-stage3-proxy'/, 'The Windows harness must expose the H-A comparison scenario.');
assert.match(windowsIntegration, /--pixelody-singularity-probe=graph/, 'The Windows scenario must use the explicit development probe gate.');
assert.match(windowsIntegration, /--pixelody-singularity-probe=proxy/, 'The H-A comparison scenario must use the explicit proxy gate.');
assert.match(windowsIntegration, /hostInProcessGpu && modeArgument !== 'unpacked'/, 'The renderer-host diagnostic must remain unpacked-only.');
assert.match(windowsIntegration, /hostInProcessGpu && visualMode/, 'The renderer-host diagnostic must not be accepted as painted evidence.');
assert.match(windowsIntegration, /if \(hostInProcessGpu\) args\.push\('--in-process-gpu'\)/, 'The renderer-host diagnostic must be explicit and opt-in.');
assert.match(windowsIntegration, /renderer-assertions-under-in-process-gpu/, 'The altered renderer-host pass must retain a distinct evidence class.');
assert.match(windowsIntegration, /--singularity-reduced-motion/, 'The Windows harness must expose an explicit Singularity OS reduced-motion evidence mode.');
assert.match(windowsIntegration, /renderer-assertions-os-reduced-motion-disabled-gpu/, 'OS reduced-motion runtime evidence must retain a distinct evidence class.');
assert.match(windowsIntegration, /scenario === 'counterform-choir' \|\| singularityReducedMotion/, 'The explicit Singularity mode must add the Chromium launch-level reduced-motion switch.');
assert.match(windowsIntegration, /singularityReducedMotion && \(visualMode \|\| hostInProcessGpu\)/, 'OS reduced-motion runtime evidence must remain separate from painted and altered-host evidence.');
assert.match(windowsIntegration, /--singularity-forced-colors/, 'The Windows harness must expose an explicit Singularity forced-colors evidence mode.');
assert.match(windowsIntegration, /renderer-assertions-forced-colors-disabled-gpu/, 'Forced-colors runtime evidence must retain a distinct evidence class.');
assert.match(windowsIntegration, /if \(singularityForcedColors\) args\.push\('--force-high-contrast'\)/, 'The explicit forced-colors mode must add the Chromium launch-level high-contrast switch.');
assert.match(windowsIntegration, /singularityForcedColors && \(visualMode \|\| hostInProcessGpu \|\| singularityReducedMotion\)/, 'Forced-colors runtime evidence must remain isolated from other evidence classes.');
assert.match(windowsIntegration, /paintedEvidence: visualMode/, 'Only an explicit visual-mode run may classify the retained receipt as painted evidence.');
assert.match(windowsIntegration, /gpuPerformanceEvidence: false/, 'Runtime and painted receipts must explicitly reject GPU performance evidence.');
assert.match(windowsIntegration, /ownerAcceptance: false/, 'Automated painted receipts must not claim owner acceptance.');
assert.match(windowsIntegration, /!singularityScenarios\.has\(scenarioArgument\)/, 'Separate Singularity evidence classes must coexist without global artifact cleanup.');
assert.match(windowsIntegration, /singularityScenarios\.has\(scenario\) \? `\$\{suffix\}-latest-failure`/, 'A flaky Singularity launch must not erase the last passing receipt for its evidence class.');
assert.match(windowsIntegration, /releaseChildOutputPipes\(child\)/, 'A crashed graphics grandchild must not keep the Windows harness alive through inherited output pipes.');
assert.match(windowsIntegration, /child\?\.unref\?\.\(\)/, 'A terminated graphics host must release its child-process event-loop reference.');
assert.match(windowsIntegration, /maxRetries: 8, retryDelay: 250/, 'Owned Windows profiles must receive bounded cleanup retries before a lock is deferred.');
assert.match(windowsIntegration, /singularityScenarios\.has\(scenario\)[\s\S]+retained failed Singularity profile/, 'A failed Singularity launch must preserve its isolated locked profile instead of hanging cleanup.');
assert.match(windowsIntegration, /main-\(\?:rest\|playing\|failure\|intermediate\|narrow\|compact\|zoom-200\|restored-maximized\)\|mini-compact/, 'The retained painted-evidence allowlist must include intermediate, fixed 200%, and restored-maximized main captures with no arbitrary mini variant.');
assert.match(integrationRunner, /async function scenarioSingularityStage3/, 'The Windows runner must exercise the real Stage 3 product path.');
assert.match(integrationRunner, /async function scenarioSingularityStage3Proxy/, 'The Windows runner must exercise the real H-A comparison product path.');
assert.match(integrationRunner, /main player did not agree with the confirmed track artwork/, 'The Windows scenario must prove confirmed-track artwork agreement in the main player.');
assert.match(main, /singularity-stage3-capture/, 'The Windows main process must retain painted Stage 3 capture receipts when visual mode is available.');
assert.match(main, /Accessibility\.getFullAXTree/, 'The Windows scenario must inspect Chromium\'s real accessibility tree.');
assert.match(main, /inspect-singularity-accessibility/, 'The accessibility-tree action must remain scenario-bounded.');
assert.match(main, /set-singularity-zoom-200/, 'The Windows scenario must expose only the fixed 200% zoom checkpoint.');
assert.match(main, /resize-singularity-intermediate[\s\S]+setSize\(1440, 800, false\)/, 'The Windows scenario must expose the exact ordinary-height intermediate viewport.');
assert.match(main, /singularity-pointer-preview-enter/, 'The Windows scenario must expose the bounded Electron pointer-preview action.');
assert.match(main, /singularity-keyboard-enter/, 'The Windows scenario must expose only bounded Electron keyboard actions.');
assert.match(main, /webContents\.sendInputEvent\(\{ type: 'rawKeyDown', keyCode \}\)/, 'Keyboard evidence must enter through Electron webContents input injection rather than only renderer-created events.');
assert.match(integrationRunner, /observedKey\.trusted === true/, 'The renderer must prove that Electron keyboard injection arrives as a trusted DOM event.');
assert.match(main, /webContents\.sendInputEvent\(\{ type: 'mouseMove'/, 'Pointer evidence must enter through Electron webContents input injection rather than only renderer-created events.');
assert.match(main, /webContents\.sendInputEvent\(\{\s*type: 'mouseWheel'/, 'Wheel evidence must enter through Electron webContents input injection rather than direct scroll assignment.');
assert.match(integrationRunner, /Singularity compact Electron wheel scrolling/, 'The renderer must prove that Electron wheel injection moves the released product scroller.');
assert.doesNotMatch(main, /webContents\.executeJavaScript/, 'Singularity pointer evidence must not widen main-process renderer evaluation.');
assert.match(integrationRunner, /document\.elementFromPoint\(x, y\)/, 'The sandboxed renderer must verify the pointer point against live hit testing before requesting host injection.');
assert.match(integrationRunner, /capture-window-state[\s\S]+rendererViewport: expectedViewport/, 'Each Singularity main capture must publish its exact renderer viewport into the native evidence snapshot.');
assert.match(main, /physicalInputEvidence: false/, 'Electron-injected pointer evidence must explicitly deny physical hardware input proof.');
assert.match(main, /osReducedMotion: app\.commandLine\.hasSwitch\('force-prefers-reduced-motion'\)/, 'The main process must expose the launch-level reduced-motion preference only through the test config.');
assert.match(integrationRunner, /verifySingularityOsReducedMotion/, 'Both product routes must exercise the independent OS reduced-motion checkpoint when requested.');
assert.match(integrationRunner, /document\.body\.dataset\.motion = 'expressive'/, 'The OS preference checkpoint must disable the authored motion-off suppressor before inspecting computed style.');
assert.match(integrationRunner, /mediaMatches = window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches/, 'The OS preference checkpoint must verify the renderer media query directly.');
assert.match(integrationRunner, /osReducedMotionEquivalent: osReducedMotion\.equivalent/g, 'Both Singularity terminal summaries must bind OS reduced-motion evidence to the requested run.');
assert.match(main, /forcedColors: app\.commandLine\.hasSwitch\('force-high-contrast'\)/, 'The main process must expose the launch-level forced-colors preference only through the test config.');
assert.match(integrationRunner, /verifySingularityForcedColors/, 'Both product routes must exercise the forced-colors checkpoint when requested.');
assert.match(integrationRunner, /window\.matchMedia\('\(forced-colors: active\)'\)\.matches/, 'The forced-colors checkpoint must verify the renderer media query directly.');
assert.match(integrationRunner, /forcedColorsEquivalent: forcedColors\.equivalent/g, 'Both Singularity terminal summaries must bind forced-colors evidence to the requested run.');
assert.match(integrationRunner, /verifySingularityZoom200/, 'Both product routes must exercise the bounded 200% zoom checkpoint.');
assert.match(integrationRunner, /focused hostile row was partially obscured at 200% zoom/, 'The live zoom checkpoint must reject an obscured focused track row.');
assert.match(integrationRunner, /focused hostile row lacked a rendered focus indicator at 200% zoom/, 'The live zoom checkpoint must require a rendered keyboard focus indicator.');
assert.match(main, /singularityGraphCapture[\s\S]+singularityProxyCapture/, 'Graph and Proxy capture actions must remain bound to their matching test scenarios.');
assert.match(integrationRunner, /capture-singularity-main-rest/, 'The Windows scenario must request a resting-field painted capture.');
assert.match(integrationRunner, /capture-singularity-main-intermediate/, 'The Windows scenario must retain an ordinary-height intermediate capture.');
assert.match(integrationRunner, /capture-singularity-main-zoom-200/, 'The Windows scenario must retain a fixed 200% painted capture.');
assert.match(integrationRunner, /capture-singularity-main-restored-maximized/, 'The Windows scenario must retain a restored-maximized capture.');
assert.match(integrationRunner, /capture-singularity-mini-compact/, 'The Windows scenario must request a mini-player painted capture.');
assert.match(integrationRunner, /capture-singularity-proxy-main-rest/, 'The H-A comparison must request a resting-field painted capture.');
assert.match(integrationRunner, /capture-singularity-proxy-main-intermediate/, 'The H-A comparison must retain an ordinary-height intermediate capture.');
assert.match(integrationRunner, /capture-singularity-proxy-main-zoom-200/, 'The H-A comparison must retain a fixed 200% painted capture.');
assert.match(integrationRunner, /capture-singularity-proxy-main-restored-maximized/, 'The H-A comparison must retain a restored-maximized capture.');
assert.match(integrationRunner, /capture-singularity-proxy-mini-compact/, 'The H-A comparison must request a mini-player painted capture.');
assert.match(windowsIntegration, /singularityEvidenceIdentity/, 'The retained receipt must bind each route to a machine-readable hypothesis identity.');
assert.match(windowsIntegration, /singularity-hostile-eight-track-r1/, 'The retained receipt must identify the deterministic hostile fixture.');
assert.match(windowsIntegration, /sourceScope:[\s\S]+bundleSha256/, 'The retained receipt must hash the scoped source bundle.');
assert.match(windowsIntegration, /captureIntegrity:[\s\S]+captureGeometry/, 'The retained receipt must bind every image hash to its capture geometry.');
assert.match(windowsIntegration, /scripts\/check-singularity-receipts\.js/, 'The machine receipt verifier must be included in the source bundle it validates.');
assert.match(receiptAudit, /candidateId, null/, 'The machine receipt verifier must reject silent candidate minting.');
assert.match(receiptAudit, /sourceEntries\.length, 26/, 'The machine receipt verifier must require the complete source scope.');
assert.match(receiptAudit, /expectedCaptures\(route\)/, 'The machine receipt verifier must require the exact route-specific painted capture set.');
assert.match(receiptAudit, /physicalPreferenceEvidence, false/, 'The machine receipt verifier must reject physical-preference overclaims.');
for (const evidence of ['collectionIdentitySplitRoot', 'independentAlbumBrowser', 'wholePanelPointerPreview', 'wholePanelPointerActivation', 'pointerPreviewDoesNotBorrow', 'electronPointerInput', 'electronWheelInput', 'wheelScrollOwnedByReleasedSurface', 'electronKeyboardInput', 'selectionSeparateFromCurrent', 'requestedConfirmedPausedFailedDistinct', 'mainPlayerAgreement', 'contextualOverlayEscapesIndependently', 'keyboardTrackActivation', 'intermediateOrdinaryHeight', 'responsiveSequenceRestored', 'activePlaneScroll', 'motionOffEquivalent', 'miniPlayerAgreement', 'lifecycleRestored', 'structuralFailureFallback', 'chromiumAccessibilityTree', 'zoom200']) {
  assert.ok(integrationRunner.includes(evidence), `The Windows scenario is missing ${evidence} evidence.`);
}

const themes = JSON.parse(read('src/themes/built-in-themes.json'));
assert.ok(Array.isArray(themes.themes) && themes.themes.length > 0, 'Built-in theme registry must remain readable.');
assert.equal(
  themes.themes.some((theme) => /singularity|folded/i.test(String(theme.runtimeKey || ''))),
  false,
  'Singularity probe must not register or mint a built-in theme.',
);

console.log('Singularity live-probe source audit passed: development-only activation, real-root ownership, safe restoration, high-key material, reduced motion, focus-visible treatment, and no Singularity candidate registration remain explicit.');
