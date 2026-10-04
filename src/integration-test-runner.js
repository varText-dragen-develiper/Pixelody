(async function runPixelodyIntegrationScenario() {
  'use strict';

  const bridge = window.desktop.integrationTest;
  if (!bridge?.enabled) return;
  await bridge.report('runner-bridge-ready', { bridgeEnabled: true, pathsHidden: true }).catch(() => {});
  const config = await bridge.getConfig().catch(() => ({ enabled: false }));
  if (!config?.enabled) {
    await bridge.report('runner-config-disabled', { code: config?.code || 'disabled', pathsHidden: true }).catch(() => {});
    return;
  }

  const startedAt = performance.now();
  const waitFor = async (predicate, timeoutMs, label) => {
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      if (await predicate()) return true;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new Error(`Timed out waiting for ${label}.`);
  };
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const report = (event, detail = {}) => bridge.report(event, detail);
  const currentFixture = () => currentTrack()?.id || '';
  const fixtureIds = ['fixture-tone-a', 'fixture-tone-b'];
  const STARTUP_INTERACTION_BUDGET_MS = 3200;

  const inspectSingularityAccessibility = async (label) => {
    const snapshot = await bridge.action('inspect-singularity-accessibility');
    assert(snapshot?.ok === true && snapshot.evidenceClass === 'chromium-accessibility-tree' && Array.isArray(snapshot.nodes), `${label} accessibility tree was not available (${snapshot?.code || 'unknown'}: ${snapshot?.message || 'no detail'}).`);
    assert(snapshot.nodes.length > 0, `${label} accessibility tree contained no bounded semantic nodes.`);
    return snapshot.nodes;
  };
  const accessibilityNode = (nodes, role, name) => nodes.find((node) => {
    if (node.role !== role) return false;
    const accessibleText = node.name || node.text || '';
    return typeof name === 'string' ? accessibleText.includes(name) : name.test(accessibleText);
  });
  const singularityPointerPoint = (selector, targetName) => {
    if (!selector) return { x: 2, y: 2, target: 'outside' };
    const target = document.querySelector(selector);
    if (!target) return null;
    const bounds = target.getBoundingClientRect();
    for (let row = 1; row <= 9; row += 1) {
      for (let column = 1; column <= 9; column += 1) {
        const x = Math.round(bounds.left + (bounds.width * column / 10));
        const y = Math.round(bounds.top + (bounds.height * row / 10));
        const hit = document.elementFromPoint(x, y);
        const ownsHit = selector.startsWith('.sg-gate')
          ? hit?.closest(selector) === target
          : hit?.closest('.sg-shell') === target && !hit?.closest('.sg-gate');
        if (ownsHit) return { x, y, target: targetName };
      }
    }
    return null;
  };
  const injectSingularityPointer = async (action, selector, targetName) => {
    const point = singularityPointerPoint(selector, targetName);
    assert(point, `${targetName || 'outside'} had no verified Electron pointer hit-test point for ${action}.`);
    return bridge.action(action, point);
  };
  const singularityWheelPoint = (root) => {
    const bounds = root?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
    for (let row = 2; row <= 8; row += 1) {
      for (let column = 2; column <= 8; column += 1) {
        const x = Math.round(bounds.left + (bounds.width * column / 10));
        const y = Math.round(bounds.top + (bounds.height * row / 10));
        const hit = document.elementFromPoint(x, y);
        if (hit && (hit === root || root.contains(hit))) return { x, y, target: 'tracks', deltaY: -612 };
      }
    }
    return null;
  };
  const injectSingularityWheel = async (root, label) => {
    const wheel = singularityWheelPoint(root);
    assert(wheel, `${label} had no verified Electron wheel hit-test point.`);
    const scrollBefore = root.scrollTop;
    let observedWheel = null;
    let resolveObservedWheel;
    const observedWheelPromise = new Promise((resolve) => { resolveObservedWheel = resolve; });
    root.addEventListener('wheel', (event) => {
      observedWheel = { trusted: event.isTrusted, deltaY: event.deltaY, targetFixture: event.target?.closest?.('.track-row')?.dataset?.id || '' };
      resolveObservedWheel(observedWheel);
    }, { capture: true, once: true });
    const result = await bridge.action('singularity-wheel-scroll', wheel);
    assert(result?.ok === true && result.evidenceClass === 'electron-webcontents-input-injection' && result.physicalInputEvidence === false, `${label} did not receive bounded Electron wheel input.`);
    await Promise.race([
      observedWheelPromise,
      new Promise((resolve) => setTimeout(() => resolve(null), 320)),
    ]);
    if (observedWheel) assert(observedWheel.trusted === true && observedWheel.deltaY !== 0, `${label} exposed an invalid DOM wheel event (${JSON.stringify(observedWheel)}).`);
    await report('singularity-wheel-observed', { action: 'singularity-wheel-scroll', domWheelObserved: Boolean(observedWheel), trusted: observedWheel?.trusted === true, deltaY: observedWheel?.deltaY || result.deltaY, targetFixture: observedWheel?.targetFixture || '', physicalInputEvidence: false, pathsHidden: true });
    await waitFor(() => root.scrollTop > scrollBefore, 800, `${label} native wheel scroll ownership`);
    const scrollAfter = root.scrollTop;
    await report('singularity-wheel-scroll-result', { action: 'singularity-wheel-scroll', nativeScrollMoved: true, scrollBefore, scrollAfter, scrollHeight: root.scrollHeight, clientHeight: root.clientHeight, physicalInputEvidence: false, pathsHidden: true });
    return { ...result, observedWheel, scrollBefore, scrollAfter };
  };
  const injectSingularityKey = async (action) => {
    const expectedKey = action === 'singularity-keyboard-enter' ? 'Enter' : 'Escape';
    let observedKey = null;
    let resolveObservedKey;
    const observedKeyPromise = new Promise((resolve) => { resolveObservedKey = resolve; });
    document.addEventListener('keydown', (event) => {
      observedKey = { key: event.key, trusted: event.isTrusted, targetId: event.target?.id || '', targetRole: event.target?.getAttribute?.('role') || '', targetFixture: event.target?.dataset?.id || '', targetModule: event.target?.dataset?.moduleId || '' };
      resolveObservedKey(observedKey);
    }, { capture: true, once: true });
    const result = await bridge.action(action);
    assert(result?.ok === true && result.evidenceClass === 'electron-webcontents-input-injection' && result.physicalInputEvidence === false, `${action} did not receive bounded Electron keyboard input.`);
    await Promise.race([
      observedKeyPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out waiting for ${action} trusted renderer event.`)), 800)),
    ]);
    assert(observedKey.key === expectedKey && observedKey.trusted === true, `${action} did not reach the renderer as a trusted ${expectedKey} keydown (${JSON.stringify(observedKey)}).`);
    await report('singularity-keyboard-observed', { action, key: observedKey.key, trusted: observedKey.trusted, targetId: observedKey.targetId, targetRole: observedKey.targetRole, targetFixture: observedKey.targetFixture, targetModule: observedKey.targetModule, physicalInputEvidence: false, pathsHidden: true });
    return { ...result, observedKey };
  };
  const verifySingularityOsReducedMotion = async (label, target) => {
    if (!config.osReducedMotion) return { requested: false, equivalent: 'not-requested' };
    assert(target, `${label} has no projective surface for OS reduced-motion evidence.`);
    const mediaMatches = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    assert(mediaMatches, `${label} did not receive the launch-level OS reduced-motion media preference.`);
    const savedMotion = {
      present: document.body.hasAttribute('data-motion'),
      value: document.body.getAttribute('data-motion'),
    };
    const savedHover = {
      present: document.body.hasAttribute('data-effect-hover'),
      value: document.body.getAttribute('data-effect-hover'),
    };
    let transitionDurations = [];
    let willChange = '';
    try {
      // Disable Pixelody's authored suppressors so this checkpoint is owned
      // by the Chromium media query rather than the hostile fixture setting.
      document.body.dataset.motion = 'expressive';
      document.body.dataset.effectHover = 'true';
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const style = getComputedStyle(target);
      transitionDurations = style.transitionDuration.split(',').map((value) => value.trim());
      willChange = style.willChange;
      assert(transitionDurations.length > 0 && transitionDurations.every((value) => value === '0s' || value === '0ms'), `${label} left projective transitions active under the OS reduced-motion media preference (${transitionDurations.join(', ')}).`);
      assert(willChange === 'auto', `${label} retained persistent projective layer promotion under the OS reduced-motion media preference (${willChange}).`);
      await report('singularity-os-reduced-motion', {
        mediaMatches,
        authoredMotionDuringCheck: document.body.dataset.motion,
        authoredHoverDuringCheck: document.body.dataset.effectHover,
        transitionDurations,
        willChange,
        evidenceClass: 'chromium-launch-preference-computed-style',
        physicalPreferenceEvidence: false,
        pathsHidden: true,
      });
    } finally {
      if (savedMotion.present) document.body.setAttribute('data-motion', savedMotion.value);
      else document.body.removeAttribute('data-motion');
      if (savedHover.present) document.body.setAttribute('data-effect-hover', savedHover.value);
      else document.body.removeAttribute('data-effect-hover');
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    assert(document.body.hasAttribute('data-motion') === savedMotion.present && document.body.getAttribute('data-motion') === savedMotion.value, `${label} did not restore the authored motion setting after OS preference inspection.`);
    assert(document.body.hasAttribute('data-effect-hover') === savedHover.present && document.body.getAttribute('data-effect-hover') === savedHover.value, `${label} did not restore the authored hover setting after OS preference inspection.`);
    return { requested: true, equivalent: true, mediaMatches, transitionDurations, willChange };
  };
  const verifySingularityForcedColors = async (label, host) => {
    if (!config.forcedColors) return { requested: false, equivalent: 'not-requested' };
    const mediaMatches = window.matchMedia('(forced-colors: active)').matches;
    assert(mediaMatches, `${label} did not receive the launch-level forced-colors media preference.`);
    const center = host?.querySelector('.sg-center');
    const gate = host?.querySelector('.sg-gate');
    assert(center && gate, `${label} has no center/gate surfaces for forced-colors evidence.`);
    const centerStyle = getComputedStyle(center);
    const gateStyle = getComputedStyle(gate);
    const evidence = {
      mediaMatches,
      center: {
        forcedColorAdjust: centerStyle.forcedColorAdjust,
        backgroundImage: centerStyle.backgroundImage,
        borderStyle: centerStyle.borderTopStyle,
        borderWidth: centerStyle.borderTopWidth,
      },
      gate: {
        forcedColorAdjust: gateStyle.forcedColorAdjust,
        backgroundImage: gateStyle.backgroundImage,
        borderStyle: gateStyle.borderTopStyle,
        borderWidth: gateStyle.borderTopWidth,
        color: gateStyle.color,
        backgroundColor: gateStyle.backgroundColor,
      },
    };
    assert(evidence.center.forcedColorAdjust === 'auto' && evidence.gate.forcedColorAdjust === 'auto', `${label} did not leave the critical Singularity surfaces under system-color adjustment (${JSON.stringify(evidence)}).`);
    assert(evidence.center.backgroundImage === 'none' && evidence.center.borderStyle === 'solid' && Number.parseFloat(evidence.center.borderWidth) >= 2, `${label} did not replace the decorative void material with a system-color center boundary (${JSON.stringify(evidence.center)}).`);
    assert(evidence.gate.backgroundImage === 'none' && evidence.gate.borderStyle === 'solid' && Number.parseFloat(evidence.gate.borderWidth) >= 1 && evidence.gate.color !== evidence.gate.backgroundColor, `${label} did not expose a distinguishable system-color gate (${JSON.stringify(evidence.gate)}).`);
    await report('singularity-forced-colors', {
      ...evidence,
      evidenceClass: 'chromium-launch-preference-computed-style',
      physicalPreferenceEvidence: false,
      pathsHidden: true,
    });
    return { requested: true, equivalent: true, ...evidence };
  };
  const captureSingularity = async (action) => {
    const mainCapture = !action.includes('-mini-');
    const expectedViewport = mainCapture
      ? { width: innerWidth, height: innerHeight, devicePixelRatio: window.devicePixelRatio }
      : null;
    if (expectedViewport) {
      await report('capture-window-state', {
        captureAction: action,
        rendererViewport: expectedViewport,
      });
    }
    const capture = await bridge.action(action);
    if (capture?.ok === true && expectedViewport) {
      assert(
        capture.rendererViewport?.width === expectedViewport.width
          && capture.rendererViewport?.height === expectedViewport.height
          && capture.rendererViewport?.devicePixelRatio === expectedViewport.devicePixelRatio,
        `${action} did not retain its exact renderer viewport in the native capture receipt.`,
      );
    }
    return capture;
  };
  const observeSingularityPlaybackPhases = (host) => {
    const phases = [host.dataset.playbackPhase || ''];
    const record = (records = []) => {
      for (const mutation of records) {
        if (mutation.oldValue) phases.push(mutation.oldValue);
      }
      phases.push(host.dataset.playbackPhase || '');
    };
    const observer = new MutationObserver(record);
    observer.observe(host, { attributes: true, attributeFilter: ['data-playback-phase'], attributeOldValue: true });
    return {
      stop() {
        record(observer.takeRecords());
        observer.disconnect();
        return phases.filter(Boolean);
      },
    };
  };
  const verifySingularityZoom200 = async (label, host, activeRoot, captureAction = '') => {
    const baselineWidth = innerWidth;
    let zoomedWidth = baselineWidth;
    let artifact = '';
    try {
      const response = await bridge.action('set-singularity-zoom-200');
      assert(response?.ok === true && Math.abs(response.zoomFactor - 2) < .01, `${label} could not enter the fixed 200% renderer zoom.`);
      await waitFor(() => innerWidth < baselineWidth * .7, 1800, `${label} 200% layout viewport`);
      zoomedWidth = innerWidth;
      assert(host.dataset.viewportTier === 'compact', `${label} did not retain the compact projection model at 200% zoom.`);
      const overflowers = [...document.querySelectorAll('body *')].map((element) => {
        const bounds = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return { tag: element.tagName, id: element.id || '', className: String(element.className || '').slice(0, 100), left: Math.round(bounds.left), right: Math.round(bounds.right), top: Math.round(bounds.top), bottom: Math.round(bounds.bottom), width: Math.round(bounds.width), display: style.display, visibility: style.visibility };
      }).filter((entry) => entry.display !== 'none' && entry.visibility !== 'hidden' && entry.bottom > 0 && entry.top < innerHeight && ((entry.right > innerWidth + 1 && entry.right < innerWidth + 800) || (entry.left < -1 && entry.left > -800))).sort((left, right) => Math.max(right.right - innerWidth, -right.left) - Math.max(left.right - innerWidth, -left.left)).slice(0, 16);
      const playerGeometry = [...document.querySelectorAll('.player,.player>* ,.player .transport-buttons,.player .timeline')].map((element) => {
        const bounds = element.getBoundingClientRect();
        return { id: element.id || '', className: String(element.className || '').slice(0, 50), left: Math.round(bounds.left), right: Math.round(bounds.right), width: Math.round(bounds.width), clientWidth: element.clientWidth, scrollWidth: element.scrollWidth };
      });
      assert(document.documentElement.scrollWidth <= innerWidth + 1, `${label} introduced horizontal document overflow at 200% zoom (${document.documentElement.scrollWidth} > ${innerWidth}; player=${JSON.stringify(playerGeometry)}; field=${JSON.stringify(overflowers)}).`);
      const topControls = ['profileButton', 'jamsButton', 'search', 'settingsButton'].map((id) => ({ id, bounds: document.getElementById(id)?.getBoundingClientRect() }));
      assert(topControls.every(({ bounds }) => bounds && bounds.width >= 36 && bounds.left >= 0 && bounds.right <= innerWidth + 1 && bounds.top >= 0 && bounds.bottom <= innerHeight + 1), `${label} lost a primary top-bar route at 200% zoom.`);
      const orderedTopControls = [...topControls].sort((left, right) => left.bounds.left - right.bounds.left);
      assert(orderedTopControls.every((item, index) => index === orderedTopControls.length - 1 || item.bounds.right <= orderedTopControls[index + 1].bounds.left + 1), `${label} overlapped primary top-bar routes at 200% zoom (${JSON.stringify(orderedTopControls.map((item) => ({ id: item.id, left: Math.round(item.bounds.left), right: Math.round(item.bounds.right), top: Math.round(item.bounds.top), bottom: Math.round(item.bounds.bottom), position: getComputedStyle(document.getElementById(item.id)).position })))}; viewport=${innerWidth}x${innerHeight}; theme=${document.body.dataset.theme}).`);
      for (const controlId of ['shuffleButton', 'prevButton', 'playButton', 'nextButton', 'repeatButton']) {
        const controlBounds = document.getElementById(controlId)?.getBoundingClientRect();
        assert(controlBounds && controlBounds.width >= 24 && controlBounds.height >= 24 && controlBounds.left >= 0 && controlBounds.right <= innerWidth + 1 && controlBounds.top >= 0 && controlBounds.bottom <= innerHeight + 1, `${label} lost usable ${controlId} transport geometry at 200% zoom.`);
      }
      for (const controlId of ['miniPlayerButton', 'queueButton', 'muteButton', 'playerSystemsButton']) {
        const controlBounds = document.getElementById(controlId)?.getBoundingClientRect();
        assert(controlBounds && controlBounds.width >= 24 && controlBounds.height >= 24 && controlBounds.left >= 0 && controlBounds.right <= innerWidth + 1 && controlBounds.top >= 0 && controlBounds.bottom <= innerHeight + 1, `${label} lost usable ${controlId} output geometry at 200% zoom.`);
      }
      const seekBounds = document.getElementById('seek')?.getBoundingClientRect();
      assert(seekBounds && seekBounds.width >= 36 && seekBounds.left >= 0 && seekBounds.right <= innerWidth + 1, `${label} lost the seek surface at 200% zoom.`);
      const volumeBounds = document.getElementById('volume')?.getBoundingClientRect();
      assert(volumeBounds && volumeBounds.width >= 36 && volumeBounds.left >= 0 && volumeBounds.right <= innerWidth + 1, `${label} lost the volume surface at 200% zoom.`);
      const playerTitleBounds = document.getElementById('playerTitle')?.getBoundingClientRect();
      assert(playerTitleBounds && playerTitleBounds.width >= 24 && playerTitleBounds.left >= 0 && playerTitleBounds.right <= innerWidth + 1, `${label} lost the current-track title at 200% zoom.`);
      const activeBounds = activeRoot.getBoundingClientRect();
      const playerBounds = document.querySelector('.player')?.getBoundingClientRect();
      const readableHeight = Math.max(0, Math.min(innerHeight, playerBounds?.top || innerHeight, activeBounds.bottom) - Math.max(0, activeBounds.top));
      assert(activeBounds.width >= innerWidth - 24 && readableHeight >= 96, `${label} did not retain a meaningful released Tracks reading area at 200% zoom (${Math.round(activeBounds.width)}×${Math.round(readableHeight)} CSS px).`);
      assert(activeRoot.scrollHeight > activeRoot.clientHeight, `${label} lost hostile-content scrolling at 200% zoom.`);
      assert(activeRoot.scrollWidth <= activeRoot.clientWidth + 1, `${label} required two-dimensional Tracks scrolling at 200% zoom (${activeRoot.scrollWidth} > ${activeRoot.clientWidth}).`);
      const zoomHostileRow = activeRoot.querySelector('.track-row[data-id="cf-track-04"]');
      assert(zoomHostileRow, `${label} lost the confirmed hostile row at 200% zoom.`);
      activeRoot.scrollTop = Math.max(0, zoomHostileRow.offsetTop - 8);
      await waitFor(() => {
        const bounds = zoomHostileRow.getBoundingClientRect();
        return bounds.bottom > activeBounds.top && bounds.top < Math.min(activeBounds.bottom, playerBounds.top);
      }, 800, `${label} visible confirmed hostile row at 200% zoom`);
      zoomHostileRow.focus({ preventScroll: true });
      const focusedRowBounds = zoomHostileRow.getBoundingClientRect();
      assert(focusedRowBounds.top >= activeBounds.top - 1 && focusedRowBounds.bottom <= Math.min(activeBounds.bottom, playerBounds.top) + 1, `${label} focused hostile row was partially obscured at 200% zoom.`);
      const focusedRowStyle = getComputedStyle(zoomHostileRow);
      assert(zoomHostileRow.matches(':focus-visible') && focusedRowStyle.outlineStyle === 'solid' && Number.parseFloat(focusedRowStyle.outlineWidth) >= 2 && focusedRowStyle.outlineColor !== 'rgba(0, 0, 0, 0)', `${label} focused hostile row lacked a rendered focus indicator at 200% zoom.`);
      const closeBounds = host.querySelector('.sg-close')?.getBoundingClientRect();
      assert(closeBounds && closeBounds.left >= 0 && closeBounds.right <= innerWidth + 1 && closeBounds.top >= 0 && closeBounds.bottom <= innerHeight + 1, `${label} moved Return to field outside the 200% viewport.`);
      const accessibility = await inspectSingularityAccessibility(`${label} 200% zoom`);
      assert(accessibilityNode(accessibility, 'option', /Not Yet Playing/)?.focused === true, `${label} lost focused hostile content from the accessibility tree at 200% zoom.`);
      document.getElementById('queueButton').click();
      await waitFor(() => !document.getElementById('queueDrawer').classList.contains('hidden') && document.activeElement === document.getElementById('closeQueue'), 1200, `${label} 200% queue focus entry`);
      const queueBounds = document.getElementById('queueDrawer').getBoundingClientRect();
      assert(queueBounds.left >= 0 && queueBounds.right <= innerWidth + 1 && queueBounds.top >= 0 && queueBounds.bottom <= playerBounds.top - 4, `${label} queue drawer escaped its 200% reading area or covered the player.`);
      const queueEscape = await injectSingularityKey('singularity-keyboard-escape');
      assert(queueEscape.observedKey.targetId === 'closeQueue', `${label} 200% Escape did not originate from the focused Queue close control.`);
      await waitFor(() => document.getElementById('queueDrawer').classList.contains('hidden'), 2400, `${label} 200% queue Escape closure`);
      await waitFor(() => document.activeElement === document.getElementById('queueButton'), 2400, `${label} 200% queue trigger focus return`);
      await report('singularity-zoom-queue-return', {
        label,
        queueHidden: true,
        activeElementId: document.activeElement?.id || '',
        triggerFocused: document.activeElement === document.getElementById('queueButton'),
        pathsHidden: true,
      });
      assert(host.dataset.openModule === 'tracks', `${label} 200% queue Escape also returned the Tracks plane.`);
      if (config.visualMode && captureAction) {
        const capture = await captureSingularity(captureAction);
        assert(capture?.ok === true, `${label} 200% painted capture failed.`);
        artifact = capture.artifact;
      }
    } finally {
      const reset = await bridge.action('reset-singularity-zoom');
      assert(reset?.ok === true && Math.abs(reset.zoomFactor - 1) < .01, `${label} could not restore the renderer zoom.`);
      await waitFor(() => innerWidth >= baselineWidth - 2, 1800, `${label} restored layout viewport`);
    }
    return { baselineWidth, zoomedWidth, artifact };
  };


  async function waitForStartup() {
    await waitFor(() => ['interactive', 'settled'].includes(document.body.dataset.readiness), STARTUP_INTERACTION_BUDGET_MS, 'usable renderer state');
    try {
      await waitFor(() => {
        const screen = $('#themeLoadScreen');
        // `active` and `leaving` are the painted/blocking states. The cleanup
        // class may be removed by a concurrent startup-to-development theme
        // handoff after the screen has already returned to its inert base
        // state, so requiring `.hidden` creates a false startup failure.
        return !document.body.classList.contains('theme-loading')
          && (!screen || (!screen.classList.contains('active') && !screen.classList.contains('leaving')));
      }, 6500, 'bounded startup reveal');
    } catch (error) {
      const screen = $('#themeLoadScreen');
      throw new Error(`${error.message} (body=${document.body.className || 'none'}; screen=${screen?.className || 'missing'}; reveal=${document.body.dataset.startupReveal || 'unset'}).`);
    }
    const startupMs = performance.now() - startedAt;
    assert(startupMs <= STARTUP_INTERACTION_BUDGET_MS, `Startup exceeded the ${STARTUP_INTERACTION_BUDGET_MS} ms interaction budget (${Math.round(startupMs)} ms).`);
    assert(document.body.dataset.runtimeInfoReady === 'true', 'Startup cover cleared before runtime/theme authority reconciled.');
    assert(document.body.dataset.startupAuthorityReady === 'true', 'Startup reveal receipt was captured without final runtime authority.');
    assert(document.body.dataset.startupRevealTheme === document.body.dataset.theme, 'Startup revealed a provisional theme before the selected theme mounted.');
    const runtime = await window.desktop.getRuntimeInfo();
    assert(Boolean(runtime.isPackaged) === Boolean(config.packaged), 'Runtime packaged mode did not match the launch target.');
    assert(window.desktop.runtimeSecurity?.sandboxed === true, 'Main renderer is not sandboxed.');
    assert(window.desktop.runtimeSecurity?.contextIsolated === true, 'Main renderer is not context isolated.');
    assert(window.desktop.runtimeSecurity?.windowKind === 'main', 'Main renderer received the wrong preload capability set.');
    const sharing = await window.desktop.getSharingStatus();
    assert(sharing?.enabled !== true, 'J.A.M. unexpectedly started during startup.');
    await report('startup-ready', {
      startupMs: Math.round(startupMs),
      packaged: Boolean(runtime.isPackaged),
      trackCount: state.tracks.length,
      queueCount: state.queue.length,
      sharingEnabled: false,
      motionMode: document.body.dataset.motion || '',
      revealTheme: document.body.dataset.startupRevealTheme || '',
      authorityBeforeReveal: document.body.dataset.startupAuthorityReady === 'true',
      reducedMotionMedia: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      pathsHidden: true,
    });
    return startupMs;
  }

  async function scenarioFresh(startupMs) {
    assert(state.tracks.length === 0, 'Fresh profile unexpectedly contained tracks.');
    assert(state.queue.length === 0, 'Fresh profile unexpectedly contained a queue.');
    const status = await bridge.getStatus();
    assert(status.mainOpen && !status.miniOpen && !status.sharingEnabled, 'Fresh profile lifecycle state was not isolated and idle.');
    return { startupMs: Math.round(startupMs), fresh: true, trackCount: 0, queueCount: 0 };
  }

  async function scenarioCore(startupMs) {
    assert(state.tracks.length === 2 && state.queue.length === 2, 'Generated fixture library or queue did not load.');
    assert(fixtureIds.every((id) => state.tracks.some((track) => track.id === id)), 'Generated fixture IDs were not present.');
    await playTrack('fixture-tone-a', { source: 'integration-test' });
    await waitFor(() => currentFixture() === 'fixture-tone-a' && !audio.paused, 5000, 'fixture A playback');
    await waitFor(() => audio.currentTime > 0.05, 3500, 'fixture A playback clock');

    $('#shuffleButton').click();
    assert(state.shuffle === true, 'Shuffle did not enable.');
    $('#shuffleButton').click();
    assert(state.shuffle === false, 'Shuffle did not disable.');
    $('#repeatButton').click();
    assert(state.repeat === 'all', 'Repeat did not advance to all.');

    $('#nextButton').click();
    await waitFor(() => currentFixture() === 'fixture-tone-b' && !audio.paused, 5000, 'next-track command');
    $('#prevButton').click();
    await waitFor(() => currentFixture() === 'fixture-tone-a' && !audio.paused, 5000, 'previous-track command');

    await waitFor(() => Number.isFinite(audio.duration) && audio.duration > 1, 3000, 'fixture metadata');
    audio.currentTime = Math.min(0.65, audio.duration - 0.1);
    await waitFor(() => audio.currentTime >= 0.5, 1500, 'seek state');
    setPlayerVolume(0.42);
    assert(Math.abs(audio.volume - 0.42) < 0.01, 'Volume command did not apply.');

    await window.desktop.openMiniPlayer();
    await waitFor(async () => (await bridge.getStatus()).miniOpen, 3500, 'mini-player window');
    const miniStatus = await bridge.getStatus();
    assert(miniStatus.miniSecurity?.sandbox === true && miniStatus.miniSecurity?.contextIsolation === true && miniStatus.miniSecurity?.nodeIntegration === true, 'Mini renderer security preferences are not hardened.');
    // The mini window boots a second renderer before its preload can report;
    // 2.5 s timed out on loaded Windows runners, so it gets its neighbours' budget.
    await waitFor(async () => (await bridge.getStatus()).miniReportedSecurity?.windowKind === 'mini', 5000, 'mini preload security report');
    const reportedMini = (await bridge.getStatus()).miniReportedSecurity;
    assert(reportedMini?.sandboxed === true && reportedMini?.contextIsolated === true, 'Mini preload did not report sandbox and context isolation.');
    await waitFor(() => audio.paused, 3500, 'mini-player toggle command');
    await bridge.action('close-mini');
    await waitFor(async () => !(await bridge.getStatus()).miniOpen, 2500, 'mini-player close');

    const currentBeforeKeyboard = currentFixture();
    const currentRow = document.querySelector(`#trackRows .track-row[data-id="${encodeURIComponent(currentBeforeKeyboard)}"]`);
    assert(currentRow, 'Current track row was not rendered for keyboard coverage.');
    const keyboardRows = Array.from(document.querySelectorAll('#trackRows .track-row'));
    const keyboardKey = keyboardRows.indexOf(currentRow) === 0 ? 'ArrowDown' : 'ArrowUp';
    currentRow.focus();
    currentRow.dispatchEvent(new KeyboardEvent('keydown', { key: keyboardKey, bubbles: true, cancelable: true }));
    const focusedRow = document.activeElement?.closest?.('#trackRows .track-row');
    const focusedId = focusedRow ? decodeURIComponent(focusedRow.dataset.id) : '';
    assert(focusedId && focusedId !== currentBeforeKeyboard, 'Keyboard navigation did not move focus to a distinct track.');
    assert(currentFixture() === currentBeforeKeyboard && audio.paused, 'Keyboard focus changed confirmed playback state.');

    focusedRow.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 32, clientY: 32 }));
    assert(state.menuTrackId === focusedId, 'Context menu did not target the keyboard-selected track.');

    const failedTrack = trackById(focusedId);
    const failedPath = failedTrack.path;
    failedTrack.path = `${failedPath}.missing`;
    failedTrack.missing = false;
    await playTrack(focusedId, { source: 'integration-core-failed-activation' });
    assert(currentFixture() === currentBeforeKeyboard && audio.paused, 'Failed activation stole the paused confirmed-current identity.');
    failedTrack.path = failedPath;
    failedTrack.missing = false;

    // A Settings open must reach two painted frames without rebuilding the
    // whole appearance tree. This is intentionally measured while the fixture
    // library is mounted so regressions scale the same way they do in-product.
    const settingsStartedAt = performance.now();
    openSettings({ tab: 'general', opener: $('#settingsButton') });
    // The harness deliberately disables GPU compositing. Use the renderer's
    // bounded paint primitive so a throttled requestAnimationFrame cannot hang
    // the receipt while still requiring two presentation opportunities.
    await waitForPaint(120);
    await waitForPaint(120);
    const settingsPaintMs = performance.now() - settingsStartedAt;
    assert(!$('#settingsOverlay').classList.contains('hidden'), 'Settings did not become visible.');
    assert(settingsPaintMs <= 750, `Settings blocked two painted frames for ${Math.round(settingsPaintMs)} ms.`);
    closeSettings();
    await waitFor(() => $('#settingsOverlay').classList.contains('hidden'), 750, 'Settings close');

    const originalMotion = appearance.motion;
    appearance.motion = 'calm';
    applyAppearance();
    const loaderStartedAt = performance.now();
    assert(showThemeLoadScreen('studio', 720, { mode: 'theme-switch' }), 'Theme loader did not mount.');
    assert(document.body.classList.contains('theme-loading'), 'Theme loader did not lock the program while its receipt was playing.');
    await waitForPaint(120);
    await waitForPaint(120);
    const loadScreen = $('#themeLoadScreen');
    const loaderPaintMs = performance.now() - loaderStartedAt;
    const loaderAnimations = loadScreen.getAnimations({ subtree: true })
      .filter((animation) => ['running', 'finished'].includes(animation.playState));
    assert(loaderAnimations.length >= 3, 'Theme loader has no active painted choreography.');
    assert(getComputedStyle($('.theme-load-ink')).filter === 'none', 'Theme loader retained its full-screen blur path.');
    const loaderMotionTarget = $('.theme-load-ink span:nth-child(3)');
    const loaderMotionAnimation = loaderMotionTarget.getAnimations()[0];
    const loaderMotionKeyframes = loaderMotionAnimation?.effect?.getKeyframes?.() || [];
    const loaderMotionTransforms = loaderMotionKeyframes
      .map((keyframe) => String(keyframe.transform || ''))
      .filter(Boolean);
    const loaderHasTransformDelta = new Set(loaderMotionTransforms).size >= 2;
    const loaderTimeBefore = Number(loaderMotionAnimation?.currentTime) || 0;
    let loaderTransformBefore = getComputedStyle(loaderMotionTarget).transform;
    let loaderTimeAfter = loaderTimeBefore;
    let loaderTransformAfter = loaderTransformBefore;
    let loaderMotionVerification = 'live-clock';
    if (document.visibilityState === 'visible') {
      await waitForPaint(180);
      loaderTimeAfter = Number(loaderMotionAnimation?.currentTime) || 0;
      loaderTransformAfter = getComputedStyle(loaderMotionTarget).transform;
    } else if (loaderMotionAnimation) {
      // Electron throttles a fully obscured integration window. Seek the real
      // CSS animation so hidden-window validation still proves painted travel.
      loaderMotionVerification = 'seeked-hidden-window';
      const restoreTime = loaderMotionAnimation.currentTime;
      loaderMotionAnimation.currentTime = 0;
      loaderTransformBefore = getComputedStyle(loaderMotionTarget).transform;
      loaderMotionAnimation.currentTime = 380;
      loaderTimeAfter = Number(loaderMotionAnimation.currentTime) || 0;
      loaderTransformAfter = getComputedStyle(loaderMotionTarget).transform;
      loaderMotionAnimation.currentTime = restoreTime;
    }
    const loaderMotionChanged = loaderHasTransformDelta && (
      document.visibilityState === 'visible'
        ? loaderTimeAfter > loaderTimeBefore && loaderTransformBefore !== loaderTransformAfter
        : loaderTimeAfter > 0 && loaderTransformBefore !== loaderTransformAfter
    );
    assert(loaderMotionChanged, `Theme loader animations exist but do not move (phase=${loadScreen.dataset.loadPhase}; motion=${document.body.dataset.motion}; visibility=${document.visibilityState}; verification=${loaderMotionVerification}; play=${loaderMotionAnimation?.playState || 'missing'}; keyframes=${loaderMotionTransforms.length}; time=${Math.round(loaderTimeBefore)}->${Math.round(loaderTimeAfter)}; transform=${loaderTransformBefore}->${loaderTransformAfter}).`);
    await waitForThemeLoadAnimation();
    const loaderPlaythroughMs = performance.now() - loaderStartedAt;
    assert(loadScreen.classList.contains('active') && document.body.classList.contains('theme-loading'), 'Theme loader released the program before its choreography completed.');
    assert(loaderPlaythroughMs >= 680, `Theme loader cut its 720 ms choreography short after ${Math.round(loaderPlaythroughMs)} ms.`);
    const loaderExitMs = hideThemeLoadScreen();
    assert(loaderExitMs <= 360, `Theme loader exit remained blocking for ${loaderExitMs} ms.`);
    await waitFor(() => loadScreen.classList.contains('hidden') && !loadScreen.classList.contains('active') && !document.body.classList.contains('theme-loading'), 750, 'theme loader exit');
    appearance.motion = originalMotion;
    applyAppearance();

    const themeBeforeRoundTrip = appearance.theme;
    await selectTheme('studio');
    await selectTheme(themeBeforeRoundTrip);
    assert(appearance.theme === themeBeforeRoundTrip, 'Theme switch and return did not restore the active theme.');

    durableSessionState = { id: currentFixture(), time: audio.currentTime, volume: audio.volume };
    persist();
    await durableStateController.flush('integration-core');
    return {
      startupMs: Math.round(startupMs),
      playback: true,
      previousNext: true,
      shuffle: state.shuffle,
      repeat: state.repeat,
      seeked: audio.currentTime >= 0.5,
      volume: Number(audio.volume.toFixed(2)),
      queueCount: state.queue.length,
      miniPlayer: true,
      keyboardFocus: true,
      focusedTrackDistinctFromCurrent: true,
      failurePreservedCurrent: true,
      contextMenuTargetedFocusedTrack: true,
      settingsPaintMs: Math.round(settingsPaintMs),
      loaderPaintMs: Math.round(loaderPaintMs),
      loaderAnimations: loaderAnimations.length,
      loaderMotionChanged,
      loaderMotionVerification,
      loaderPlaythroughMs: Math.round(loaderPlaythroughMs),
      loaderExitMs,
      themeRoundTrip: true,
    };
  }

  async function scenarioThemePackage(startupMs) {
    const initial = await window.desktop.listThemePackages();
    assert(initial?.ok === true && initial.packages.length === 0, 'The isolated profile did not begin with an empty local-theme store.');
    assert(appearance.theme === 'studio' && document.body.dataset.theme === 'studio', 'The local-theme scenario did not begin in Studio.');

    const installed = await bridge.action('install-theme-package-fixture');
    assert(installed?.ok === true && installed.installed === true && installed.package?.id === 'creator.theme-name', 'The declarative fixture was not atomically installed.');
    assert(appearance.theme === 'studio', 'Installing a local theme applied it without explicit user confirmation.');

    const listed = await refreshCommunityThemes();
    assert(listed?.ok === true && listed.packages.length === 1 && communityThemes.size === 1, 'The installed package did not appear in My Themes.');
    const theme = listed.packages[0];
    assert(theme.runtimeKey.startsWith('community:creator.theme-name@1.0.0:'), 'The package did not receive a content-addressed runtime key.');
    assert(document.querySelector(`[data-community-runtime-key="${CSS.escape(theme.runtimeKey)}"]`), 'My Themes did not render an Apply control for the package.');

    await selectTheme(theme.runtimeKey);
    assert(appearance.theme === theme.runtimeKey, 'Explicit Apply did not make the package active.');
    assert(document.body.dataset.theme === 'community' && document.body.dataset.communityThemeId === theme.id, 'The main renderer did not enter the bounded community-theme recipe.');
    const mainAccent = getComputedStyle(document.documentElement).getPropertyValue('--gold').trim().toLowerCase();
    assert(mainAccent === theme.tokens.accentPrimary.toLowerCase(), 'The main renderer did not apply the validated primary token.');
    assert(navigationDispatcher.getCurrentKey() === theme.navigation.trackBrowser, 'The registered navigation mechanic was not applied.');

    broadcastPlayerState();
    const broadcast = await bridge.getStatus();
    assert(broadcast.playerState?.theme === 'community' && broadcast.playerState?.communityTheme?.id === theme.id, 'The bounded community descriptor was not published to the mini-player channel.');
    await window.desktop.openMiniPlayer();
    await waitFor(async () => (await bridge.getStatus()).miniOpen, 3500, 'community mini-player window');
    await waitFor(async () => {
      const status = await bridge.getStatus();
      return status.miniCommunityThemeState?.theme === 'community' && status.miniCommunityThemeState?.id === theme.id;
    }, 3000, 'community theme in the mini renderer');
    const mini = (await bridge.getStatus()).miniCommunityThemeState;
    assert(mini.accent.toLowerCase() === theme.tokens.accentPrimary.toLowerCase(), 'The mini renderer did not apply the validated primary token.');
    assert(mini.runtimeSecurity?.sandboxed === true && mini.runtimeSecurity?.contextIsolated === true, 'The themed mini renderer was not sandboxed and isolated.');
    await bridge.action('close-mini');

    await selectTheme('studio');
    const removed = await window.desktop.deleteThemePackage({ id: theme.id, version: theme.version, hash: theme.hash });
    assert(removed?.ok === true, 'The exact installed package could not be deleted.');
    const afterDelete = await refreshCommunityThemes();
    assert(afterDelete?.ok === true && afterDelete.packages.length === 0 && communityThemes.size === 0, 'The deleted package remained available.');
    assert(appearance.theme === 'studio' && document.body.dataset.theme === 'studio', 'Deleting the local theme did not leave Pixelody in Studio.');

    return {
      startupMs: Math.round(startupMs),
      installedInactive: true,
      listedInMyThemes: true,
      contentAddressed: true,
      explicitApply: true,
      mainApplied: true,
      registeredNavigation: true,
      miniApplied: true,
      exactDelete: true,
      studioFallback: true,
    };
  }

  async function scenarioThemePackageWrite(startupMs) {
    const initial = await window.desktop.listThemePackages();
    assert(initial?.ok === true && initial.packages.length === 0, 'The restart fixture did not begin with an empty local-theme store.');
    const installed = await bridge.action('install-theme-package-fixture');
    assert(installed?.ok === true && installed.installed === true, 'The restart fixture package was not installed.');
    const listed = await refreshCommunityThemes();
    const theme = listed?.packages?.[0];
    assert(theme?.hash?.length === 64 && theme.runtimeKey.endsWith(theme.hash), 'The persisted selection does not contain the full immutable package hash.');
    await selectTheme(theme.runtimeKey);
    assert(appearance.theme === theme.runtimeKey && document.body.dataset.communityThemeId === theme.id, 'The restart fixture was not active before shutdown.');
    assert(JSON.parse(localStorage.getItem('pixelody.appearance') || '{}').theme === theme.runtimeKey, 'The exact package identity was not persisted before shutdown.');
    await durableStateController.flush('theme-package-restart-fixture');
    return { startupMs: Math.round(startupMs), exactIdentityPersisted: true, packageRetained: true };
  }

  async function scenarioThemePackageRead(startupMs) {
    await waitFor(() => communityThemes.size === 1, 3500, 'installed local theme after restart');
    const listed = await window.desktop.listThemePackages();
    const theme = listed?.packages?.[0];
    assert(theme && theme.runtimeKey.endsWith(theme.hash), 'Restart did not retain the exact installed package identity.');
    assert(appearance.theme === 'studio' && document.body.dataset.theme === 'studio', 'The Studio reset did not keep the retained package inactive after restart.');
    await selectTheme(theme.runtimeKey);
    assert(appearance.theme === theme.runtimeKey, 'The test-only explicit Apply route did not select the retained package.');
    assert(document.body.dataset.theme === 'community' && document.body.dataset.communityThemeId === theme.id, 'Explicit Apply did not restore the community presentation in the main renderer.');
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--gold').trim().toLowerCase();
    assert(accent === theme.tokens.accentPrimary.toLowerCase(), 'Restart restored the identity but not its validated tokens.');

    broadcastPlayerState();
    await window.desktop.openMiniPlayer();
    await waitFor(async () => {
      const status = await bridge.getStatus();
      return status.miniCommunityThemeState?.id === theme.id && status.miniCommunityThemeState?.theme === 'community';
    }, 3500, 'restored local theme in the mini renderer');
    await bridge.action('close-mini');

    await selectTheme('studio');
    const removed = await window.desktop.deleteThemePackage({ id: theme.id, version: theme.version, hash: theme.hash });
    assert(removed?.ok === true, 'The restored exact package could not be deleted.');
    await refreshCommunityThemes();
    return { startupMs: Math.round(startupMs), exactIdentityRetained: true, restartInactiveDuringReset: true, explicitApply: true, mainApplied: true, miniApplied: true, exactDelete: true };
  }

  async function scenarioCounterformChoir(startupMs) {
    const ids = Array.from({ length: 8 }, (_, index) => `cf-track-${String(index + 1).padStart(2, '0')}`);
    const captureCandidate = async (action) => {
      await report('capture-window-state', {
        rendererViewport: {
          width: innerWidth,
          height: innerHeight,
          devicePixelRatio: window.devicePixelRatio,
        },
      });
      const receipt = await bridge.action(action).catch((error) => ({ ok: false, code: 'capture_invoke_error', message: String(error?.message || error).slice(0, 180) }));
      await report('candidate-capture-result', { action, receipt });
      return receipt || { ok: false, code: 'capture_no_receipt' };
    };
    assert(appearance.theme === 'counterform-choir', 'Counterform Choir fixture did not start in the candidate theme.');
    assert(state.tracks.length === 8 && ids.every((id) => state.tracks.some((track) => track.id === id)), 'Counterform hostile fixture did not load all eight stable track IDs.');
    assert(navigationDispatcher.getCurrentKey() === 'chorus-fold', 'Counterform Choir did not mount the Chorus Fold mechanic.');
    await waitFor(() => document.querySelectorAll('#trackRows .chorus-fold-voice').length === 8, 3000, 'eight Chorus Fold voices');

    const initialId = currentFixture();
    assert(initialId === 'cf-track-03' && audio.paused, 'Counterform fixture did not restore the paused current identity.');
    const initialVoice = document.querySelector(`#trackRows .chorus-fold-voice[data-id="${encodeURIComponent(initialId)}"]`);
    assert(initialVoice?.classList.contains('is-current') && initialVoice.classList.contains('is-paused'), 'Paused current voice was not explicit at startup.');

    // The owner-requested hover lock hides the mouse only while its perimeter
    // hue remains a local substitute. It releases beyond its bounded buffer.
    const hoverVoices = Array.from(document.querySelectorAll('#trackRows .chorus-fold-voice'));
    assert(hoverVoices.length === 8, 'Counterform hover-lock coverage did not receive all hostile voices.');
    assert(hoverVoices.every((voice) => getComputedStyle(voice).clipPath.includes('polygon')), 'Counterform title voices lost their authored polygonal silhouettes.');
    const collectiveVoices = hoverVoices.filter((voice) => voice.dataset.stage === 'collective');
    await report('counterform-collective-title-faces', collectiveVoices.map((voice) => ({
      id: voice.dataset.id || '',
      backgroundImage: getComputedStyle(voice).backgroundImage,
      backgroundColor: getComputedStyle(voice).backgroundColor,
      clipPath: getComputedStyle(voice).clipPath,
    })));
    assert(collectiveVoices.length > 0 && collectiveVoices.every((voice) => getComputedStyle(voice).backgroundImage !== 'none'), 'Counterform collective title voices lost their distinct polygonal material faces.');
    const originalVoiceFilters = new Map(hoverVoices.map((voice) => [voice, getComputedStyle(voice).filter]));
    for (const voice of hoverVoices) {
      const bounds = voice.getBoundingClientRect();
      voice.dispatchEvent(new PointerEvent('pointerover', {
        bubbles: true,
        pointerType: 'mouse',
        clientX: bounds.left + bounds.width / 2,
        clientY: bounds.top + bounds.height / 2,
      }));
      assert(voice.classList.contains('is-hover-locked'), `Counterform hover lock did not reach voice ${voice.dataset.id || 'unknown'}.`);
      const perimeter = document.querySelector('.chorus-fold-hover-perimeter.is-active');
      const polygon = perimeter?.querySelector('polygon');
      assert(perimeter?.dataset.voiceId === voice.dataset.id && polygon?.getAttribute('points')?.split(' ').length >= 6, `Counterform geometric hover perimeter did not resolve the existing silhouette for voice ${voice.dataset.id || 'unknown'}.`);
      assert(getComputedStyle(voice).filter === originalVoiceFilters.get(voice), `Counterform hover treatment altered title-card paint for voice ${voice.dataset.id || 'unknown'}.`);
    }
    const initialVoiceBounds = initialVoice.getBoundingClientRect();
    initialVoice.dispatchEvent(new PointerEvent('pointerover', {
      bubbles: true,
      pointerType: 'mouse',
      clientX: initialVoiceBounds.left + initialVoiceBounds.width / 2,
      clientY: initialVoiceBounds.top + initialVoiceBounds.height / 2,
    }));
    assert(initialVoice.classList.contains('is-hover-locked') && document.body.classList.contains('counterform-hover-lock'), 'Counterform hover lock did not replace the pointer with a local perimeter cue.');
    const hoverLockStyle = getComputedStyle(initialVoice);
    assert(hoverLockStyle.cursor === 'none', 'Counterform hover lock did not hide the native cursor while its hue was active.');
    assert(document.querySelector('.chorus-fold-hover-perimeter.is-active')?.dataset.voiceId === initialVoice.dataset.id && hoverLockStyle.filter === originalVoiceFilters.get(initialVoice), 'Counterform hover lock did not expose a detached perimeter cue without altering title-card paint.');
    document.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      pointerType: 'mouse',
      clientX: initialVoiceBounds.right + 80,
      clientY: initialVoiceBounds.bottom + 80,
    }));
    assert(!initialVoice.classList.contains('is-hover-locked') && !document.body.classList.contains('counterform-hover-lock'), 'Counterform hover lock did not release after leaving its bounded buffer.');
    await report('counterform-hover-lock', { mouseOnly: true, allVoicesCovered: true, allTitleSilhouettesPolygonal: true, collectiveTitleFacesRestored: true, cursorHidden: true, detachedPerimeterOverlay: true, existingCardPaintPreserved: true, polyhedralPerimeter: true, releasedBeyondBuffer: true, stationaryVoice: true });

    // Owner usability repair: the score-margin library is a real drawer, the
    // cabinet has separate named destinations, and the resting Now Playing
    // summary can be adjusted without inventing playback state.
    const libraryHandle = $('#toggleLibrary');
    libraryHandle.click();
    assert(document.body.classList.contains('library-collapsed'), 'Library handle did not close the real drawer.');
    libraryHandle.click();
    {
      const drawer = $('.library-rail');
      const bounds = drawer?.getBoundingClientRect();
      const style = drawer ? getComputedStyle(drawer) : null;
      await report('counterform-library-drawer-attempt', { width: Math.round(bounds?.width || 0), height: Math.round(bounds?.height || 0), position: style?.position || '', display: style?.display || '', top: style?.top || '' });
    }
    await waitFor(() => {
      const drawer = $('.library-rail');
      const playlistList = $('#playlistList');
      const bounds = drawer?.getBoundingClientRect();
      return !document.body.classList.contains('library-collapsed') && bounds?.width > 240 && bounds?.height > 160 && playlistList?.children.length > 0;
    }, 1800, 'visible Counterform library drawer');
    const libraryDrawerBounds = $('.library-rail').getBoundingClientRect();
    await report('counterform-library-drawer', { width: Math.round(libraryDrawerBounds.width), height: Math.round(libraryDrawerBounds.height), playlists: $('#playlistList').children.length });
    const cabinetToggle = $('#counterformWorkspaceCabinetToggle');
    const cabinetPanel = $('#counterformWorkspaceCabinetPanel');
    cabinetToggle.click();
    assert(cabinetPanel && !cabinetPanel.hidden && cabinetPanel.querySelectorAll('[data-counterform-cabinet-action]').length === 3, 'Workspace Cabinet did not expose distinct background, track-info, and reset controls.');
    cabinetToggle.click();
    assert(cabinetPanel.hidden, 'Workspace Cabinet did not close cleanly.');
    const nowPlayingResize = $('#counterformNowPlayingResize');
    const nowPlayingWidthBefore = Number(nowPlayingResize.getAttribute('aria-valuenow'));
    nowPlayingResize.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    assert(Number(nowPlayingResize.getAttribute('aria-valuenow')) > nowPlayingWidthBefore, 'Keyboard resize did not widen resting Now Playing.');
    assert(Number(JSON.parse(localStorage.getItem('pixelody.layout') || '{}').nowPlayingWidth) > nowPlayingWidthBefore, 'Now Playing width did not persist locally.');
    const trackInfoResize = $('#counterformTrackInfoResize');
    const trackInfoWidthBefore = Number(trackInfoResize.getAttribute('aria-valuenow'));
    trackInfoResize.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    assert(Number(trackInfoResize.getAttribute('aria-valuenow')) > trackInfoWidthBefore, 'Keyboard resize did not widen collapsed Track Information.');
    assert(Number(JSON.parse(localStorage.getItem('pixelody.layout') || '{}').trackInfoWidth) > trackInfoWidthBefore, 'Track Information width did not persist locally.');
    const compactTrackInfo = $('#heroTrackInfo');
    const inspectorHandle = $('#toggleInspector');
    const compactTrackInfoTitle = $('#metadataTitle');
    const compactTrackInfoArtwork = $('#metadataArt');
    const compactTrackInfoBounds = compactTrackInfo.getBoundingClientRect();
    const inspectorHandleBounds = inspectorHandle.getBoundingClientRect();
    const compactTrackInfoTitleBounds = compactTrackInfoTitle.getBoundingClientRect();
    const compactTrackInfoArtworkBounds = compactTrackInfoArtwork.getBoundingClientRect();
    const overlaps = compactTrackInfoBounds.left < inspectorHandleBounds.right
      && compactTrackInfoBounds.right > inspectorHandleBounds.left
      && compactTrackInfoBounds.top < inspectorHandleBounds.bottom
      && compactTrackInfoBounds.bottom > inspectorHandleBounds.top;
    assert(compactTrackInfoBounds.width >= 210 && compactTrackInfoBounds.height >= 70, 'Collapsed Track Information did not retain a usable title/artwork summary.');
    assert(!overlaps, 'Collapsed Track Information and the inspector handle overlap.');
    await report('counterform-compact-track-info', {
      left: Math.round(compactTrackInfoBounds.left),
      top: Math.round(compactTrackInfoBounds.top),
      width: Math.round(compactTrackInfoBounds.width),
      height: Math.round(compactTrackInfoBounds.height),
      title: compactTrackInfoTitle.textContent || '',
      titleDisplay: getComputedStyle(compactTrackInfoTitle).display,
      titleLeft: Math.round(compactTrackInfoTitleBounds.left),
      titleTop: Math.round(compactTrackInfoTitleBounds.top),
      titleWidth: Math.round(compactTrackInfoTitleBounds.width),
      titleColor: getComputedStyle(compactTrackInfoTitle).color,
      titleOpacity: getComputedStyle(compactTrackInfoTitle).opacity,
      artworkWidth: Math.round(compactTrackInfoArtworkBounds.width),
      artworkHeight: Math.round(compactTrackInfoArtworkBounds.height),
      position: getComputedStyle(compactTrackInfo).position,
      offsetParent: compactTrackInfo.offsetParent?.id || compactTrackInfo.offsetParent?.className || '',
      overlapWithInspectorHandle: overlaps,
    });

    initialVoice.focus();
    initialVoice.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    let selectedVoice = document.activeElement?.closest?.('.chorus-fold-voice');
    let selectedId = selectedVoice ? decodeURIComponent(selectedVoice.dataset.id) : '';
    assert(selectedId === 'cf-track-04', 'Arrow navigation did not move selection to the next complete voice.');
    assert(currentFixture() === initialId && audio.paused, 'Selection changed paused-current truth.');

    selectedVoice.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert($('#trackRows').dataset.hasRequest === 'true', 'Activation request was not exposed before host confirmation.');
    assert(currentFixture() === initialId, 'Activation request optimistically stole current identity.');
    await waitFor(() => currentFixture() === 'cf-track-04' && !audio.paused, 5000, 'Counterform confirmed playback');
    await waitFor(() => document.querySelector('.chorus-fold-voice.is-playing')?.dataset.id === encodeURIComponent('cf-track-04'), 2500, 'confirmed playing voice');
    await waitFor(() => currentFixture() === 'cf-track-04' && !audio.paused && audio.currentTime > .15, 2500, 'stable Counterform playback before current-voice toggle');

    const playingVoice = document.querySelector('.chorus-fold-voice.is-playing');
    await report('current-voice-toggle-before-dispatch', {
      activeId: currentFixture(),
      paused: audio.paused,
      currentTime: Number(audio.currentTime.toFixed(3)),
      duration: Number(audio.duration.toFixed(3)),
      voiceId: playingVoice?.dataset.id || '',
    });
    playingVoice.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 120));
    await report('current-voice-toggle-dispatch', {
      activeId: currentFixture(),
      paused: audio.paused,
      requested: $('#trackRows').dataset.hasRequest === 'true',
      selected: document.querySelector('.chorus-fold-voice.is-selected')?.dataset.id || '',
    });
    await waitFor(() => audio.paused && currentFixture() === 'cf-track-04', 3000, 'current-voice click pause');
    assert($('#trackRows').dataset.hasRequest !== 'true', 'Current-voice pause fabricated a new activation request.');
    playingVoice.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    await waitFor(() => !audio.paused && currentFixture() === 'cf-track-04', 3000, 'current-voice keyboard resume');
    playingVoice.focus();
    playingVoice.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    selectedVoice = document.activeElement?.closest?.('.chorus-fold-voice');
    selectedId = selectedVoice ? decodeURIComponent(selectedVoice.dataset.id) : '';
    assert(selectedId === 'cf-track-05', 'Selected intent did not advance independently after playback confirmation.');
    assert(currentFixture() === 'cf-track-04' && !audio.paused, 'Selected intent replaced the confirmed playing track.');
    assert(document.querySelector('.chorus-fold-voice.is-selected') !== document.querySelector('.chorus-fold-voice.is-playing'), 'Selected and confirmed-playing states collapsed onto one voice.');

    selectedVoice.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
    assert(state.menuTrackId === 'cf-track-05', 'Context menu did not target the selected Chorus Fold voice.');
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await waitFor(() => $('#trackMenu')?.classList.contains('hidden'), 1200, 'Counterform context menu close');
    await new Promise((resolve) => setTimeout(resolve, 320));
    const maximizedReceipt = await bridge.action('maximize-main');
    assert(maximizedReceipt?.ok === true && maximizedReceipt.windowState?.isMaximized === true, 'Counterform wide evidence did not enter a maximized ordinary window.');
    const wideCapture = await captureCandidate('capture-main-wide');
    assert(wideCapture?.isMaximized === true && wideCapture?.isFullScreen === false, 'Counterform wide capture was not a maximized, non-kiosk application window.');
    assert(window.matchMedia('(prefers-reduced-motion: reduce)').matches, 'Counterform packaged launch did not receive the reduced-motion media contract.');
    const reducedMotionCapture = await captureCandidate('capture-main-reduced-motion');
    const grayscaleCapture = await captureCandidate('capture-main-grayscale');
    assert(grayscaleCapture?.evidenceClass === 'painted-perceptual-derivative', 'Grayscale evidence was not labeled as a painted-surface derivative.');

    await window.desktop.openMiniPlayer();
    await waitFor(async () => (await bridge.getStatus()).miniOpen, 3500, 'Counterform mini window');
    await waitFor(async () => {
      const status = await bridge.getStatus();
      return status.miniCounterformState?.theme === 'counterform-choir'
        && status.miniCounterformState?.title === '미완성 궤도 / Not Yet Playing'
        && status.miniCounterformState?.paused === false
        && /CURRENT \/ 미완성 궤도/.test(status.miniCounterformState?.current || '');
    }, 3500, 'Counterform mini state projection');
    // The mini reports its projected DOM state before Chromium necessarily
    // commits that update to the painted surface. Keep the state receipt and
    // painted capture claim-matched with a bounded settle delay. Do not wait on
    // the main renderer's animation frame here: Windows may throttle it while
    // the always-on-top mini owns focus.
    await new Promise((resolve) => setTimeout(resolve, 320));
    const miniCapture = await captureCandidate('capture-mini-playing');
    const broadcastStatus = await bridge.getStatus();
    assert(broadcastStatus.playerState?.theme === 'counterform-choir' && broadcastStatus.playerState?.chorus?.current?.id === 'cf-track-04', 'Normal player-state broadcast omitted the confirmed chorus relation.');

    $('#playButton').click();
    await waitFor(() => audio.paused, 3000, 'Counterform pause');
    await waitFor(() => document.querySelector('.chorus-fold-voice.is-paused')?.dataset.id === encodeURIComponent('cf-track-04'), 1800, 'paused current voice');
    assert(!document.body.classList.contains('is-playing'), 'Pause left the global confirmed-playing class active.');
    const pausedCapture = await captureCandidate('capture-main-paused');
    await waitFor(async () => {
      const status = await bridge.getStatus();
      return status.miniCounterformState?.theme === 'counterform-choir'
        && status.miniCounterformState?.paused === true
        && /CURRENT \/ 미완성 궤도/.test(status.miniCounterformState?.current || '');
    }, 2500, 'Counterform paused mini state projection');
    await new Promise((resolve) => setTimeout(resolve, 260));
    const pausedFullMiniCapture = await captureCandidate('capture-mini-paused-full');

    $('#playButton').click();
    await waitFor(() => !audio.paused && currentFixture() === 'cf-track-04', 3000, 'Counterform resume before compact-mini pair');
    const compactReceipt = await bridge.action('resize-mini-compact');
    assert(compactReceipt?.ok === true && compactReceipt.bounds?.width === 340 && compactReceipt.bounds?.height === 148, 'Real mini did not enter its declared compact minimum.');
    await new Promise((resolve) => setTimeout(resolve, 260));
    const compactMiniCapture = await captureCandidate('capture-mini-compact');
    $('#playButton').click();
    await waitFor(() => audio.paused, 3000, 'Counterform compact-mini pause');
    await waitFor(async () => (await bridge.getStatus()).miniCounterformState?.paused === true, 2500, 'Counterform compact paused mini state projection');
    await new Promise((resolve) => setTimeout(resolve, 260));
    const pausedMiniCapture = await captureCandidate('capture-mini-paused');

    selectedVoice = document.querySelector('.chorus-fold-voice.is-selected');
    selectedVoice.focus();
    selectedVoice.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
    const failedVoiceRequest = document.activeElement?.closest?.('.chorus-fold-voice');
    assert(decodeURIComponent(failedVoiceRequest?.dataset.id || '') === 'cf-track-08', 'End did not reach the hostile missing-source voice.');
    failedVoiceRequest.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await waitFor(() => document.querySelector('.chorus-fold-voice.is-failed')?.dataset.id === encodeURIComponent('cf-track-08'), 3000, 'failed activation receipt');
    assert(currentFixture() === 'cf-track-04' && audio.paused, 'Failed activation stole confirmed paused-current identity.');
    const failureCapture = await captureCandidate('capture-main-failure');

    const emptyPlaylist = document.querySelector('.playlist-item[data-playlist="empty-score"]');
    assert(emptyPlaylist, 'Hostile empty collection was not rendered in normal playlist navigation.');
    emptyPlaylist.click();
    await waitFor(() => !$('#dropZone').classList.contains('hidden') && $('#trackTable').classList.contains('hidden'), 1800, 'empty collection surface');
    assert($('#playlistTitle').textContent.includes('Empty Score'), 'Empty collection literal identity was lost.');
    const emptyCapture = await captureCandidate('capture-main-empty');
    document.querySelector('.playlist-item[data-playlist="all"]')?.click();
    await waitFor(() => document.querySelectorAll('#trackRows .chorus-fold-voice').length === 8, 1800, 'return to populated score');

    await selectTheme('studio');
    assert(navigationDispatcher.getCurrentKey() === 'linear-list', 'Theme switch did not restore the safe linear fallback.');
    await waitFor(() => $('#themeLoadScreen')?.classList.contains('hidden'), 1000, 'completed Studio load surface before Counterform return');
    const returnToCounterform = selectTheme('counterform-choir');
    await waitFor(() => $('#themeLoadScreen')?.classList.contains('active') && $('#themeLoadScreen')?.dataset.loadTheme === 'counterform-choir', 800, 'Counterform real theme-load surface');
    const loadingCapture = await captureCandidate('capture-main-loading');
    await returnToCounterform;
    assert(navigationDispatcher.getCurrentKey() === 'chorus-fold' && document.querySelectorAll('.chorus-fold-voice').length === 8, 'Theme return did not restore Chorus Fold state.');

    if (state.repeat !== 'one') $('#repeatButton').click();
    if (state.repeat !== 'one') $('#repeatButton').click();
    assert(state.repeat === 'one', 'Counterform narrow proof could not pin the confirmed current against the four-second fixture boundary.');
    $('#playButton').click();
    await waitFor(() => currentFixture() === 'cf-track-04' && !audio.paused, 3000, 'Counterform resumed current before narrow proof');
    await waitFor(() => getComputedStyle($('.chorus-fold-collective'), '::before').backgroundColor === 'rgb(255, 253, 250)', 1200, 'narrow confirmed collective aperture eligibility');

    appearance.motion = 'off';
    applyMotionEffects();
    const narrowWindowReceipt = await bridge.action('resize-main-narrow');
    assert(narrowWindowReceipt?.ok === true && narrowWindowReceipt.windowState?.isMaximized === false, 'Counterform narrow evidence did not leave maximized state through the bounded host action.');
    await new Promise((resolve) => setTimeout(resolve, 320));
    // The four-second hostile fixture can cross its natural boundary while a
    // resize settles. Apply conserve after that bounded settle so this records
    // the actual narrow surface mode instead of a stale pre-resize value.
    setPlaybackPerformance('conserve', 'counterform-c3-narrow');
    assert(innerWidth >= 1020 && innerWidth <= 1050, `Counterform narrow minimum viewport did not apply (${innerWidth}px).`);
    assert(motionDisabled(), `Counterform motion-off mode did not apply (appearance=${appearance.motion}, media=${window.matchMedia('(prefers-reduced-motion: reduce)').matches}).`);
    assert(document.body.dataset.performance === 'conserve', `Counterform conserve mode did not apply (performance=${document.body.dataset.performance || 'unset'}).`);
    const narrowVoice = document.querySelector('.chorus-fold-voice');
    const narrowVoices = Array.from(document.querySelectorAll('.chorus-fold-voice')).slice(0, 2);
    assert(narrowVoice && narrowVoices.length === 2 && narrowVoices.every((voice) => getComputedStyle(voice).clipPath.includes('polygon')), 'Chorus Fold did not retain its material silhouette at the narrow constraint.');
    assert(Math.abs(narrowVoices[0].getBoundingClientRect().left - narrowVoices[1].getBoundingClientRect().left) > 18, 'Narrow Chorus Fold lost the opposing-course seam.');
    const narrowCapture = await captureCandidate('capture-main-narrow');
    assert(narrowCapture?.minimumSize?.[0] === 900, 'Narrow evidence did not record the production main-window minimum alongside the 1050px stress target.');
    const narrowScroller = $('.main-stage');
    const narrowThroatVoice = document.querySelectorAll('.chorus-fold-voice')[4];
    narrowThroatVoice?.scrollIntoView({ block: 'center', behavior: 'auto' });
    await new Promise((resolve) => setTimeout(resolve, 240));
    assert(narrowThroatVoice && narrowScroller.scrollTop > 40 && narrowThroatVoice.getBoundingClientRect().top < innerHeight, 'Narrow Chorus Fold evidence did not scroll the real main-stage path to the shared throat.');
    const narrowFoldCapture = await captureCandidate('capture-main-narrow-fold');
    const narrowCurrent = document.querySelector('.chorus-fold-voice.is-playing');
    narrowCurrent?.scrollIntoView({ block: 'center', behavior: 'auto' });
    await new Promise((resolve) => setTimeout(resolve, 220));
    const collective = $('.chorus-fold-collective');
    const collectiveBounds = collective.getBoundingClientRect();
    const currentBounds = narrowCurrent?.getBoundingClientRect();
    const apertureStyle = getComputedStyle(collective, '::before');
    const collectiveStyle = getComputedStyle(collective);
    assert($('#trackRows').dataset.playback === 'playing' && apertureStyle.backgroundColor === 'rgb(255, 253, 250)' && apertureStyle.clipPath.includes('polygon'), 'Narrow aperture lost its host-confirmed opaque collective absence before capture.');
    const currentStyle = getComputedStyle(narrowCurrent);
    assert(decodeURIComponent(narrowCurrent.dataset.id || '') === 'cf-track-04' && narrowCurrent.classList.contains('is-current'), 'Narrow visual current diverged from host activeId.');
    assert(currentBounds && Number(currentStyle.zIndex) > Number(collectiveStyle.zIndex), 'Literal current truth no longer layers above the collective aperture.');
    await report('narrow-aperture-proof', { playback: $('#trackRows').dataset.playback, collective: { x: Math.round(collectiveBounds.x), y: Math.round(collectiveBounds.y), width: Math.round(collectiveBounds.width), height: Math.round(collectiveBounds.height), zIndex: collectiveStyle.zIndex }, aperture: { backgroundColor: apertureStyle.backgroundColor, clipPath: apertureStyle.clipPath, height: apertureStyle.height, width: apertureStyle.width, zIndex: apertureStyle.zIndex }, current: { id: decodeURIComponent(narrowCurrent.dataset.id || ''), classes: narrowCurrent.className, state: narrowCurrent.querySelector('.chorus-fold-state')?.textContent || '', x: Math.round(currentBounds.x), y: Math.round(currentBounds.y), width: Math.round(currentBounds.width), height: Math.round(currentBounds.height), color: currentStyle.color, backgroundColor: currentStyle.backgroundColor, backgroundImage: currentStyle.backgroundImage, zIndex: currentStyle.zIndex } });
    const narrowApertureCapture = await captureCandidate('capture-main-narrow-aperture');
    $('#playButton').click();
    await waitFor(() => audio.paused && currentFixture() === 'cf-track-04', 3000, 'Counterform narrow paused comparator');
    await new Promise((resolve) => setTimeout(resolve, 220));
    const narrowPausedCapture = await captureCandidate('capture-main-narrow-paused');

    await bridge.action('close-mini');
    await waitFor(async () => !(await bridge.getStatus()).miniOpen, 2500, 'Counterform mini close');
    const restoredMaximizedReceipt = await bridge.action('maximize-main');
    assert(restoredMaximizedReceipt?.ok === true && restoredMaximizedReceipt.windowState?.isMaximized === true, 'Counterform monitoring window did not return to maximized state after narrow evidence.');
    await waitFor(() => innerWidth === restoredMaximizedReceipt.windowState.contentBounds.width, 1800, 'restored maximized renderer viewport');
    await report('main-window-maximized-renderer-settled', {
      rendererViewport: { width: innerWidth, height: innerHeight, devicePixelRatio: window.devicePixelRatio },
      hostWindowState: restoredMaximizedReceipt.windowState,
    });

    return {
      startupMs: Math.round(startupMs),
      fixtureId: 'counterform-choir-stress-v1',
      trackCount: 8,
      chorusFoldMounted: true,
      selectedDistinctFromPlaying: true,
      requestedBeforeConfirmed: true,
      confirmedPlayback: true,
      currentVoiceToggle: true,
      hoverLock: true,
      visibleLibraryDrawer: true,
      workspaceCabinet: true,
      persistedNowPlayingWidth: true,
      persistedTrackInfoWidth: true,
      pausePreservedCurrent: true,
      failedActivationPreservedCurrent: true,
      contextMenuSelectedVoice: true,
      realMiniProjection: true,
      emptyCollection: true,
      narrowMotionOffConserve: true,
      osReducedMotionMedia: true,
      grayscalePaintedDerivative: true,
      loadingApplicationPath: true,
      compactMiniFallback: true,
      compactMiniPausedDifferential: true,
      themeFallbackAndReturn: true,
      captures: [wideCapture, reducedMotionCapture, grayscaleCapture, miniCapture, pausedFullMiniCapture, compactMiniCapture, pausedCapture, pausedMiniCapture, failureCapture, emptyCapture, loadingCapture, narrowCapture, narrowFoldCapture, narrowApertureCapture, narrowPausedCapture].map((capture) => capture?.artifact || `UNVERIFIED:${capture?.kind || 'unknown'}:${capture?.code || 'unknown'}`),
    };
  }

  async function scenarioFlowRuntime(startupMs) {
    assert(state.tracks.length === 2 && state.queue.length === 2, 'Flow runtime fixture library or queue did not load.');
    const firstId = 'fixture-tone-a';
    const secondId = 'fixture-tone-b';
    const first = trackById(firstId);
    const second = trackById(secondId);
    assert(first && second, 'Flow runtime fixture tracks were not present.');

    Object.assign(first, { bpm: 96, musicalKey: '8A', energyLevel: 42, genre: 'Ambient' });
    Object.assign(second, { bpm: null, musicalKey: '', energyLevel: null, genre: '' });
    state.queue = [];
    state.shuffleStyle = 'flow';
    state.shuffle = true;
    resetFlowShuffleCycle('');
    renderQueue();
    assert(activeQueue().length === 0 && adjacentTrack(1) === null, 'Empty queue did not stop Flow traversal.');
    assert($('#queueEmpty').classList.contains('hidden') === false, 'Empty queue surface did not appear.');

    state.queue = [firstId];
    resetFlowShuffleCycle('');
    renderQueue();
    await playTrack(firstId, { source: 'integration-flow-runtime' });
    await waitFor(() => currentFixture() === firstId && !audio.paused, 5000, 'one-track Flow playback');
    const oneTrackNext = adjacentTrack(1);
    assert((oneTrackNext === null || oneTrackNext.id === firstId) && !flowShuffleRuntime.pending, 'One-track queue generated an invalid staged Flow candidate.');

    state.queue = [firstId, secondId];
    resetFlowShuffleCycle(firstId);
    renderQueue();
    await playTrack(firstId, { source: 'integration-flow-runtime' });
    await waitFor(() => currentFixture() === firstId && !audio.paused, 5000, 'Flow starting track');
    assert(first.bpm === 96 && second.bpm === null && second.musicalKey === '', 'Mixed metadata fixture was not applied.');

    const planned = adjacentTrack(1);
    assert(planned && flowShuffleRuntime.pending?.trackId === planned.id, 'Flow pick was not staged before playback.');
    const stagedCursor = state.flowShuffle.plan?.cursor;
    const stagedFuture = [...(state.flowShuffle.plan?.future || [])];
    assert(stagedFuture.includes(planned.id) || planned.id === secondId, 'Staged Flow candidate was consumed early.');

    second.path = `${second.path}.missing`;
    second.missing = false;
    await playTrack(planned.id, { source: 'integration-flow-failed-playback' });
    assert(currentFixture() === firstId, 'Failed Flow playback changed the current track.');
    assert(flowShuffleRuntime.pending === null, 'Failed Flow playback left a stale staged candidate.');
    assert(state.flowShuffle.plan?.cursor === stagedCursor, 'Failed Flow playback consumed the traversal cursor.');
    assert((state.flowShuffle.plan?.future || []).includes(planned.id) || planned.id === secondId, 'Failed Flow playback consumed the candidate.');

    second.path = `${second.path.slice(0, -8)}`;
    second.missing = false;
    const committed = adjacentTrack(1);
    assert(committed?.id === planned.id, 'Flow did not re-stage the failed candidate.');
    await playTrack(committed.id, { source: 'integration-flow-commit' });
    await waitFor(() => currentFixture() === committed.id && !audio.paused, 5000, 'successful Flow playback commit');
    assert(flowShuffleRuntime.pending === null, 'Successful Flow playback left a staged candidate.');
    assert(state.flowShuffle.plan?.cursor !== stagedCursor, 'Successful Flow playback did not commit traversal.');
    assert(state.flowShuffle.lastPick?.decision?.version === 1, 'Successful Flow playback did not retain a decision receipt.');
    assert(document.querySelector('#flowShuffleWhyPlan')?.textContent?.trim(), 'Flow decision plan position was not rendered.');

    state.flowShuffle = flowShuffleEngine.markPriority(state.flowShuffle, firstId, { front: true });
    renderQueue();
    const manual = adjacentTrack(1);
    assert(manual?.id === firstId && flowShuffleRuntime.pending?.priority === true, 'Manual Play Next did not outrank Flow.');
    await playTrack(firstId, { source: 'integration-flow-manual-next' });
    await waitFor(() => currentFixture() === firstId && !audio.paused, 5000, 'manual Play Next playback');

    resetFlowShuffleCycle(firstId);
    state.flowShuffle.priorityIds = [];
    renderQueue();
    const generatedAgain = adjacentTrack(1);
    assert(generatedAgain, 'Flow did not create a committed traversal for Previous/Next coverage.');
    await playTrack(generatedAgain.id, { source: 'integration-flow-generated-history' });
    await waitFor(() => currentFixture() === generatedAgain.id && !audio.paused, 5000, 'second generated Flow playback');
    const previous = adjacentTrack(-1);
    assert(previous, 'Previous did not traverse after multiple Flow picks.');
    await playTrack(previous.id, { source: 'integration-flow-previous' });
    await waitFor(() => currentFixture() === previous.id, 5000, 'Flow previous traversal');
    const next = adjacentTrack(1);
    assert(next, 'Next did not traverse after Flow previous.');
    await playTrack(next.id, { source: 'integration-flow-next' });
    await waitFor(() => currentFixture() === next.id, 5000, 'Flow next traversal');

    state.repeat = 'one';
    assert(adjacentTrack(1, true)?.id === currentFixture(), 'Repeat one did not hold the current track.');
    state.repeat = 'all';
    assert(adjacentTrack(1, true), 'Repeat all did not produce a natural-ending candidate.');
    state.repeat = 'off';

    const beforeMutation = state.queue.slice();
    const mutationTarget = beforeMutation.find((id) => id !== currentFixture());
    const mutationPick = adjacentTrack(1);
    if (mutationPick) {
      state.queue = state.queue.filter((id) => id !== mutationPick.id);
      renderQueue();
      assert(!state.flowShuffle.plan?.future?.includes(mutationPick.id), 'Queue removal left an invalid planned track.');
      assert(!flowShuffleRuntime.pending || state.queue.includes(flowShuffleRuntime.pending.trackId), 'Queue mutation left an invalid staged track.');
    }
    state.queue = [firstId, secondId];
    if (mutationTarget && state.queue.includes(mutationTarget)) state.queue = [mutationTarget, ...state.queue.filter((id) => id !== mutationTarget)];
    renderQueue();
    assert(state.flowShuffle.plan?.sourceQueueIds?.every((id) => state.queue.includes(id)), 'Queue reorder left stale Flow source IDs.');

    const remoteResult = await handleRemotePlaybackCommand({ action: 'next' }, { auth: { kind: 'guest', deviceId: 'fixture-remote' } });
    assert(typeof remoteResult === 'boolean', 'Remote J.A.M. Next did not return a command result.');
    const remoteQueueResult = handleRemoteQueueCommand({ action: 'addnext', trackId: secondId }, { auth: { kind: 'guest', deviceId: 'fixture-remote' } });
    assert(remoteQueueResult === true && state.flowShuffle.priorityIds.includes(secondId), 'Remote J.A.M. addnext did not create manual priority.');

    const exported = signalJournalExportPayload();
    assert(exported?.raw?.flowShuffle?.lastPick?.decision?.version === 1, 'Signal Journal export omitted the decision receipt.');
    const originalConfirm = window.confirm;
    window.confirm = () => true;
    try {
      renderSignalImportPreview(signalImportPreviewPayload(exported));
      activeSignalImportMode = 'merge';
      applySignalImportPreview();
      assert(signalImportApplyAudit?.selectedMode === 'merge' && signalImportUndoSnapshot, 'Signal Journal merge did not create an undo snapshot.');
      undoSignalImportSnapshot();
      assert(signalImportApplyAudit?.undo?.undone === true, 'Signal Journal merge undo did not restore the snapshot.');
      renderSignalImportPreview(signalImportPreviewPayload(exported));
      activeSignalImportMode = 'replace';
      applySignalImportPreview();
      assert(signalImportApplyAudit?.selectedMode === 'replace' && signalImportUndoSnapshot, 'Signal Journal replace did not apply.');
      undoSignalImportSnapshot();
      assert(signalImportApplyAudit?.undo?.undone === true, 'Signal Journal replace undo did not restore the snapshot.');
    } finally {
      window.confirm = originalConfirm;
    }

    assert(typeof navigator.mediaSession?.setActionHandler === 'function', 'Media Session transport actions are unavailable at runtime.');
    const originalTheme = appearance.theme;
    const originalMotion = appearance.motion;
    // GPU runs launch maximized. Windows ignores renderer resizeTo() there;
    // use the existing bounded host action to unmaximize and set real bounds.
    const flowViewport = await bridge.action('resize-main-narrow');
    assert(flowViewport?.ok === true && flowViewport.windowState?.isMaximized === false, 'Flow viewport did not leave maximized state.');
    await waitFor(() => innerWidth === flowViewport.windowState.contentBounds.width, 1800, 'Flow narrow renderer viewport');
    const narrowWidth = innerWidth;
    assert(narrowWidth >= 1000 && narrowWidth <= 1200, `Narrow desktop resize did not apply (${narrowWidth}px).`);
    $('#queueDrawer').classList.remove('hidden');
    document.querySelector('[data-shuffle-style="flow"]')?.focus();
    assert(document.activeElement?.dataset?.shuffleStyle === 'flow', 'Flow control did not accept keyboard focus.');
    appearance.motion = 'off';
    applyMotionEffects();
    assert(motionDisabled(), 'Reduced-motion setting did not disable motion at runtime.');
    setPlaybackPerformance('conserve', 'integration-flow-runtime');
    assert(document.body.dataset.performance === 'conserve', 'Performance-conserve mode did not apply.');
    // Exercise the selectable product catalog. alternateThemes also retains
    // archived keys that the Studio rebuild deliberately refuses to activate.
    const selectableThemes = [...document.querySelectorAll('[data-theme-option]')].map((option) => option.dataset.themeOption);
    assert(selectableThemes.length > 0 && new Set(selectableThemes).size === selectableThemes.length, 'Selectable theme catalog must be nonempty and unique.');
    const visitedThemes = [];
    for (const theme of selectableThemes) {
      await selectTheme(theme);
      visitedThemes.push(appearance.theme);
    }
    assert(visitedThemes.length === selectableThemes.length && visitedThemes.every((theme, index) => theme === selectableThemes[index]), 'Not every selectable built-in theme completed a runtime theme transition.');
    await selectTheme(originalTheme);
    appearance.motion = originalMotion;
    applyMotionEffects();
    window.resizeTo(1440, 920);
    await new Promise((resolve) => setTimeout(resolve, 150));

    state.queue = [currentFixture()];
    state.repeat = 'off';
    const naturalTrack = currentFixture();
    audio.onended();
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert(currentFixture() === naturalTrack, 'Natural ending changed a one-track queue unexpectedly.');
    state.queue = [firstId, secondId];

    state.repeat = 'off';
    audio.pause();
    return {
      startupMs: Math.round(startupMs),
      emptyQueue: true,
      oneTrackQueue: true,
      mixedMetadata: true,
      flowStaging: true,
      failedPlaybackNonConsumption: true,
      successfulCommit: true,
      previousNext: true,
      repeatModes: true,
      queueMutation: true,
      manualPlayNext: true,
      remoteJamNextAndQueue: true,
      signalExportImportMergeReplaceUndo: true,
      naturalEnding: true,
      mediaSession: true,
      narrowKeyboardReducedMotionPerformance: true,
      builtInThemesRuntime: visitedThemes.length,
    };
  }

  async function scenarioPersistenceWrite(startupMs) {
    assert(state.tracks.length === 2, 'Persistence fixture library did not load.');
    state.favorites = ['fixture-tone-b'];
    state.tunings['fixture-tone-b'] = normalizeTuning({ bass: 2.5, presence: -1.5, treble: 1 });
    state.queue = ['fixture-tone-b', 'fixture-tone-a'];
    await playTrack('fixture-tone-b', { source: 'integration-test' });
    await waitFor(() => currentFixture() === 'fixture-tone-b' && !audio.paused, 5000, 'persistence fixture playback');
    await waitFor(() => Number.isFinite(audio.duration) && audio.duration > 1, 3000, 'persistence fixture metadata');
    audio.currentTime = 0.75;
    audio.pause();
    setPlayerVolume(0.37);
    durableSessionState = { id: 'fixture-tone-b', time: 0.75, volume: 0.37 };
    persist();
    const commit = await durableStateController.flush('integration-persistence-write');
    assert(commit?.ok === true, 'Durable persistence write did not commit.');
    return { startupMs: Math.round(startupMs), writeCommitted: true, revision: durableStateRuntime.revision, queueCount: 2, favoriteCount: 1 };
  }

  async function scenarioPersistenceRead(startupMs) {
    assert(state.tracks.length === 2, 'Restart lost the fixture library.');
    assert(state.playlists.some((playlist) => playlist.id === 'fixture-mix'), 'Restart lost the fixture playlist.');
    assert(state.favorites.length === 1 && state.favorites[0] === 'fixture-tone-b', 'Restart lost favorites.');
    assert(state.queue.join('|') === 'fixture-tone-b|fixture-tone-a', 'Restart lost queue ordering.');
    assert(Math.abs(Number(state.tunings['fixture-tone-b']?.bass) - 2.5) < 0.01, 'Restart lost track tuning.');
    assert(durableSessionState?.id === 'fixture-tone-b' && Math.abs(Number(durableSessionState.time) - 0.75) < 0.1, 'Restart lost session position.');
    assert(Math.abs(audio.volume - 0.37) < 0.01, 'Restart lost volume.');
    assert(currentFixture() === 'fixture-tone-b', 'Restart did not restore the selected session track.');
    return { startupMs: Math.round(startupMs), restartPersistence: true, revision: durableStateRuntime.revision, queueCount: 2, favoriteCount: 1 };
  }

  function findWorkspaceNode(node, id) {
    if (!node || typeof node !== 'object') return null;
    if (node.id === id) return node;
    for (const child of Array.isArray(node.children) ? node.children : []) {
      const found = findWorkspaceNode(child, id);
      if (found) return found;
    }
    return null;
  }

  async function scenarioWorkspacePersistenceWrite(startupMs) {
    assert(state.tracks.length === 2 && state.queue.length === 2, 'Workspace persistence fixture did not preserve playback access.');
    const loaded = await window.desktop.loadWorkspaceComposition();
    assert(loaded?.ok === true && loaded.state?.revision === 1, 'Workspace authority did not provide the creator revision.');
    const begun = await window.desktop.reportWorkspaceStartup('begin', { watchdogMs: 1000 });
    assert(begun?.ok === true && begun.state?.revision === 2 && begun.state.startup.status === 'pending', 'Main-process workspace watchdog did not arm.');
    let expiredState = null;
    await waitFor(async () => {
      const snapshot = await window.desktop.loadWorkspaceComposition();
      if (snapshot?.state?.startup?.status !== 'failed' || snapshot.state.startup.lastFailureCode !== 'WORKSPACE_WATCHDOG_EXPIRED') return false;
      expiredState = snapshot.state;
      return true;
    }, 3000, 'main-process workspace watchdog expiry');
    assert(expiredState?.revision === 3, 'Workspace watchdog expiry did not commit exactly one failure receipt.');
    const graph = JSON.parse(JSON.stringify(expiredState.graph));
    const grid = findWorkspaceNode(graph, 'workspace-grid');
    assert(Array.isArray(grid?.children), 'Workspace grid was not present in the normalized graph.');
    const queueIndex = grid.children.findIndex((node) => node.id === 'queue-module');
    const libraryIndex = grid.children.findIndex((node) => node.id === 'library-module');
    assert(queueIndex >= 0 && libraryIndex >= 0, 'Workspace persistence fixture modules were missing.');
    const [queueNode] = grid.children.splice(queueIndex, 1);
    grid.children.splice(libraryIndex, 0, queueNode);

    const cancelled = await window.desktop.cancelWorkspaceComposition({ expectedRevision: expiredState.revision });
    assert(cancelled?.ok === true && cancelled.wrote === false && cancelled.state.revision === 3, 'Workspace Cancel changed durable authority.');
    const commit = await window.desktop.saveWorkspaceComposition(graph, {
      expectedRevision: expiredState.revision,
      activeThemeId: expiredState.activeThemeId,
      reason: 'integration-workspace-persistence-write',
    });
    assert(commit?.ok === true && commit.state?.revision === 4, 'Workspace composition did not commit atomically.');
    const committedGrid = findWorkspaceNode(commit.state.graph, 'workspace-grid');
    assert(committedGrid.children[0]?.id === 'queue-module' && committedGrid.children[1]?.id === 'library-module', 'Committed workspace order was not normalized as expected.');
    return {
      startupMs: Math.round(startupMs),
      writeCommitted: true,
      workspaceRevision: commit.state.revision,
      graphSignature: commit.state.graphSignature,
      watchdogExpired: true,
      playbackAccess: true,
    };
  }

  async function scenarioWorkspacePersistenceRead(startupMs) {
    assert(state.tracks.length === 2 && state.queue.length === 2, 'Workspace restart lost playback or queue access.');
    const loaded = await window.desktop.loadWorkspaceComposition();
    assert(loaded?.ok === true && loaded.state?.revision === 4, 'Workspace revision did not survive a full relaunch.');
    assert(loaded.state.graphSignature && loaded.state.graphSignature !== loaded.state.creatorSignature, 'Workspace graph identity reverted to the creator default.');
    assert(loaded.state.lastKnownGoodSignature === loaded.state.creatorSignature, 'Workspace last-known-good identity changed across relaunch.');
    const grid = findWorkspaceNode(loaded.state.graph, 'workspace-grid');
    assert(grid?.children?.[0]?.id === 'queue-module' && grid.children[1]?.id === 'library-module', 'Exact workspace ordering did not survive relaunch.');
    return {
      startupMs: Math.round(startupMs),
      restartPersistence: true,
      workspaceRevision: loaded.state.revision,
      graphSignature: loaded.state.graphSignature,
      queueFirst: true,
      playbackAccess: true,
    };
  }

  async function scenarioWorkspaceProduction(startupMs) {
    assert(state.tracks.length === 2 && state.queue.length === 2, 'C8 fixture lost library or queue truth before activation.');
    await waitFor(() => document.body.dataset.runtimeMode === 'development', 5000, 'development runtime identity');
    assert(typeof selectTheme === 'function', 'The development-only C8 theme route is unavailable.');
    await selectTheme('dev-lab');
    await waitFor(() => document.body.dataset.theme === 'dev-lab', 10000, 'Dev Lab theme selection');
    try {
      await waitFor(() => document.body.classList.contains('cw-production-host-active'), 7000, 'C8 Dev Lab production host');
    } catch {
      throw new Error(`C8 Dev Lab production host stayed inactive: ${document.querySelector('#workspaceProductionStatus')?.textContent || 'no status'}`);
    }
    await waitFor(() => document.querySelectorAll('[data-cw-module]').length >= 7, 3000, 'first-party module adapters');
    assert(document.querySelector('[data-cw-module="library.browser"]'), 'Library was not admitted through its first-party adapter.');
    assert(document.querySelector('[data-cw-module="tracks.browser"]'), 'Track browser was not admitted through its first-party adapter.');
    assert(document.querySelector('[data-cw-module="queue.view"]'), 'Queue was not admitted through its first-party adapter.');
    assert(document.querySelector('[data-cw-module="transport.controls"]'), 'Transport was not admitted through its first-party adapter.');
    assert(document.querySelector('[data-cw-module="now-playing"]'), 'Now Playing was not admitted through its first-party adapter.');
    assert(document.querySelector('[data-cw-module="track.information"]'), 'Track information was not admitted through its first-party adapter.');
    assert(document.querySelector('[data-cw-module="audio.visualizer"]'), 'Deterministic visualizer was not mounted.');
    assert([...document.querySelectorAll('#workspaceProductionModule option')].some((option) => option.textContent.includes('Artwork stage') && option.disabled), 'Optional artwork adapter was not registered as available/unplaced.');

    const mode = document.querySelector('#workspaceProductionMode');
    const picker = document.querySelector('#workspaceProductionModule');
    const cancel = document.querySelector('#workspaceProductionCancel');
    const status = document.querySelector('#workspaceProductionStatus');
    assert(!document.querySelector('#workspaceProductionPrevious') && !document.querySelector('#workspaceProductionNext'), 'Ambiguous global earlier/later controls are still present.');
    assert(!document.querySelector('#workspaceProductionSave'), 'Finish and Save are still exposed as competing exit actions.');
    mode.click();
    assert(document.body.dataset.compositionMode === 'edit', 'Composition Mode did not enter.');
    const libraryRoot = document.querySelector('[data-cw-module="library.browser"]');
    const tracksRoot = document.querySelector('[data-cw-module="tracks.browser"]');
    const queueRoot = document.querySelector('[data-cw-module="queue.view"]');
    const libraryHandle = libraryRoot.querySelector('.cw-production-drag-handle');
    assert(libraryHandle && libraryRoot.dataset.cwMovable === 'true', 'Library did not expose its direct manipulation handle.');
    assert(queueRoot.dataset.cwMovable === 'false' && !queueRoot.querySelector('.cw-production-drag-handle'), 'Fixed Queue group falsely exposed a drag handle.');
    assert(queueRoot.querySelector('.cw-production-group-label')?.textContent.includes('fixed group'), 'Fixed Queue group was not explained in Composition Mode.');
    const targetRect = tracksRoot.getBoundingClientRect();
    const pointerId = 41;
    libraryHandle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientX: libraryHandle.getBoundingClientRect().left + 5, clientY: libraryHandle.getBoundingClientRect().top + 5 }));
    tracksRoot.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientX: targetRect.right - 12, clientY: targetRect.top + Math.min(80, targetRect.height / 2) }));
    tracksRoot.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 0, clientX: targetRect.right - 12, clientY: targetRect.top + Math.min(80, targetRect.height / 2) }));
    assert(document.querySelector('[data-cw-module="tracks.browser"]').style.getPropertyValue('--cw-module-order') === '0', `C8 graph movement did not reflow the Track browser (${status.textContent}; phase=${document.body.dataset.cwPointerPhase || 'unset'}).`);
    assert(document.querySelector('[data-cw-module="library.browser"]').style.getPropertyValue('--cw-module-order') === '1', 'C8 graph movement did not reflow Library.');
    assert(status.textContent.includes('placed after'), 'Pointer placement did not announce its committed relation.');
    assert(mode.textContent === 'Finish and save', 'Dirty Composition Mode did not expose one unambiguous finish action.');
    mode.click();
    await waitFor(() => document.body.dataset.compositionMode === 'use' && status.textContent.includes('saved atomically'), 4000, 'C8 Finish and save');
    assert(document.querySelector('[data-cw-module="library.browser"]').style.getPropertyValue('--cw-module-order') === '1', 'Finish did not retain the saved pointer placement.');

    mode.click();
    picker.value = 'library-module';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    libraryRoot.querySelector('.cw-production-edit-chrome button[title="Move left"]').click();
    assert(document.querySelector('[data-cw-module="library.browser"]').style.getPropertyValue('--cw-module-order') === '0', 'Keyboard-accessible movement did not stage a visible reflow.');
    cancel.click();
    await waitFor(() => document.body.dataset.compositionMode === 'use', 2500, 'C8 cancel and exit');
    assert(document.querySelector('[data-cw-module="library.browser"]').style.getPropertyValue('--cw-module-order') === '1', 'Cancel did not restore the authoritative Library order.');

    await playTrack('fixture-tone-a', { source: 'integration-test-c8' });
    await waitFor(() => currentFixture() === 'fixture-tone-a' && !audio.paused, 5000, 'C8 playback through composable host');
    await window.desktop.openMiniPlayer();
    await waitFor(async () => (await bridge.getStatus()).miniOpen, 3500, 'C8 mini-player window');
    await waitFor(async () => {
      const projected = (await bridge.getStatus()).playerState;
      return projected?.title === state.tracks.find((track) => track.id === 'fixture-tone-a')?.title
        && projected.paused === false;
    }, 3500, 'C8 host-owned mini projection');
    await waitFor(() => audio.paused, 3500, 'C8 mini-player transport command');
    await bridge.action('close-mini');
    await waitFor(async () => !(await bridge.getStatus()).miniOpen, 2500, 'C8 mini-player close');
    document.querySelector('#workspaceProductionLegacy').click();
    await waitFor(() => document.body.dataset.theme === 'studio' && !document.body.classList.contains('cw-production-host-active'), 10000, 'C8 legacy restoration');
    assert(!document.querySelector('[data-cw-module]'), 'First-party adapter markers leaked into the legacy workspace.');
    assert(document.querySelector('[data-cw-product-root="library.browser"]') && document.querySelector('[data-cw-product-root="tracks.browser"]'), 'Legacy product roots were not restored.');
    assert(state.tracks.length === 2 && state.queue.length === 2 && currentFixture() === 'fixture-tone-a', 'Legacy restoration lost playback, library, or queue truth.');
    return {
      startupMs: Math.round(startupMs),
      firstPartyModules: 7,
      optionalArtworkRegistered: true,
      pointerDrag: true,
      fixedGroupsTruthful: true,
      finishSavedAndExited: true,
      cancelRestored: true,
      atomicSave: true,
      playbackResponsive: true,
      miniPlayerHostOwned: true,
      legacyRestored: true,
    };
  }

  async function scenarioThemeImprints(startupMs) {
    assert(config.visualMode === true, 'Theme imprint capture requires visual mode.');
    await waitFor(() => document.body.dataset.runtimeMode === 'development', 5000, 'development runtime identity');
    const options = [...document.querySelectorAll('[data-theme-option]')];
    assert(options.length >= 1, 'No built-in theme options were available for imprint capture.');
    const captures = [];
    for (const option of options) {
      const runtimeKey = option.dataset.themeOption;
      if (document.body.dataset.theme !== runtimeKey) option.click();
      await waitFor(() => document.body.dataset.theme === runtimeKey, 10000, `${runtimeKey} theme selection`);
      await waitFor(() => document.querySelector('#themeLoadScreen')?.classList.contains('hidden') && document.body.dataset.readiness === 'settled', 10000, `${runtimeKey} settled painted state`);
      await new Promise((resolve) => setTimeout(resolve, 220));
      const capture = await bridge.action(`capture-theme-imprint-${runtimeKey}`);
      assert(capture?.ok === true, `Theme imprint capture failed for ${runtimeKey}.`);
      const rect = (selector) => {
        const element = document.querySelector(selector);
        const box = element?.getBoundingClientRect();
        return element && box ? { display: getComputedStyle(element).display, x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) } : null;
      };
      captures.push({
        runtimeKey,
        artifact: capture.artifact,
        width: capture.width,
        height: capture.height,
        bodyClasses: [...document.body.classList],
        loadScreenClasses: [...document.querySelector('#themeLoadScreen')?.classList || []],
        regions: { workspace: rect('.workspace'), library: rect('.library-rail'), main: rect('.main-stage'), hero: rect('.playlist-hero'), inspector: rect('.inspector'), player: rect('.player') },
      });
    }
    return { startupMs: Math.round(startupMs), captured: captures.length, captures };
  }

  async function scenarioWorkspaceThemeExperiment(startupMs) {
    await waitFor(() => document.body.dataset.runtimeMode === 'development', 5000, 'development runtime identity');
    assert(typeof selectTheme === 'function', 'The development-only Counterspace theme route is unavailable.');
    await selectTheme('dev-lab');
    await waitFor(() => document.body.dataset.theme === 'dev-lab', 10000, 'Counterspace Relay theme selection');
    await waitFor(() => document.body.dataset.cwCompositionProfile === 'counterspace-relay-r1' && document.body.classList.contains('cw-production-host-active'), 7000, 'Counterspace Relay production host');
    const loaded = await window.desktop.loadWorkspaceComposition();
    assert(loaded?.ok && loaded.state?.graph?.id === 'counterspace-relay-r1-root', 'Experiment did not load its isolated authoritative graph.');
    const canvasModules = (graph) => findWorkspaceNode(graph, 'counterspace-relay-r1-canvas').children.filter((node) => node.type === 'module').map((node) => node.id);
    const creatorOrder = canvasModules(loaded.state.creatorDefaultGraph);
    const currentOrder = canvasModules(loaded.state.graph);
    const slot = (key) => document.querySelector(`[data-cw-module="${key}"]`)?.dataset.cwTopologySlot;
    const mode = document.querySelector('#workspaceProductionMode');
    const cancel = document.querySelector('#workspaceProductionCancel');
    const restore = document.querySelector('#workspaceProductionRestore');

    if (loaded.state.graphSignature === loaded.state.creatorSignature) {
      assert(JSON.stringify(creatorOrder) === JSON.stringify(['tracks-module', 'library-module', 'information-module']), 'First activation did not use the version-one creator default.');
      assert(slot('tracks.browser') === '0' && slot('library.browser') === '1' && slot('track.information') === '2', 'Creator topology did not paint a dominant Track stage plus stacked cabinets.');
      if (config.visualMode) {
        const capture = await bridge.action('capture-workspace-theme-experiment');
        assert(capture?.ok === true && capture.isMaximized === true, 'Maximized Counterspace Relay capture failed.');
        mode.click();
        const library = document.querySelector('[data-cw-module="library.browser"]');
        library.querySelector('.cw-production-edit-chrome button[title="Move left"]').click();
        assert(slot('library.browser') === '0', 'Painted remix did not make Library dominant.');
        const remixCapture = await bridge.action('capture-workspace-theme-experiment-remix');
        assert(remixCapture?.ok === true && remixCapture.isMaximized === true, 'Maximized Counterspace Relay remix capture failed.');
        cancel.click();
        await waitFor(() => document.body.dataset.compositionMode === 'use', 2500, 'painted remix rollback');
        assert(slot('tracks.browser') === '0', 'Painted remix rollback did not restore creator topology.');
        return { startupMs: Math.round(startupMs), phase: 'paint-capture', creatorDefault: true, maximized: true, artifact: capture.artifact, remixArtifact: remixCapture.artifact, remixDraftRolledBack: true, topology: 'dominant-stage-plus-stacked-cabinets' };
      }
      mode.click();
      const information = document.querySelector('[data-cw-module="track.information"]');
      information.querySelector('.cw-production-edit-chrome button[title="Move left"]').click();
      information.querySelector('.cw-production-edit-chrome button[title="Move left"]').click();
      assert(slot('track.information') === '0', 'Identity-stressing legal draft did not make Track Information dominant.');
      cancel.click();
      await waitFor(() => document.body.dataset.compositionMode === 'use', 2500, 'experiment cancel');
      assert(slot('tracks.browser') === '0' && slot('library.browser') === '1' && slot('track.information') === '2', 'Cancel did not exactly restore the creator topology.');
      mode.click();
      const library = document.querySelector('[data-cw-module="library.browser"]');
      library.querySelector('.cw-production-edit-chrome button[title="Move left"]').click();
      assert(slot('library.browser') === '0', 'Personal remix did not make Library dominant.');
      mode.click();
      await waitFor(() => document.body.dataset.compositionMode === 'use' && document.querySelector('#workspaceProductionStatus').textContent.includes('saved atomically'), 4000, 'experiment remix save');
      return { startupMs: Math.round(startupMs), phase: 'creator-to-remix', creatorDefault: true, cancelExact: true, personalRemixSaved: true, topology: 'dominant-stage-plus-stacked-cabinets' };
    }

    assert(JSON.stringify(currentOrder) === JSON.stringify(['library-module', 'tracks-module', 'information-module']), 'Saved personal remix did not survive relaunch.');
    assert(slot('library.browser') === '0', 'Saved personal remix did not repaint Library in the dominant slot.');
    if (JSON.stringify(creatorOrder) === JSON.stringify(['tracks-module', 'library-module', 'information-module'])) {
      document.querySelector('#workspaceProductionLegacy').click();
      await waitFor(() => document.body.dataset.theme === 'studio' && !document.body.classList.contains('cw-production-host-active'), 10000, 'experiment Studio switch');
      assert(!document.querySelector('[data-cw-module]'), 'Personal remix leaked into Studio.');
      await selectTheme('dev-lab');
      await waitFor(() => document.body.dataset.cwCompositionProfile === 'counterspace-relay-r1' && document.body.classList.contains('cw-production-host-active'), 7000, 'experiment return');
      assert(slot('library.browser') === '0', 'Personal remix was lost after switching away and back.');
      return { startupMs: Math.round(startupMs), phase: 'remix-relaunch-one', personalRemixSurvived: true, themeSwitchIsolated: true };
    }

    assert(JSON.stringify(creatorOrder) === JSON.stringify(['tracks-module', 'information-module', 'library-module']), 'Version-two creator default was not updated separately.');
    mode.click();
    restore.click();
    assert(slot('tracks.browser') === '0' && slot('track.information') === '1' && slot('library.browser') === '2', 'Restore creator did not stage the updated creator default.');
    mode.click();
    await waitFor(() => document.body.dataset.compositionMode === 'use', 4000, 'updated creator save');
    document.querySelector('#workspaceProductionLegacy').click();
    await waitFor(() => document.body.dataset.theme === 'studio' && !document.body.classList.contains('cw-production-host-active'), 10000, 'final legacy return');
    assert(state.tracks.length === 2 && state.queue.length === 2, 'Legacy return lost library or queue truth.');
    return { startupMs: Math.round(startupMs), phase: 'remix-relaunch-two-and-reset', secondRelaunch: true, defaultUpdatePreservedOverrideBeforeReset: true, updatedCreatorRestored: true, legacyTruthRetained: true, optionalRemoval: 'blocked-no-shelf' };
  }

  async function scenarioWorkspaceCanvasStudio(startupMs) {
    const cartridgeQuestArtifacts = { wide: '', playing: '', narrow: '', mini: '', miniPlaying: '' };
    await waitFor(() => document.body.dataset.runtimeMode === 'development', 5000, 'development runtime identity');
    await waitFor(() => document.body.dataset.theme === 'foreground' && document.body.classList.contains('cw-production-host-active'), 10000, 'Canvas Studio production host');
    assert(document.body.dataset.startupRevealTheme === 'foreground', 'Canvas Studio exposed Studio before the persisted Foreground canvas was ready.');
    await waitFor(() => document.body.dataset.compositionMode === 'edit' && !document.querySelector('.cw-studio-rail')?.hidden, 5000, 'Canvas Studio authoring rail');

    const entry = document.querySelector('#canvasStudioEntry');
    assert(entry?.closest('.theme-setting'), 'Canvas Studio entry is not in the visible Studio theme settings group.');
    assert(!entry.closest('.dev-lab-mechanics'), 'Canvas Studio entry is still trapped in the hidden Dev Lab group.');
    const portSelect = document.querySelector('#canvasThemePortSelect');
    assert(portSelect?.options.length === 28, 'Canvas did not expose Canvas Base plus the 27 baseline theme ports.');
    assert(document.querySelectorAll('[data-cw-instance-id]').length === 1, 'The opening canvas did not mount exactly one adapter.');
    assert(document.querySelector('[data-cw-module="tracks.browser"]'), 'The opening Track browser adapter is missing.');

    const buttonWithText = (selector, label) => [...document.querySelectorAll(selector)].find((node) => node.textContent.trim() === label);
    buttonWithText('.cw-studio-commit .cw-studio-button', 'Discard draft').click();
    await waitFor(() => document.body.dataset.compositionMode === 'use' && !document.querySelector('.cw-studio-launcher')?.hidden && document.activeElement === document.querySelector('.cw-studio-launcher'), 3000, 'Canvas Studio use mode launcher and focus return');
    assert(document.querySelector('.cw-studio-rail')?.hidden, 'Canvas Studio rail remained exposed in Use Mode.');
    assert(!document.querySelector('.cw-pane-drag-handle'), 'Canvas move handles leaked into Use Mode.');
    document.querySelector('.cw-studio-launcher').click();
    await waitFor(() => document.body.dataset.compositionMode === 'edit' && !document.querySelector('.cw-studio-rail')?.hidden && document.querySelector('.cw-studio-launcher')?.hidden, 2500, 'Canvas Studio re-entry');
    assert(document.querySelector('.cw-pane-drag-handle'), 'Canvas move handles were not restored on re-entry.');
    assert(!document.querySelector('.cw-production-edit-chrome'), 'Legacy C8 edit chrome conflicts with Canvas Studio.');
    assert(document.querySelectorAll('.cw-studio-template').length === 4, 'Canvas Studio layout templates are unavailable.');
    assert(document.activeElement === document.querySelector('.cw-studio-rail'), 'Composition Mode entry did not move focus to Canvas Studio.');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await waitFor(() => document.body.dataset.compositionMode === 'use' && document.activeElement === document.querySelector('.cw-studio-launcher'), 3000, 'clean Escape exit');
    document.querySelector('.cw-studio-launcher').click();
    await waitFor(() => document.body.dataset.compositionMode === 'edit' && !document.querySelector('.cw-studio-rail')?.hidden, 2500, 'Canvas Studio re-entry after Escape');

    const tracksPane = document.querySelector('.cw-module[data-cw-module-key="tracks.browser"]');
    tracksPane.focus();
    tracksPane.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert(tracksPane.hasAttribute('data-cw-studio-selected'), 'Keyboard pane selection did not select the Track browser.');

    const addPaneLauncher = document.querySelector('.cw-canvas-add-button');
    assert(addPaneLauncher && !addPaneLauncher.hidden, 'Composition Mode did not expose an on-canvas Add Pane route.');
    addPaneLauncher.click();
    await waitFor(() => document.querySelector('.cw-add-pane-menu[role="menu"]'), 1000, 'on-canvas Add Pane menu');
    assert(buttonWithText('.cw-add-pane-option strong', 'Library')?.closest('button'), 'The on-canvas Add Pane menu did not mirror the available module tray.');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert(!document.querySelector('.cw-add-pane-menu') && document.activeElement === addPaneLauncher, 'Escape did not close Add Pane and restore focus to its launcher.');
    const blankCanvas = document.querySelector('.cw-canvas');
    blankCanvas.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 420, clientY: 160 }));
    assert(document.querySelector('.cw-add-pane-menu[aria-label="Add pane to canvas"]'), 'Blank-canvas right-click did not open the available pane menu.');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

    const dispatchPointer = (target, type, x, y, pointerId) => target.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
      clientX: x,
      clientY: y,
    }));
    const dragPane = (source, target, xRatio, yRatio, pointerId) => {
      const handle = source.querySelector(':scope > .cw-pane-drag-handle');
      assert(handle, `Direct move handle is missing for ${source.dataset.cwModuleKey}.`);
      const sourceRect = handle.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      dispatchPointer(handle, 'pointerdown', sourceRect.left + sourceRect.width / 2, sourceRect.top + sourceRect.height / 2, pointerId);
      dispatchPointer(target, 'pointermove', targetRect.left + targetRect.width * xRatio, targetRect.top + targetRect.height * yRatio, pointerId);
      dispatchPointer(target, 'pointerup', targetRect.left + targetRect.width * xRatio, targetRect.top + targetRect.height * yRatio, pointerId);
    };
    // Relationships other than a free cell or an edge attach (reorder, stack,
    // leaving a group) are committed from the selected pane's "Arrange with
    // pane" controls, the route the pane menu's Move relative to opens.
    const arrangeWith = (sourceKey, targetKey, label) => {
      const source = document.querySelector(`.cw-module[data-cw-module-key="${sourceKey}"]`);
      const target = document.querySelector(`.cw-module[data-cw-module-key="${targetKey}"]`);
      assert(source && target, `Arrange route is missing ${source ? targetKey : sourceKey}.`);
      source.focus();
      source.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      const select = document.querySelector('.cw-studio-target-field select');
      assert(select && [...select.options].some((option) => option.value === target.dataset.cwNodeId), `The selected ${sourceKey} pane cannot be arranged with ${targetKey}.`);
      select.value = target.dataset.cwNodeId;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      const action = [...document.querySelectorAll('.cw-studio-target-actions .cw-studio-button')].find((control) => control.textContent.trim() === label);
      assert(action, `The arrange route did not offer "${label}".`);
      action.click();
    };

    const traySearch = document.querySelector('.cw-studio-tray-search');
    assert(traySearch, 'Canvas Studio did not expose the searchable module tray.');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }));
    assert(document.activeElement === traySearch, 'The slash shortcut did not focus the module tray search.');
    traySearch.value = 'Library';
    traySearch.dispatchEvent(new Event('input', { bubbles: true }));
    assert([...document.querySelectorAll('.cw-studio-tray-item')].filter((item) => !item.hidden).length === 1, 'Tray search did not narrow the available modules.');
    traySearch.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await waitFor(() => document.querySelector('.cw-studio-tray-search')?.value === '' && document.activeElement === document.querySelector('.cw-studio-tray-search'), 2500, 'cleared tray search focus');
    document.querySelector('.cw-studio-tray-search').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert(document.activeElement === document.querySelector('.cw-studio-rail'), 'Escape on an empty tray search did not return focus to Canvas Studio.');

    const libraryTrayItem = buttonWithText('.cw-studio-tray-item strong', 'Library')?.closest('button');
    assert(libraryTrayItem, 'Library was not available in the Canvas Studio tray.');
    libraryTrayItem.click();
    await waitFor(() => document.querySelector('.cw-module[data-cw-module-key="library.browser"]'), 2500, 'inserted Library adapter lifecycle');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert(document.body.dataset.compositionMode === 'edit' && document.querySelector('.cw-studio-selection')?.textContent.includes('Click a pane'), 'The first Escape did not clear the active pane selection safely.');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert(document.body.dataset.compositionMode === 'edit' && document.querySelector('#workspaceProductionStatus').textContent.includes('unsaved changes'), 'The second Escape discarded or exited a dirty composition draft instead of protecting it.');

    let keyboardMenuPane = document.querySelector('.cw-module[data-cw-module-key="library.browser"]');
    keyboardMenuPane.focus();
    keyboardMenuPane.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }));
    assert(document.querySelector('.cw-module-context-menu[role="menu"]')?.getAttribute('aria-label')?.includes('Library'), 'Shift+F10 did not open the selected pane menu.');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert(!document.querySelector('.cw-module-context-menu') && document.activeElement === keyboardMenuPane, 'Escape did not close the pane menu and return focus.');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
    await waitFor(() => !document.querySelector('.cw-module[data-cw-module-key="library.browser"]'), 2500, 'Canvas Studio shortcut undo');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    await waitFor(() => document.querySelector('.cw-module[data-cw-module-key="library.browser"]'), 2500, 'Canvas Studio shortcut redo');
    let libraryPane = document.querySelector('.cw-module[data-cw-module-key="library.browser"]');
    let currentTracksPane = document.querySelector('.cw-module[data-cw-module-key="tracks.browser"]');
    const paneMenuButton = libraryPane.querySelector(':scope > .cw-pane-menu-button');
    assert(paneMenuButton?.getAttribute('aria-haspopup') === 'menu', 'The pane-local full action menu is missing.');
    paneMenuButton.click();
    assert(document.querySelector('.cw-module-context-menu[aria-label*="Library"]') && buttonWithText('.cw-module-context-action', 'Move relative to…'), 'The visible pane menu did not open the same canonical actions as right-click.');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert(document.activeElement === libraryPane.querySelector(':scope > .cw-pane-menu-button'), 'Closing the pane-local menu did not restore focus to its visible trigger.');
    const canvasMotionBeforeDrag = appearance.motion;
    appearance.motion = 'expressive';
    applyAppearance();
    assert(document.body.dataset.motion !== 'off', 'Canvas Studio pointer animation test could not enable normal motion.');
    // Drop truth: a
    // drop is whatever the pointer is on now. The interior of another pane is
    // a free grid cell the packer makes room for, its attach band (12% of the
    // pane, at most 16px) is an attach, and anything else changes nothing.
    const liveHandle = libraryPane.querySelector(':scope > .cw-pane-drag-handle');
    const liveSourceRect = liveHandle.getBoundingClientRect();
    const liveTargetRect = currentTracksPane.getBoundingClientRect();
    const liveGrid = libraryPane.parentElement;
    const originalGridFirst = liveGrid.querySelector(':scope > .cw-node')?.dataset.cwNodeId;
    const canvasModuleCount = document.querySelectorAll('.cw-module[data-cw-node-id]').length;
    const grabStartedAt = performance.now();
    dispatchPointer(liveHandle, 'pointerdown', liveSourceRect.left + liveSourceRect.width / 2, liveSourceRect.top + liveSourceRect.height / 2, 40);
    const grabHandlerMs = performance.now() - grabStartedAt;
    assert(grabHandlerMs <= 120, `Grab blocked the renderer for ${Math.round(grabHandlerMs)} ms before the lightweight proxy appeared.`);
    assert(document.querySelector('.cw-drag-proxy')?.dataset.cwDragLabel === 'Library' && getComputedStyle(libraryPane).display === 'none', 'Grab did not immediately replace the live product subtree with a lightweight moving proxy.');
    const immediateProxy = document.querySelector('.cw-drag-proxy');
    const pressedTransform = immediateProxy.style.transform;
    dispatchPointer(liveHandle, 'pointermove', liveSourceRect.left + liveSourceRect.width / 2 + 1, liveSourceRect.top + liveSourceRect.height / 2, 40);
    assert(immediateProxy.style.transform !== pressedTransform && document.body.dataset.cwStudioPointer === 'dragging-pane', 'The first pointer movement waited for the placement threshold or animation-frame scheduler before moving the proxy.');
    const dragUpdateStartedAt = performance.now();
    dispatchPointer(currentTracksPane, 'pointermove', liveTargetRect.left + liveTargetRect.width * 0.25, liveTargetRect.top + liveTargetRect.height * 0.25, 40);
    const dragUpdateMs = performance.now() - dragUpdateStartedAt;
    assert(dragUpdateMs <= 120, `Dense-canvas drag update blocked the renderer for ${Math.round(dragUpdateMs)} ms.`);
    assert(document.querySelectorAll('.cw-node').length === 0 || ![...document.querySelectorAll('.cw-node')].some((node) => node.getAnimations?.().some((animation) => animation.id === 'cw-live-reflow')), 'Pointer-driven reflow retained a trailing FLIP animation instead of tracking the gesture directly.');
    assert(canvasModuleCount <= 4 || document.body.dataset.cwStudioDense === 'true', 'A canvas with more than four modules did not enter the low-overhead live reflow path.');
    assert(document.body.dataset.cwStudioLivePreview === 'grid-cell', 'Dragging over the interior of another pane did not expose a live free-placement cell.');
    const liveProxy = immediateProxy;
    assert(liveProxy?.dataset.cwStudioLifted === 'true' && getComputedStyle(liveProxy).position === 'fixed', 'Dragging did not lift a pointer-following proxy surface.');
    const chosenSlot = document.querySelector('.cw-drag-placeholder');
    assert(chosenSlot?.dataset.cwNodeId === libraryPane.dataset.cwNodeId && chosenSlot.dataset.cwPositioned === 'true', 'Dragging did not reserve a positioned live destination cell for the lifted module.');
    assert(/Release to place it here/.test(document.querySelector('#workspaceProductionStatus')?.textContent || ''), 'The live cell did not say what releasing will do.');
    const chosenSlotRect = chosenSlot.getBoundingClientRect();
    dispatchPointer(chosenSlot, 'pointermove', chosenSlotRect.left + chosenSlotRect.width / 2, chosenSlotRect.top + chosenSlotRect.height / 2, 40);
    assert(document.body.dataset.cwStudioLivePreview === 'grid-cell' && document.querySelector('.cw-drag-placeholder') === chosenSlot, 'Hovering the chosen cell discarded the live placement.');
    const firstLiftedTransform = liveProxy.style.transform;
    const movedTargetRect = currentTracksPane.getBoundingClientRect();
    dispatchPointer(currentTracksPane, 'pointermove', movedTargetRect.left + movedTargetRect.width * 0.35, movedTargetRect.top + movedTargetRect.height * 0.35, 40);
    assert(liveProxy.style.transform !== firstLiftedTransform, 'The lifted proxy did not continue following the pointer after the destination slot reflowed.');
    dispatchPointer(liveHandle, 'pointercancel', movedTargetRect.left + movedTargetRect.width * 0.35, movedTargetRect.top + movedTargetRect.height * 0.35, 40);
    assert(liveGrid.querySelector(':scope > .cw-node')?.dataset.cwNodeId === originalGridFirst, 'Cancelling live reflow did not restore the authoritative order.');
    assert(!document.body.dataset.cwStudioLivePreview, 'Live reflow state leaked after pointer cancellation.');
    assert(!document.querySelector('.cw-drag-placeholder, .cw-drag-proxy') && getComputedStyle(libraryPane).display !== 'none', 'Cancelling a drag left a proxy, placeholder, or hidden live pane behind.');
    appearance.motion = canvasMotionBeforeDrag;
    applyAppearance();
    dragPane(libraryPane, currentTracksPane, 0.25, 0.25, 401);
    await waitFor(() => document.querySelector('.cw-module[data-cw-module-key="library.browser"]')?.style.getPropertyValue('--cw-column-start'), 2500, 'persisted free placement');
    assert(!document.querySelector('.cw-drag-placeholder'), 'A committed free placement left its provisional slot behind.');
    arrangeWith('library.browser', 'tracks.browser', 'Before');
    await waitFor(() => document.querySelector('.cw-grid > .cw-module')?.dataset.cwModuleKey === 'library.browser', 2500, 'persisted reorder');
    arrangeWith('library.browser', 'tracks.browser', 'After');
    await waitFor(() => document.querySelector('.cw-grid > .cw-module')?.dataset.cwModuleKey === 'tracks.browser', 2500, 'persisted reverse reorder');
    libraryPane = document.querySelector('.cw-module[data-cw-module-key="library.browser"]');
    currentTracksPane = document.querySelector('.cw-module[data-cw-module-key="tracks.browser"]');
    const splitTargetWidth = currentTracksPane.getBoundingClientRect().width;
    dragPane(libraryPane, currentTracksPane, (splitTargetWidth - 4) / splitTargetWidth, 0.5, 41);
    await waitFor(() => document.querySelector('.cw-split'), 2500, 'direct pane split');
    assert(document.querySelector('.cw-module[data-cw-module-key="library.browser"]'), 'Direct split removed Library instead of grouping it.');

    const splitCanvas = document.querySelector('.cw-canvas');
    const split = document.querySelector('.cw-split');
    const separator = split.querySelector(':scope > .cw-split-handle');
    assert(separator?.getAttribute('role') === 'separator', 'Split resize handle is not exposed as a semantic separator.');
    assert(separator.getAttribute('aria-orientation') === 'vertical', 'Horizontal split did not expose a vertical separator.');
    const separatorStyle = getComputedStyle(separator);
    assert(parseFloat(separatorStyle.width) >= 42 && parseFloat(separatorStyle.height) >= 42, 'Split separator hit target is smaller than 42px.');
    const splitRect = split.getBoundingClientRect();
    const oldTemplate = split.style.getPropertyValue('--cw-split-template');
    dispatchPointer(separator, 'pointerdown', splitRect.left + splitRect.width / 2, splitRect.top + splitRect.height / 2, 42);
    dispatchPointer(separator, 'pointermove', splitRect.left + splitRect.width / 2 + 70, splitRect.top + splitRect.height / 2, 42);
    dispatchPointer(separator, 'pointerup', splitRect.left + splitRect.width / 2 + 70, splitRect.top + splitRect.height / 2, 42);
    await waitFor(() => document.querySelector('.cw-canvas')?.dataset.cwPaintMode === 'incremental', 2500, 'incremental split resize paint');
    assert(document.querySelector('.cw-canvas') === splitCanvas, 'Split resize replaced the canvas instead of updating it incrementally.');
    assert(split.style.getPropertyValue('--cw-split-template') !== oldTemplate, 'Pointer split resize did not change the split ratio.');

    libraryPane = document.querySelector('.cw-module[data-cw-module-key="library.browser"]');
    currentTracksPane = document.querySelector('.cw-module[data-cw-module-key="tracks.browser"]');
    const groupedHandle = libraryPane.querySelector(':scope > .cw-pane-drag-handle');
    const groupedHandleRect = groupedHandle.getBoundingClientRect();
    const groupedTargetRect = currentTracksPane.getBoundingClientRect();
    dispatchPointer(groupedHandle, 'pointerdown', groupedHandleRect.left + groupedHandleRect.width / 2, groupedHandleRect.top + groupedHandleRect.height / 2, 43);
    dispatchPointer(currentTracksPane, 'pointermove', groupedTargetRect.left + groupedTargetRect.width * 0.5, groupedTargetRect.top + groupedTargetRect.height * 0.5, 43);
    assert(/inside a group/.test(document.querySelector('#workspaceProductionStatus')?.textContent || '') && !document.body.dataset.cwStudioLivePreview, 'A grouped pane offered free placement instead of saying why it cannot be placed.');
    dispatchPointer(currentTracksPane, 'pointerup', groupedTargetRect.left + groupedTargetRect.width * 0.5, groupedTargetRect.top + groupedTargetRect.height * 0.5, 43);
    assert(document.querySelector('.cw-split'), 'Releasing a refused grouped drop changed the canvas.');
    arrangeWith('library.browser', 'tracks.browser', 'Before');
    await waitFor(() => !document.querySelector('.cw-split'), 2500, 'split recombination');
    assert(document.querySelector('.cw-module[data-cw-module-key="library.browser"]'), 'Recombination returned Library to the tray instead of preserving it.');

    libraryPane = document.querySelector('.cw-module[data-cw-module-key="library.browser"]');
    const openGrid = libraryPane.parentElement;
    const initialFullPaintCount = Number(document.querySelector('.cw-canvas')?.dataset.cwFullPaintCount || 0);
    const openGridRect = openGrid.getBoundingClientRect();
    const openHandle = libraryPane.querySelector(':scope > .cw-pane-drag-handle');
    const openHandleRect = openHandle.getBoundingClientRect();
    const openX = openGridRect.left + openGridRect.width * 0.7;
    const openY = Math.min(window.innerHeight - 24, openGridRect.bottom - 24);
    dispatchPointer(openHandle, 'pointerdown', openHandleRect.left + openHandleRect.width / 2, openHandleRect.top + openHandleRect.height / 2, 431);
    dispatchPointer(openGrid, 'pointermove', openX, openY, 431);
    const openPlaceholder = document.querySelector('.cw-drag-placeholder');
    assert(document.body.dataset.cwStudioLivePreview === 'grid-cell' && openPlaceholder?.dataset.cwPositioned === 'true', 'Blank canvas space did not become a live addressable grid-cell destination.');
    const requestedColumn = openPlaceholder.style.getPropertyValue('--cw-column-start');
    const requestedRow = openPlaceholder.style.getPropertyValue('--cw-row-start');
    const placementCommitStartedAt = performance.now();
    dispatchPointer(openGrid, 'pointerup', openX, openY, 431);
    const placementCommitHandlerMs = performance.now() - placementCommitStartedAt;
    assert(placementCommitHandlerMs <= 120, `Grid placement blocked pointer release for ${Math.round(placementCommitHandlerMs)} ms.`);
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert(document.querySelector('.cw-module[data-cw-module-key="library.browser"]')?.dataset.cwPositioned === 'true', `Open-grid placement did not persist: ${document.querySelector('#workspaceProductionStatus')?.textContent || 'no status'}`);
    libraryPane = document.querySelector('.cw-module[data-cw-module-key="library.browser"]');
    assert(libraryPane.style.getPropertyValue('--cw-column-start') === requestedColumn && libraryPane.style.getPropertyValue('--cw-row-start') === requestedRow, 'Open-grid drop did not persist at the previewed cell.');
    assert(Number(document.querySelector('.cw-canvas')?.dataset.cwFullPaintCount || 0) === initialFullPaintCount, 'A grid-only placement rebuilt the full canvas instead of updating existing product roots incrementally.');
    const packedCells = [...openGrid.children].filter((node) => node.matches('.cw-node[data-cw-positioned="true"]:not(.cw-overlay)')).map((node) => ({
      id: node.dataset.cwNodeId,
      columnStart: Number(node.style.getPropertyValue('--cw-column-start')),
      rowStart: Number(node.style.getPropertyValue('--cw-row-start')),
      columnSpan: Number(node.style.getPropertyValue('--cw-column-span')),
      rowSpan: Number(node.style.getPropertyValue('--cw-row-span')),
    }));
    packedCells.forEach((left, index) => packedCells.slice(index + 1).forEach((right) => {
      const separated = left.columnStart + left.columnSpan <= right.columnStart
        || right.columnStart + right.columnSpan <= left.columnStart
        || left.rowStart + left.rowSpan <= right.rowStart
        || right.rowStart + right.rowSpan <= left.rowStart;
      assert(separated, `Grid packing overlapped ${left.id} and ${right.id}.`);
    }));

    libraryPane = document.querySelector('.cw-module[data-cw-module-key="library.browser"]');
    const resizeHandle = libraryPane.querySelector(':scope > .cw-pane-resize-handle');
    assert(resizeHandle, 'Direct pane resize handle is missing on a grid child.');
    const resizeStyle = getComputedStyle(resizeHandle);
    assert(parseFloat(resizeStyle.width) >= 42 && parseFloat(resizeStyle.height) >= 42, 'Pane resize hit target is smaller than 42px.');
    const resizeCanvas = document.querySelector('.cw-canvas');
    const resizeRect = resizeHandle.getBoundingClientRect();
    const beforeBlockSize = libraryPane.getBoundingClientRect().height;
    dispatchPointer(resizeHandle, 'pointerdown', resizeRect.left + resizeRect.width / 2, resizeRect.top + resizeRect.height / 2, 44);
    const resizingProductRoot = libraryPane.querySelector(':scope > [data-cw-product-root]');
    assert(document.body.dataset.cwStudioPointer === 'resizing-pane' && resizingProductRoot.dataset.cwResizeVisual === 'true' && getComputedStyle(resizingProductRoot).contentVisibility !== 'hidden', 'Pane resize did not keep a visible, layout-frozen product preview.');
    const resizeUpdateStartedAt = performance.now();
    dispatchPointer(resizeHandle, 'pointermove', resizeRect.left + resizeRect.width / 2 + 90, resizeRect.top + resizeRect.height / 2 + 150, 44);
    const resizeUpdateMs = performance.now() - resizeUpdateStartedAt;
    assert(resizeUpdateMs <= 120, `Pane resize update blocked the renderer for ${Math.round(resizeUpdateMs)} ms.`);
    // The live box follows the pointer (data-cw-resize-live); the block-only
    // preview remains the fallback when no live origin could be measured.
    assert((libraryPane.dataset.cwResizeLive === 'true' || libraryPane.dataset.cwResizePreview === 'true') && parseFloat(libraryPane.style.getPropertyValue('--cw-preview-block-size')) > beforeBlockSize, 'Vertical pane resizing did not paint a continuous block-size preview.');
    assert(parseFloat(resizingProductRoot.style.getPropertyValue('--cw-resize-scale-y')) > 1, 'The visible product preview did not scale continuously with the pane.');
    const resizeCommitStartedAt = performance.now();
    dispatchPointer(resizeHandle, 'pointerup', resizeRect.left + resizeRect.width / 2 + 90, resizeRect.top + resizeRect.height / 2 + 150, 44);
    const resizeCommitMs = performance.now() - resizeCommitStartedAt;
    assert(resizeCommitMs <= 120, `Pane resize release blocked the renderer for ${Math.round(resizeCommitMs)} ms.`);
    await waitFor(() => document.querySelector('.cw-module[data-cw-module-key="library.browser"]')?.dataset.cwPlaced === 'true', 2500, 'direct pane placement');
    assert(document.querySelector('.cw-canvas') === resizeCanvas, 'Pane resize replaced the canvas instead of updating it incrementally.');
    libraryPane = document.querySelector('.cw-module[data-cw-module-key="library.browser"]');
    const beforeKeyboardColumn = libraryPane.style.getPropertyValue('--cw-column-span');
    libraryPane.querySelector(':scope > .cw-pane-resize-handle').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    assert(libraryPane.style.getPropertyValue('--cw-column-span') !== beforeKeyboardColumn, 'Keyboard pane resize did not change the column span.');
    const beforeClickColumn = libraryPane.style.getPropertyValue('--cw-column-span');
    // Layout-only commits refresh the rail when the renderer is idle
    // (scheduleDeferredPresentation), so wait for the size controls to catch up.
    await waitFor(() => {
      const control = buttonWithText('.cw-studio-size-row .cw-studio-button', 'Wider');
      return control && !control.disabled;
    }, 1500, 'size controls after keyboard resize');
    const widerButton = buttonWithText('.cw-studio-size-row .cw-studio-button', 'Wider');
    assert(widerButton && !widerButton.disabled, 'Single-pointer pane resize alternative is unavailable.');
    widerButton.click();
    assert(libraryPane.style.getPropertyValue('--cw-column-span') !== beforeClickColumn, 'Click pane resize did not change the column span.');
    buttonWithText('.cw-studio-size-row .cw-studio-button', 'Theme size').click();
    assert(document.querySelector('.cw-module[data-cw-module-key="library.browser"]')?.dataset.cwPlaced !== 'true', 'Theme size did not clear the explicit pane placement.');

    for (const label of ['Queue', 'Track information', 'Transport', 'Now playing']) {
      const trayItem = buttonWithText('.cw-studio-tray-item strong', label)?.closest('button');
      assert(trayItem, `${label} was not available in the Canvas Studio tray.`);
      trayItem.click();
      await waitFor(() => document.querySelectorAll('[data-cw-instance-id]').length >= 2, 2500, `${label} lifecycle admission`);
    }
    assert(document.querySelectorAll('[data-cw-instance-id]').length === 6, 'The complete required canvas did not reconcile to six live adapters.');
    assert(document.querySelector('.cw-module[data-cw-module-key="transport.controls"]')?.dataset.cwRootPolicy === 'shared-shell-member', 'Transport lost its shared-shell root boundary metadata.');
    assert(document.querySelector('.cw-module[data-cw-module-key="now-playing"] [data-cw-product-root="now-playing"]'), 'Now Playing was not relocated through its nested product-root boundary.');

    for (let index = 0; index < 2; index += 1) {
      const signalTrayItem = buttonWithText('.cw-studio-tray-item strong', 'Signal field')?.closest('button');
      assert(signalTrayItem, `Signal field instance ${index + 1} was not available in the multi-instance tray.`);
      signalTrayItem.click();
      await waitFor(() => document.querySelectorAll('.cw-module[data-cw-module-key="audio.visualizer"]').length === index + 1, 2500, `Signal field instance ${index + 1}`);
    }
    assert(document.querySelectorAll('[data-cw-product-root="audio.visualizer"]').length >= 2, 'Multi-instance Signal fields reused one product root.');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true, cancelable: true }));
    await waitFor(() => document.querySelectorAll('.cw-module[data-cw-module-key="audio.visualizer"]').length === 3, 2500, 'Canvas Studio shortcut duplicate');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
    await waitFor(() => document.querySelectorAll('.cw-module[data-cw-module-key="audio.visualizer"]').length === 2, 2500, 'Canvas Studio shortcut duplicate undo');
    const denseSource = document.querySelector('.cw-module[data-cw-module-key="audio.visualizer"]');
    const denseTarget = document.querySelector('.cw-module[data-cw-module-key="tracks.browser"]');
    const denseHandle = denseSource.querySelector(':scope > .cw-pane-drag-handle');
    const denseHandleRect = denseHandle.getBoundingClientRect();
    const denseTargetRect = denseTarget.getBoundingClientRect();
    const denseGrabStartedAt = performance.now();
    dispatchPointer(denseHandle, 'pointerdown', denseHandleRect.left + denseHandleRect.width / 2, denseHandleRect.top + denseHandleRect.height / 2, 452);
    const denseGrabMs = performance.now() - denseGrabStartedAt;
    assert(denseGrabMs <= 120 && document.body.dataset.cwStudioDense === 'true', `Dense canvas grab did not enter its low-overhead path within budget (${Math.round(denseGrabMs)} ms).`);
    const denseUpdateStartedAt = performance.now();
    dispatchPointer(denseTarget, 'pointermove', denseTargetRect.left + denseTargetRect.width * 0.25, denseTargetRect.top + denseTargetRect.height * 0.25, 452);
    const denseUpdateMs = performance.now() - denseUpdateStartedAt;
    assert(denseUpdateMs <= 120, `Dense canvas pointer update blocked the renderer for ${Math.round(denseUpdateMs)} ms.`);
    dispatchPointer(denseTarget, 'pointercancel', denseTargetRect.left + denseTargetRect.width * 0.25, denseTargetRect.top + denseTargetRect.height * 0.25, 452);
    assert(!document.body.dataset.cwStudioDense && !document.querySelector('.cw-drag-proxy'), 'Dense canvas drag cleanup left its performance mode or proxy active.');
    const denseResizeHandle = document.querySelector('.cw-grid > .cw-module[data-cw-module-key="library.browser"] > .cw-pane-resize-handle')
      || document.querySelector('.cw-grid > .cw-module > .cw-pane-resize-handle');
    assert(denseResizeHandle, 'Dense canvas exposed no direct resize handle.');
    const denseResizeRect = denseResizeHandle.getBoundingClientRect();
    dispatchPointer(denseResizeHandle, 'pointerdown', denseResizeRect.left + denseResizeRect.width / 2, denseResizeRect.top + denseResizeRect.height / 2, 453);
    const denseProductRoots = [...document.querySelectorAll('.cw-module > [data-cw-product-root]')].filter((root) => root.getBoundingClientRect().width > 0);
    assert(denseProductRoots.length > 4 && denseProductRoots.every((root) => root.dataset.cwResizeVisual === 'true' && getComputedStyle(root).contentVisibility !== 'hidden'), 'Dense resize did not preserve visible, layout-frozen product previews.');
    const denseResizeStartedAt = performance.now();
    dispatchPointer(denseResizeHandle, 'pointermove', denseResizeRect.left + denseResizeRect.width / 2 + 180, denseResizeRect.top + denseResizeRect.height / 2 + 168, 453);
    const denseResizeMs = performance.now() - denseResizeStartedAt;
    assert(denseResizeMs <= 120, `Dense canvas resize update blocked the renderer for ${Math.round(denseResizeMs)} ms.`);
    assert(denseProductRoots.some((root) => Math.abs(parseFloat(root.style.getPropertyValue('--cw-resize-scale-x')) - 1) > 0.001 || Math.abs(parseFloat(root.style.getPropertyValue('--cw-resize-scale-y')) - 1) > 0.001), 'Dense resize did not animate any visible product preview.');
    dispatchPointer(denseResizeHandle, 'pointercancel', denseResizeRect.left + denseResizeRect.width / 2 + 180, denseResizeRect.top + denseResizeRect.height / 2 + 168, 453);
    assert(!document.body.dataset.cwStudioPointer && denseProductRoots.every((root) => !root.dataset.cwResizeVisual && !root.style.getPropertyValue('--cw-resize-scale-x')), 'Dense resize cancellation left product previews frozen.');
    const instanceCountBeforeTemplate = document.querySelectorAll('[data-cw-instance-id]').length;
    buttonWithText('.cw-studio-template', 'Focus').click();
    assert(document.querySelectorAll('[data-cw-instance-id]').length === instanceCountBeforeTemplate, 'Focus template lost a placed module.');
    assert(document.querySelector('.cw-grid > .cw-module')?.dataset.cwModuleKey === 'tracks.browser', 'Focus template did not promote the Track browser.');

    libraryPane = document.querySelector('.cw-module[data-cw-module-key="library.browser"]');
    currentTracksPane = document.querySelector('.cw-module[data-cw-module-key="tracks.browser"]');
    arrangeWith('library.browser', 'tracks.browser', 'Stack with');
    await waitFor(() => document.querySelector('.cw-stack'), 2500, 'pane stacking');
    assert(!document.querySelector('.cw-module[data-cw-module-key="library.browser"]').hidden, 'The moved pane did not become the active stack member.');
    const stackSurface = document.querySelector('.cw-grid > .cw-stack');
    const stackResize = stackSurface?.querySelector(':scope > .cw-pane-resize-handle');
    assert(stackResize, 'A grid-level stack did not receive the same direct corner resize affordance as a module.');
    const stackResizeRect = stackResize.getBoundingClientRect();
    dispatchPointer(stackResize, 'pointerdown', stackResizeRect.left + stackResizeRect.width / 2, stackResizeRect.top + stackResizeRect.height / 2, 451);
    dispatchPointer(stackResize, 'pointermove', stackResizeRect.left + stackResizeRect.width / 2 + 60, stackResizeRect.top + stackResizeRect.height / 2 + 120, 451);
    dispatchPointer(stackResize, 'pointerup', stackResizeRect.left + stackResizeRect.width / 2 + 60, stackResizeRect.top + stackResizeRect.height / 2 + 120, 451);
    await waitFor(() => document.querySelector('.cw-grid > .cw-stack')?.dataset.cwPlaced === 'true', 2500, 'grid-level group resize');
    arrangeWith('library.browser', 'queue.view', 'Before');
    await waitFor(() => !document.querySelector('.cw-stack'), 2500, 'stack recombination');
    assert(document.querySelector('.cw-module[data-cw-module-key="tracks.browser"]'), 'Unstacking stranded the Track browser.');

    arrangeWith('queue.view', 'track.information', 'Stack with');
    await waitFor(() => document.querySelector('.cw-stack .cw-stack-switcher'), 2500, 'stack navigation controls');
    const stackTabs = [...document.querySelectorAll('.cw-stack > .cw-stack-switcher > .cw-stack-tab')];
    assert(stackTabs.length === 2 && stackTabs.filter((tab) => tab.getAttribute('aria-selected') === 'true').length === 1, 'Stack tabs do not expose one active child.');

    const save = buttonWithText('.cw-studio-commit .cw-studio-button', 'Save canvas');
    assert(save && !save.disabled, 'Canvas Studio did not enable save after every required job was placed.');
    save.click();
    await waitFor(() => document.body.dataset.compositionMode === 'use' && document.querySelector('#workspaceProductionStatus').textContent.includes('saved atomically'), 5000, 'Canvas Studio atomic save');
    assert(!document.querySelector('.cw-studio-launcher').hidden, 'Saved canvas did not expose a route back into Composition Mode.');
    const useModeTabs = [...document.querySelectorAll('.cw-stack > .cw-stack-switcher > .cw-stack-tab')];
    assert(useModeTabs.length === 2, 'Stack navigation disappeared in Use Mode.');
    const inactiveUseTab = useModeTabs.find((tab) => tab.getAttribute('aria-selected') !== 'true');
    const inactiveUseLabel = inactiveUseTab.textContent;
    inactiveUseTab.click();
    assert([...document.querySelectorAll('.cw-stack > .cw-stack-switcher > .cw-stack-tab')].find((tab) => tab.textContent === inactiveUseLabel)?.getAttribute('aria-selected') === 'true', 'Use Mode could not switch the visible stacked pane.');
    [...document.querySelectorAll('.cw-stack > .cw-stack-switcher > .cw-stack-tab')].find((tab) => tab.textContent.includes('Queue'))?.click();

    document.querySelector('.cw-studio-launcher').click();
    await waitFor(() => document.body.dataset.compositionMode === 'edit' && !document.querySelector('.cw-studio-rail')?.hidden && document.querySelector('.cw-studio-launcher')?.hidden, 2500, 'saved Canvas Studio re-entry');
    const queuePane = document.querySelector('.cw-module[data-cw-module-key="queue.view"]');
    const queueHandle = queuePane.querySelector(':scope > .cw-pane-drag-handle');
    const queueHandleBounds = queueHandle.getBoundingClientRect();
    const queueHandleHit = document.elementFromPoint(queueHandleBounds.left + queueHandleBounds.width / 2, queueHandleBounds.top + queueHandleBounds.height / 2);
    assert(queueHandleHit?.closest('.cw-pane-drag-handle') === queueHandle, 'Queue content painted above its visible Move handle.');
    const queueResizeHandle = queuePane.querySelector(':scope > .cw-pane-resize-handle') || queuePane.closest('.cw-stack, .cw-split')?.querySelector(':scope > .cw-pane-resize-handle');
    assert(queueResizeHandle, 'Queue and its containing canvas section exposed no resize affordance.');
    const queueResizeBounds = queueResizeHandle.getBoundingClientRect();
    const queueResizeHit = document.elementFromPoint(queueResizeBounds.left + queueResizeBounds.width / 2, queueResizeBounds.top + queueResizeBounds.height / 2);
    assert(queueResizeHit?.closest('.cw-pane-resize-handle') === queueResizeHandle, 'Queue content painted above its visible Resize handle.');
    const queueSelectStart = new Event('selectstart', { bubbles: true, cancelable: true });
    queueHandle.dispatchEvent(queueSelectStart);
    assert(queueSelectStart.defaultPrevented, 'Queue Move handle allowed native text selection to start.');
    const queueHandleRect = queueHandle.getBoundingClientRect();
    dispatchPointer(queueHandle, 'pointerdown', queueHandleRect.left + queueHandleRect.width / 2, queueHandleRect.top + queueHandleRect.height / 2, 471);
    const exposedCanvasText = document.querySelector('.cw-module:not([data-cw-module-key="queue.view"])');
    const exposedSelectStart = new Event('selectstart', { bubbles: true, cancelable: true });
    exposedCanvasText.dispatchEvent(exposedSelectStart);
    assert(exposedSelectStart.defaultPrevented && document.getSelection()?.rangeCount === 0, 'An active Queue move allowed text behind the lifted pane to become selected.');
    const exposedDragStart = new Event('dragstart', { bubbles: true, cancelable: true });
    exposedCanvasText.dispatchEvent(exposedDragStart);
    assert(exposedDragStart.defaultPrevented, 'An active Queue move allowed native content dragging behind the lifted pane.');
    dispatchPointer(exposedCanvasText, 'pointercancel', queueHandleRect.left, queueHandleRect.top, 471);
    assert(!document.querySelector('.cw-drag-proxy') && getComputedStyle(queuePane).display !== 'none', 'Cancelling the Queue gesture did not restore the live pane.');
    queueHandle.click();
    const inlineTarget = document.querySelector('.cw-module[data-cw-module-key="tracks.browser"]');
    inlineTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    assert(inlineTarget.querySelector(':scope > .cw-inline-target-menu'), 'Click-to-move still requires the Canvas Studio rail instead of exposing pane-local destinations.');
    buttonWithText('.cw-inline-target-menu .cw-inline-target-action', 'Cancel').click();
    assert(!document.querySelector('.cw-inline-target-menu'), 'Pane-local move cancellation left its target menu behind.');
    queuePane.focus();
    queuePane.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    assert(queuePane.hasAttribute('data-cw-studio-selected'), 'Keyboard Space selection did not select Queue.');
    assert(document.querySelector('.cw-studio-target-field select')?.options.length >= 1, 'Keyboard/menu destination picker is missing.');
    assert(document.querySelector('.cw-studio-warning'), 'Required-pane removal warning is missing.');
    buttonWithText('.cw-studio-selection .cw-studio-button', 'Return to tray').click();
    await waitFor(() => !document.querySelector('[data-cw-module="queue.view"]'), 2500, 'required Queue draft removal');
    assert(buttonWithText('.cw-studio-commit .cw-studio-button', 'Save canvas')?.disabled, 'An incomplete canvas incorrectly enabled save.');
    buttonWithText('.cw-studio-commit .cw-studio-button', 'Discard draft').click();
    await waitFor(() => document.body.dataset.compositionMode === 'use' && document.querySelector('[data-cw-module="queue.view"]'), 3500, 'discarded Queue restoration');

    portSelect.value = 'cartridge-quest';
    portSelect.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => document.body.dataset.canvasThemePort === 'cartridge-quest' && navigationDispatcher.getCurrentKey() === 'carousel', 5000, 'Cartridge Quest baseline Canvas port');
    assert(document.body.dataset.canvasPortType === 'pixel' && document.body.dataset.canvasPortCorners === 'pixel-cut', 'The representative port did not apply its manifest-authored type and corner traits.');
    assert(document.body.dataset.canvasPortComposition === 'archive-host', 'The representative port did not expose its archive-host composition identity.');
    assert(document.documentElement.style.getPropertyValue('--gold').trim() === paletteDefinitions['cartridge-quest'].gold, 'The representative port did not apply its preserved palette.');
    assert(document.querySelector('link[href="canvas-theme-ports.css"]')?.disabled === false, 'Canvas port CSS remained disabled inside the Canvas gate.');
    assert(document.querySelector('link[href="canvas-cartridge-quest.css"]')?.disabled === false, 'The dedicated Cartridge Quest experience stylesheet remained disabled.');
    assert(document.querySelector('.rail-heading strong')?.textContent === 'Cartridge Rack', 'Cartridge Quest did not restore its cartridge-library vocabulary.');
    const portGraph = productionWorkspaceHost.snapshot().session.graph;
    assert(portGraph.id === 'canvas-port-cartridge-quest-root', 'Theme switching did not install the Cartridge Quest stock composition graph.');
    const portGrid = portGraph.children[0].children[0];
    const portStage = portGrid.children.find((node) => node.id === 'canvas-port-cartridge-quest-stage');
    const portTracks = portStage?.children.find((node) => node.moduleKey === 'tracks.browser');
    const portLibrary = portGrid.children.find((node) => node.moduleKey === 'library.browser');
    // Ports keep the archive's coarse coordinates and multiply them onto the
    // fine grid (contract COLUMN_DIVISIONS 4, ROW_DIVISIONS 6), which renders
    // the archive frame identically.
    const archivePlacement = (columnStart, rowStart, columnSpan, rowSpan) => JSON.stringify({ columnStart: ((columnStart - 1) * 4) + 1, rowStart: ((rowStart - 1) * 6) + 1, columnSpan: columnSpan * 4, rowSpan: rowSpan * 6 });
    assert(portGrid.columns === 24 * 4, 'Cartridge Quest did not use the archive-fidelity desktop grid.');
    assert(JSON.stringify(portStage?.placement) === archivePlacement(6, 1, 14, 1), 'Cartridge Quest center-stage coordinates or size drifted.');
    assert(JSON.stringify(portTracks?.placement) === archivePlacement(1, 1, 24, 1), 'Cartridge Quest track browser no longer fills its archived center stage.');
    assert(JSON.stringify(portLibrary?.placement) === archivePlacement(1, 1, 5, 1), 'Cartridge Quest library coordinates or size drifted.');
    assert(getComputedStyle(document.body).getPropertyValue('--canvas-port-gutter').trim() === '14px', 'Cartridge Quest fidelity-repaired module spacing did not apply.');
    assert(getComputedStyle(document.body).getPropertyValue('--canvas-port-player-height').trim() === '128px', 'Cartridge Quest player height did not preserve the archived controller deck.');
    const portStageSurface = document.querySelector('[data-cw-node-id="canvas-port-cartridge-quest-stage"]');
    const portLibrarySurface = document.querySelector('[data-cw-module-key="library.browser"]');
    const portUtilitySurface = document.querySelector('[data-cw-node-id="canvas-port-cartridge-quest-utility-stack"]');
    const portFieldSurface = document.querySelector('[data-cw-node-id="canvas-field"]');
    const portStageBounds = portStageSurface?.getBoundingClientRect();
    const portLibraryBounds = portLibrarySurface?.getBoundingClientRect();
    const portUtilityBounds = portUtilitySurface?.getBoundingClientRect();
    assert(portLibraryBounds?.right <= portStageBounds?.left && portStageBounds?.right <= portUtilityBounds?.left, 'The painted Cartridge Quest regions no longer run Library / Stage / Inspector from left to right.');
    assert(Math.abs(portLibraryBounds.height - portStageBounds.height) < 2 && Math.abs(portUtilityBounds.height - portStageBounds.height) < 2, 'The painted archive-host regions no longer share the original full workspace height.');
    // The Canvas docks the player inside the workspace, so the composition runs
    // to the window's bottom: the band is the window less the 64px header and
    // the deck's row (canvas-theme-ports.js), not the archive's shorter 334px
    // cut, which left 128px empty under the deck.
    const cartridgeDeckBottom = document.querySelector('.player')?.getBoundingClientRect().bottom || 0;
    assert(window.innerHeight - cartridgeDeckBottom <= 16, `The painted Cartridge Quest composition no longer reaches the bottom of the window (deck ends ${Math.round(window.innerHeight - cartridgeDeckBottom)}px above it, field ${Math.round(portFieldSurface?.getBoundingClientRect().top || 0)}-${Math.round(portFieldSurface?.getBoundingClientRect().bottom || 0)}, band ${getComputedStyle(document.querySelector('.cw-canvas')).getPropertyValue('--cw-port-band').trim() || 'missing'}, strip ${getComputedStyle(document.querySelector('.cw-canvas')).getPropertyValue('--cw-host-strip').trim() || 'none'}).`);
    const cartridgePlayer = document.querySelector('.player');
    const cartridgePlayerBounds = cartridgePlayer?.getBoundingClientRect();
    const cartridgePlayerHeight = cartridgePlayer?.getBoundingClientRect().height || 0;
    const cartridgePlayerStyle = cartridgePlayer ? getComputedStyle(cartridgePlayer) : null;
    const cartridgeLibraryStyle = portLibrarySurface ? getComputedStyle(portLibrarySurface) : null;
    const cartridgeModuleStamp = portLibrarySurface ? getComputedStyle(portLibrarySurface, '::after').content : '';
    const cartridgeStageStyle = getComputedStyle(document.querySelector('.playlist-hero'));
    const cartridgeBootStyle = getComputedStyle(document.querySelector('#questBootMessage'));
    const cartridgeCabinetStyle = getComputedStyle(document.querySelector('.quest-cabinet-stack'));
    const cartridgeBossStyle = getComputedStyle(document.querySelector('.quest-boss-bar'));
    const cartridgeHudStyle = getComputedStyle(document.querySelector('.quest-hotbar-hud'));
    assert(cartridgeLibraryStyle?.backgroundImage?.includes('linear-gradient'), 'Cartridge Quest detail recipe did not paint its archived chassis material.');
    assert(cartridgeModuleStamp.includes('CQ-16 / DECK'), `Cartridge Quest module stamp is missing (${cartridgeModuleStamp || 'empty'}).`);
    assert(cartridgePlayerStyle?.borderTopColor === 'rgb(36, 38, 50)', `Cartridge Quest controller deck did not restore its dark hardware seam (${cartridgePlayerStyle?.borderTopColor || 'missing'}).`);
    assert(cartridgeStageStyle?.backgroundImage && cartridgeStageStyle.backgroundImage !== 'none', 'Cartridge Quest title-screen stage lost both the authored fallback and the fixture-owned collection artwork.');
    assert(cartridgeStageStyle?.backgroundImage.includes('snes-workbench.png'), `Cartridge Quest no-artwork stage did not retain its authored workbench (${cartridgeStageStyle?.backgroundImage || 'missing'}).`);
    assert(getComputedStyle(document.querySelector('.playlist-cover')).backgroundImage.includes('music-cartridge.png'), 'Cartridge Quest no-artwork title cartridge did not retain its authored asset.');
    assert(getComputedStyle(document.querySelector('.playlist-thumb')).backgroundImage.includes('music-cartridge.png'), 'Cartridge Quest cartridge rack thumbnails did not retain their authored asset.');
    assert(cartridgeBootStyle?.display === 'flex', `Cartridge Quest boot-state readout stayed parked by the neutral Canvas shell (${cartridgeBootStyle?.display || 'missing'}).`);
    assert(cartridgeCabinetStyle?.display === 'grid', `Cartridge Quest save/route/achievement cabinet stayed parked (${cartridgeCabinetStyle?.display || 'missing'}).`);
    assert(cartridgeBossStyle?.display === 'grid', `Cartridge Quest truthful track-progress encounter strip is unavailable (${cartridgeBossStyle?.display || 'missing'}).`);
    assert(cartridgeHudStyle?.display === 'grid', `Cartridge Quest listening XP cabinet is unavailable (${cartridgeHudStyle?.display || 'missing'}).`);
    assert(Math.abs(cartridgePlayerHeight - 128) < 2, `The painted Cartridge Quest player is ${cartridgePlayerHeight}px instead of the archived 128px height (computed ${cartridgePlayerStyle?.height || 'missing'}, parent ${cartridgePlayer?.parentElement?.className || 'missing'}, anchor ${cartridgePlayer?.closest?.('[data-cw-anchored]')?.dataset?.cwAnchored || 'missing'}, variable ${getComputedStyle(document.body).getPropertyValue('--canvas-port-player-height').trim() || 'missing'}).`);
    // Measured on the panes: the field's own box bleeds half a gutter past
    // its track (margin -7px), so its edge sits under the separation.
    const cartridgeFieldBottom = Math.max(0, ...[...(portFieldSurface?.querySelectorAll('.cw-node') || [])].map((node) => node.getBoundingClientRect().bottom));
    const cartridgeDeckGap = (cartridgePlayerBounds?.top || 0) - cartridgeFieldBottom;
    assert(cartridgeDeckGap >= 10, `Cartridge Quest controller deck is still pressed directly against the main module field (gap ${Math.round(cartridgeDeckGap)}px, field bottom ${Math.round(cartridgeFieldBottom)}px, player top ${Math.round(cartridgePlayerBounds?.top || 0)}px).`);
    const cartridgeTrackPane = document.querySelector('[data-cw-module-key="tracks.browser"]');
    assert(cartridgeTrackPane?.dataset.cwAnimation === 'scan' && cartridgeTrackPane?.dataset.cwParticles === 'pixels' && cartridgeTrackPane?.dataset.cwEffectTrigger === 'playback', 'Cartridge Quest Stage did not project its persisted module-effect recipe.');
    document.querySelector('.cw-studio-launcher')?.click();
    await waitFor(() => document.body.dataset.compositionMode === 'edit', 2500, 'Cartridge Quest module-effects editor');
    cartridgeTrackPane?.click();
    await waitFor(() => document.querySelector('.cw-studio-effects'), 1600, 'Cartridge Quest selected-pane effects controls');
    assert(document.querySelectorAll('.cw-studio-effects select').length === 5, 'Canvas Studio did not expose the complete animation, particle, trigger, intensity, and speed control set.');
    const particleControl = document.querySelector('.cw-studio-effects select[aria-label^="Particle field"]');
    particleControl.value = 'stars';
    particleControl.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => document.querySelector('[data-cw-module-key="tracks.browser"]')?.dataset.cwParticles === 'stars', 1600, 'live module particle configuration');
    assert(productionWorkspaceHost.snapshot().session.graph.children[0].children[0].children.find((entry) => entry.id === 'canvas-port-cartridge-quest-stage')?.children.find((entry) => entry.moduleKey === 'tracks.browser')?.configuration?.effects?.particles === 'stars', 'Particle selection painted without entering the canonical composition graph.');
    document.querySelector('.cw-studio-effects select[aria-label^="Particle field"]').value = 'pixels';
    document.querySelector('.cw-studio-effects select[aria-label^="Particle field"]').dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => document.querySelector('[data-cw-module-key="tracks.browser"]')?.dataset.cwParticles === 'pixels', 1600, 'module particle configuration restore');
    buttonWithText('.cw-studio-commit .cw-studio-button', 'Discard draft').click();
    await waitFor(() => document.body.dataset.compositionMode === 'use', 2500, 'Cartridge Quest effects editor exit');
    if (config.visualMode) {
      const questGeometry = (selector) => {
        const element = document.querySelector(selector);
        const bounds = element?.getBoundingClientRect();
        const style = element ? getComputedStyle(element) : null;
        return element && bounds && style ? {
          selector,
          rect: { x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) },
          display: style.display,
          position: style.position,
          overflow: style.overflow,
          visibility: style.visibility,
          opacity: style.opacity,
          maxHeight: style.maxHeight,
        } : { selector, missing: true };
      };
      await report('cartridge-quest-surface-geometry', {
        hero: questGeometry('.playlist-hero'),
        heroContent: questGeometry('.hero-content'),
        heroCopy: questGeometry('.hero-copy'),
        cover: questGeometry('.playlist-cover'),
        cabinetStack: questGeometry('.quest-cabinet-stack'),
        firstCabinet: questGeometry('.quest-info-cabinet'),
        cabinetCount: document.querySelectorAll('.quest-info-cabinet').length,
      });
      const cartridgeCabinets = [...document.querySelectorAll('.quest-info-cabinet')];
      const cartridgeCabinetStackBounds = document.querySelector('.quest-cabinet-stack')?.getBoundingClientRect();
      assert(cartridgeCabinets.length === 4, `Cartridge Quest rendered ${cartridgeCabinets.length} cabinet rows instead of the archived four.`);
      assert(cartridgeCabinets.every((cabinet) => getComputedStyle(cabinet).display !== 'none'), 'Cartridge Quest left at least one authored cabinet row hidden.');
      assert((cartridgeCabinetStackBounds?.height || 0) >= 140, `Cartridge Quest cabinet stack collapsed to ${Math.round(cartridgeCabinetStackBounds?.height || 0)}px.`);
      const canvasLauncherBounds = document.querySelector('.cw-studio-launcher')?.getBoundingClientRect();
      const studioLauncherBounds = document.querySelector('.cw-studio-legacy-launcher')?.getBoundingClientRect();
      assert((canvasLauncherBounds?.bottom || Infinity) <= 58 && (studioLauncherBounds?.bottom || Infinity) <= 58, 'Cartridge Quest Canvas routes cover the cartridge rack instead of living in the top hardware strip.');
      broadcastPlayerState();
      await new Promise((resolve) => setTimeout(resolve, 120));
      const wide = await bridge.action('capture-canvas-cartridge-quest-wide');
      assert(wide?.ok === true && wide.runtime?.canvasThemePort === 'cartridge-quest', 'Cartridge Quest wide painted capture failed or reported the wrong Canvas port.');
      cartridgeQuestArtifacts.wide = wide.artifact;
      await window.desktop.openMiniPlayer();
      await new Promise((resolve) => setTimeout(resolve, 420));
      const mini = await bridge.action('capture-canvas-cartridge-quest-mini');
      assert(mini?.ok === true && mini.runtime?.canvasThemePort === 'cartridge-quest', 'Cartridge Quest mini painted capture failed or reported the wrong Canvas port.');
      cartridgeQuestArtifacts.mini = mini.artifact;
      await bridge.action('close-mini');
      const questGlowToggle = document.querySelector('[data-effect="glow"]');
      if (questGlowToggle) {
        questGlowToggle.checked = true;
        questGlowToggle.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await waitFor(() => document.body.dataset.effectGlow === 'true', 1200, 'Cartridge Quest signal-glow evidence mode');
      document.querySelector('#motionSetting [data-motion="expressive"]')?.click();
      await waitFor(() => document.body.dataset.motion === 'expressive', 1200, 'Cartridge Quest expressive playback evidence mode');
      document.querySelector('#playButton')?.click();
      await waitFor(() => document.body.classList.contains('is-playing'), 2500, 'Cartridge Quest confirmed playback state');
      const questSignalRingStyle = getComputedStyle(document.querySelector('.playlist-cover .signal-orbit-ring'));
      assert(questSignalRingStyle.display === 'block' && questSignalRingStyle.backgroundImage.includes('gradient'), 'Cartridge Quest confirmed playback did not restore its stepped signal portal.');
      const playing = await bridge.action('capture-canvas-cartridge-quest-playing');
      assert(playing?.ok === true && playing.runtime?.canvasThemePort === 'cartridge-quest', 'Cartridge Quest playing painted capture failed or reported the wrong Canvas port.');
      cartridgeQuestArtifacts.playing = playing.artifact;
      await window.desktop.openMiniPlayer();
      broadcastPlayerState();
      await new Promise((resolve) => setTimeout(resolve, 420));
      const miniPlaying = await bridge.action('capture-canvas-cartridge-quest-playing-mini');
      assert(miniPlaying?.ok === true && miniPlaying.runtime?.canvasThemePort === 'cartridge-quest', 'Cartridge Quest playing mini capture failed or reported the wrong Canvas port.');
      cartridgeQuestArtifacts.miniPlaying = miniPlaying.artifact;
      await bridge.action('close-mini');
      document.querySelector('#playButton')?.click();
      await waitFor(() => !document.body.classList.contains('is-playing'), 1800, 'Cartridge Quest return to paused evidence state');
      document.querySelector('#motionSetting [data-motion="off"]')?.click();
      await waitFor(() => document.body.dataset.motion === 'off', 1200, 'Cartridge Quest motion-off evidence restore');
      if (questGlowToggle) {
        questGlowToggle.checked = false;
        questGlowToggle.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await waitFor(() => document.body.dataset.effectGlow === 'false', 1200, 'Cartridge Quest signal-glow evidence restore');
      const narrowState = await bridge.action('resize-main-narrow');
      assert(narrowState?.ok === true, 'Cartridge Quest narrow evidence window failed to open.');
      await waitFor(() => innerWidth === narrowState.windowState.contentBounds.width, 1800, 'Cartridge Quest narrow renderer viewport');
      assert(document.querySelector('#playButton')?.getBoundingClientRect().width > 0 && document.querySelector('#queueButton')?.getBoundingClientRect().width > 0, 'Cartridge Quest narrow layout lost playback or Queue access.');
      const narrowStageBounds = document.querySelector('[data-cw-node-id="canvas-port-cartridge-quest-stage"]')?.getBoundingClientRect();
      const narrowLibraryBounds = document.querySelector('[data-cw-module-key="library.browser"]')?.getBoundingClientRect();
      const narrowUtilityBounds = document.querySelector('[data-cw-node-id="canvas-port-cartridge-quest-utility-stack"]')?.getBoundingClientRect();
      const narrowPlayerBounds = document.querySelector('[data-cw-anchored=".player"]')?.getBoundingClientRect();
      const narrowHeroBounds = document.querySelector('.playlist-hero')?.getBoundingClientRect();
      const narrowLastCabinetBounds = [...document.querySelectorAll('.quest-info-cabinet')].at(-1)?.getBoundingClientRect();
      await report('cartridge-quest-narrow-geometry', {
        viewport: { width: innerWidth, height: innerHeight },
        stage: narrowStageBounds ? { top: narrowStageBounds.top, bottom: narrowStageBounds.bottom, height: narrowStageBounds.height } : null,
        hero: narrowHeroBounds ? { top: narrowHeroBounds.top, bottom: narrowHeroBounds.bottom, height: narrowHeroBounds.height } : null,
        library: narrowLibraryBounds ? { top: narrowLibraryBounds.top, bottom: narrowLibraryBounds.bottom, height: narrowLibraryBounds.height } : null,
        utility: narrowUtilityBounds ? { top: narrowUtilityBounds.top, bottom: narrowUtilityBounds.bottom, height: narrowUtilityBounds.height } : null,
        player: narrowPlayerBounds ? { top: narrowPlayerBounds.top, bottom: narrowPlayerBounds.bottom, height: narrowPlayerBounds.height } : null,
        lastCabinet: narrowLastCabinetBounds ? { top: narrowLastCabinetBounds.top, bottom: narrowLastCabinetBounds.bottom, height: narrowLastCabinetBounds.height } : null,
        outerGrid: getComputedStyle(document.querySelector('[data-cw-node-id="canvas-field"]')).gridTemplateRows,
      });
      assert((narrowLibraryBounds?.top || 0) >= (narrowStageBounds?.bottom || 0) - 2, 'Cartridge Quest narrow library overlaps its title-screen stage.');
      assert((narrowUtilityBounds?.top || 0) >= (narrowStageBounds?.bottom || 0) - 2, 'Cartridge Quest narrow inspector overlaps its title-screen stage.');
      assert((narrowPlayerBounds?.top || 0) >= Math.max(narrowLibraryBounds?.bottom || 0, narrowUtilityBounds?.bottom || 0) - 2, `Cartridge Quest narrow controller dock overlaps its library or inspector row (player top ${Math.round(narrowPlayerBounds?.top || 0)}, library bottom ${Math.round(narrowLibraryBounds?.bottom || 0)}, utility bottom ${Math.round(narrowUtilityBounds?.bottom || 0)}).`);
      assert((narrowLastCabinetBounds?.bottom || Infinity) <= (narrowStageBounds?.bottom || 0) + 2, `Cartridge Quest narrow title screen clips the lower authored cabinet rows (cabinet bottom ${Math.round(narrowLastCabinetBounds?.bottom || 0)}, stage bottom ${Math.round(narrowStageBounds?.bottom || 0)}, stage height ${Math.round(narrowStageBounds?.height || 0)}, rows ${getComputedStyle(document.querySelector('[data-cw-node-id="canvas-field"]')).gridTemplateRows}).`);
      const narrow = await bridge.action('capture-canvas-cartridge-quest-narrow');
      assert(narrow?.ok === true && narrow.isMaximized === false, 'Cartridge Quest narrow painted capture failed.');
      cartridgeQuestArtifacts.narrow = narrow.artifact;
      const restored = await bridge.action('maximize-main');
      assert(restored?.ok === true, 'Cartridge Quest evidence run did not restore the maximized workspace.');
      await waitFor(() => innerWidth === restored.windowState.contentBounds.width, 1800, 'Cartridge Quest restored maximized viewport');
    }
    portSelect.value = 'obsession';
    portSelect.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => document.body.dataset.canvasThemePort === 'obsession' && productionWorkspaceHost.snapshot().session.graph.id === 'canvas-port-obsession-root', 5000, 'Obsession Mode reconstruction Canvas port');
    assert(document.querySelector('link[href="canvas-obsession.css"]')?.disabled === false, 'The dedicated Obsession experience stylesheet remained disabled.');
    assert(document.querySelector('link[href="canvas-cartridge-quest.css"]')?.disabled === true, 'Cartridge Quest experience CSS leaked into Obsession.');
    assert(document.body.dataset.canvasPortType === 'display' && document.body.dataset.canvasPortCorners === 'pixel-cut', 'Obsession did not apply its manifest-authored type and corner traits.');
    assert(document.body.dataset.canvasPortComposition === 'archive-host', 'Obsession did not expose its archive-host composition identity.');
    // One mark, and it moves: the mark is owned by the body, so its state and
    // its coordinates live in exactly one place. A surface growing a mark of
    // its own is the failure this asserts against.
    await waitFor(() => ['rest', 'intent', 'playback'].includes(document.body.dataset.obsessionMark || ''), 2500, 'Obsession registration mark state');
    if (document.body.dataset.obsessionMark !== 'rest') {
      assert(document.body.style.getPropertyValue('--ob-mark-height').endsWith('px'), 'The Obsession mark resolved a target without taking its height.');
    }
    const obsessionBands = Array.from(document.querySelectorAll('#trackRows .track-row[data-obsession-pressure]')).map((row) => row.dataset.obsessionPressure);
    assert(obsessionBands.every((band) => ['1', '2', '3', '4'].includes(band)), 'Obsession typographic pressure escaped its four bands.');

    portSelect.value = 'neon-burst';
    portSelect.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => document.body.dataset.canvasThemePort === 'neon-burst' && productionWorkspaceHost.snapshot().session.graph.id === 'canvas-port-neon-burst-root', 5000, 'Neon Burst reconstruction Canvas port');
    assert(document.querySelector('link[href="canvas-neon-burst.css"]')?.disabled === false, 'The dedicated Neon Burst experience stylesheet remained disabled.');
    assert(document.querySelector('link[href="canvas-obsession.css"]')?.disabled === true, 'Obsession experience CSS leaked into Neon Burst.');
    assert(document.body.dataset.obsessionMark === undefined, 'The Obsession registration mark survived the switch to Neon Burst.');
    // The press is out of register, and confirmation pulls it true. Asserted as
    // the invariant rather than a value, so the scenario holds whatever the
    // playback state happens to be when it runs.
    const neonSlip = getComputedStyle(document.body).getPropertyValue('--nb-slip').trim();
    assert((neonSlip === '0px') === document.body.classList.contains('is-playing'), `Neon Burst registration does not track confirmed playback (slip ${neonSlip}, playing ${document.body.classList.contains('is-playing')}).`);
    // An untagged track must never render at a pitch that could be mistaken for
    // a measured one, so the two ranges are asserted disjoint.
    const neonTempo = document.body.dataset.nbTempo;
    const neonPitch = Number.parseInt(getComputedStyle(document.body).getPropertyValue('--nb-halftone'), 10);
    assert(['tagged', 'untagged'].includes(neonTempo), 'Neon Burst did not resolve a tempo state for the confirmed track.');
    if (neonTempo === 'untagged') assert(neonPitch === 19, `An untagged track must use the 19px line-screen pitch, not ${neonPitch}px.`);
    else assert(neonPitch >= 8 && neonPitch <= 15, `A measured halftone pitch must stay inside the 8-15px band, not ${neonPitch}px.`);

    portSelect.value = 'lo-fi-cafe';
    portSelect.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => document.body.dataset.canvasThemePort === 'lo-fi-cafe' && productionWorkspaceHost.snapshot().session.graph.id === 'canvas-port-lo-fi-cafe-root', 5000, 'Lo-Fi Cafe reconstruction Canvas port');
    assert(document.querySelector('link[href="canvas-lo-fi-cafe.css"]')?.disabled === false, 'The dedicated Lo-Fi Cafe experience stylesheet remained disabled.');
    assert(document.querySelector('link[href="canvas-neon-burst.css"]')?.disabled === true, 'Neon Burst experience CSS leaked into Lo-Fi Cafe.');
    assert(document.body.dataset.nbTempo === undefined, 'The Neon Burst tempo state survived the switch to Lo-Fi Cafe.');
    // The lamp is bounded and reaches glow only, so the whole of its range must
    // be a legal 0-1 value and nothing else.
    const cafeLamp = Number.parseFloat(document.body.style.getPropertyValue('--cafe-lamp'));
    assert(Number.isFinite(cafeLamp) && cafeLamp >= 0 && cafeLamp <= 1, `The Lo-Fi Cafe lamp resolved outside its range (${cafeLamp}).`);
    // The shelf is chosen, never inferred: with nothing anchored no card may
    // claim a place on it.
    assert(Array.isArray(state.cafeAnchors), 'The shelf is not a durable list.');
    if (!state.cafeAnchors.length) assert(!document.querySelector('#playlistList .playlist-item[data-cafe-anchor="true"]'), 'A collection claimed a place on the shelf without being chosen.');
    const cafeWear = Array.from(document.querySelectorAll('#playlistList .playlist-item[data-cafe-wear]')).map((item) => item.dataset.cafeWear);
    assert(cafeWear.every((value) => value === 'played' || value === 'none'), 'Lo-Fi Cafe paper wear resolved a state that is neither played nor unplayed.');

    portSelect.value = 'monument';
    portSelect.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => document.body.dataset.canvasThemePort === 'monument' && productionWorkspaceHost.snapshot().session.graph.id === 'canvas-port-monument-root', 5000, 'stock composition switch from Cartridge Quest to Monument');
    assert(document.querySelector('link[href="canvas-cartridge-quest.css"]')?.disabled === true, 'Cartridge Quest experience CSS leaked into Monument.');
    assert(document.querySelector('link[href="canvas-obsession.css"]')?.disabled === true, 'Obsession experience CSS leaked into Monument.');
    assert(document.querySelector('link[href="canvas-neon-burst.css"]')?.disabled === true, 'Neon Burst experience CSS leaked into Monument.');
    assert(document.body.dataset.nbTempo === undefined, 'The Neon Burst tempo state leaked into Monument.');
    assert(document.body.dataset.obsessionMark === undefined, 'The Obsession registration mark leaked into Monument.');
    assert(document.querySelector('link[href="canvas-lo-fi-cafe.css"]')?.disabled === true, 'Lo-Fi Cafe experience CSS leaked into Monument.');
    assert(!document.body.style.getPropertyValue('--cafe-lamp'), 'The Lo-Fi Cafe lamp leaked into Monument.');
    assert(document.querySelector('.rail-heading strong')?.textContent === 'Your Library', 'Cartridge Quest library vocabulary leaked into Monument.');
    const monumentGrid = productionWorkspaceHost.snapshot().session.graph.children[0].children[0];
    const monumentStage = monumentGrid.children.find((node) => node.id === 'canvas-port-monument-stage');
    const monumentTracks = monumentStage?.children.find((node) => node.moduleKey === 'tracks.browser');
    const monumentLibrary = monumentGrid.children.find((node) => node.moduleKey === 'library.browser');
    assert(JSON.stringify(monumentTracks?.placement) === archivePlacement(1, 1, 24, 1), 'Monument track browser no longer fills its archived center stage.');
    assert(JSON.stringify(monumentLibrary?.placement) === archivePlacement(1, 1, 5, 1), 'Monument library coordinates or size drifted.');
    assert(getComputedStyle(document.body).getPropertyValue('--canvas-port-gutter').trim() === '8px', 'Monument archive spacing did not replace the previous preset spacing.');
    assert(getComputedStyle(document.body).getPropertyValue('--canvas-port-player-height').trim() === '88px', 'Monument player height did not return to the archived base deck.');
    const monumentLibrarySurface = document.querySelector('[data-cw-module-key="library.browser"]');
    const monumentPlayer = document.querySelector('.player');
    const monumentLibraryStyle = monumentLibrarySurface ? getComputedStyle(monumentLibrarySurface) : null;
    const monumentPlayerStyle = monumentPlayer ? getComputedStyle(monumentPlayer) : null;
    const monumentModuleStamp = monumentLibrarySurface ? getComputedStyle(monumentLibrarySurface, '::after').content : '';
    assert(monumentModuleStamp.includes('COLLECTION PLINTH'), `Monument module stamp is missing (${monumentModuleStamp || 'empty'}).`);
    assert(monumentLibraryStyle?.backgroundImage !== cartridgeLibraryStyle?.backgroundImage, 'Switching from Cartridge Quest to Monument kept the previous theme material.');
    assert(monumentPlayerStyle?.borderTopColor === 'rgb(74, 69, 62)' && monumentPlayerStyle?.borderRightColor === 'rgb(23, 25, 28)', `Monument player seams did not use the authored stone top and museum ink edge (${monumentPlayerStyle?.borderColor || 'missing'}).`);
    const persistedPortComposition = await window.desktop.loadWorkspaceComposition();
    assert(persistedPortComposition?.state?.graph?.id === 'canvas-port-monument-root', 'The switched stock composition was painted but not committed to durable workspace authority.');

    entry.click();
    await waitFor(() => document.body.dataset.theme === 'studio' && !document.body.classList.contains('cw-production-host-active'), 10000, 'Canvas Studio return to Studio');
    assert(!document.querySelector('[data-cw-instance-id]'), 'Canvas Studio adapter markers leaked into Studio.');
    return {
      startupMs: Math.round(startupMs),
      grabHandlerMs: Math.round(grabHandlerMs),
      dragUpdateMs: Math.round(dragUpdateMs),
      canvasModuleCount,
      denseGrabMs: Math.round(denseGrabMs),
      denseUpdateMs: Math.round(denseUpdateMs),
      denseResizeMs: Math.round(denseResizeMs),
      placementCommitHandlerMs: Math.round(placementCommitHandlerMs),
      resizeUpdateMs: Math.round(resizeUpdateMs),
      resizeCommitMs: Math.round(resizeCommitMs),
      visibleSettingsEntry: true,
      keyboardPaneSelection: true,
      directPaneSplitStackRecombine: true,
      liveProvisionalReflow: true,
      liftedPaneFollowsPointer: true,
      paneLocalActions: true,
      inlineMoveDestinations: true,
      pointerAndKeyboardResize: true,
      singlePointerResizeAlternative: true,
      incrementalSameTopologyPaint: true,
      semanticLargeHitTargets: true,
      nestedRootPolicies: true,
      lifecycleInsertRemove: true,
      requiredJobSaveGate: true,
      atomicSave: true,
      compositionReentry: true,
      discardRestoredAuthority: true,
      studioRestored: true,
      cartridgeQuestArtifacts,
    };
  }

  async function scenarioSingularityStage3(startupMs) {
    await waitFor(() => document.body.dataset.singularityProbeReady === 'true', 5000, 'Singularity R2 product host');
    assert(document.body.dataset.runtimeMode === 'development', 'Singularity R2 escaped the development runtime boundary.');
    assert(runtimeInfo.singularityProbeMode === 'graph', 'Singularity R2 did not start through the explicit graph launch gate.');
    assert(appearance.theme === 'studio' && document.body.dataset.theme === 'studio', 'Singularity R2 replaced the registered Studio theme.');
    assert(singularityLiveHost?.snapshot().mode === 'graph', 'Singularity R2 live-host controller is unavailable.');
    const captures = [];

    const host = document.querySelector('.sg-live-host');
    assert(host?.dataset.profileId === 'singularity-gravitational-field-r2', 'Singularity R2 mounted the wrong product profile.');
    assert(host?.dataset.panelModel === 'singularity-projective-panel-r1', 'Singularity R2 mounted the wrong panel construction.');
    const initialTrack = state.tracks.find((track) => track.id === 'cf-track-03');
    assert(currentFixture() === 'cf-track-03' && audio.paused && $('#playerTitle').textContent === initialTrack?.title, 'Singularity fixture did not preserve the initial paused confirmed output.');
    const moduleIds = ['library', 'albums', 'tracks', 'secondary'];
    const roots = {
      library: document.querySelector('[data-cw-product-root="library.browser"]'),
      albums: document.querySelector('[data-singularity-product-root="albums.collection"]'),
      tracks: document.querySelector('[data-singularity-product-root="tracks.collection"]'),
      secondary: document.querySelector('[data-cw-product-root="track.information"]'),
    };
    $('#search').focus({ preventScroll: true });
    await waitFor(() => moduleIds.every((id) => host.querySelector(`.sg-shell[data-module-id="${id}"]`)?.dataset.state === 'dormant'), 1200, 'neutral resting field');
    for (const id of moduleIds) {
      const shell = host.querySelector(`.sg-shell[data-module-id="${id}"]`);
      const mount = shell?.querySelector('.sg-shell-mount');
      const bounds = shell?.getBoundingClientRect();
      assert(shell && mount && roots[id]?.parentNode === mount, `Singularity ${id} did not mount as an independently projected product root.`);
      assert(shell.dataset.state === 'dormant' && roots[id].hidden === false && roots[id].inert === true, `Singularity ${id} was not completely visible and non-interactive in its dormant projection.`);
      assert(bounds?.width > 0 && bounds?.height > 0, `Singularity ${id} collapsed out of the rendered field.`);
    }
    const osReducedMotion = await verifySingularityOsReducedMotion('Singularity H-B', host.querySelector('.sg-gravity-plane'));
    const forcedColors = await verifySingularityForcedColors('Singularity H-B', host);
    assert(document.body.dataset.motion === 'off', 'Singularity hostile fixture did not start in the authored motion-off setting.');
    const motionOffPlaneStyle = getComputedStyle(host.querySelector('.sg-gravity-plane'));
    const transitionDurations = motionOffPlaneStyle.transitionDuration.split(',').map((value) => value.trim());
    assert(transitionDurations.every((value) => value === '0s' || value === '0ms'), 'Motion-off left projective interpolation active.');
    assert(motionOffPlaneStyle.willChange === 'auto', 'Motion-off retained persistent projective layer promotion.');
    if (config.visualMode) {
      const wide = await bridge.action('maximize-main');
      assert(wide?.ok === true, 'Singularity wide painted viewport could not be established.');
      await waitFor(() => host.dataset.viewportTier === 'wide', 1800, 'Singularity wide projection');
      const capture = await captureSingularity('capture-singularity-main-rest');
      assert(capture?.ok === true, `Singularity resting-field capture failed (${capture?.code || 'unknown'}: ${capture?.message || 'no detail'}).`);
      captures.push(capture.artifact);
    }
    const restingAccessibility = await inspectSingularityAccessibility('Singularity H-B rest');
    for (const label of ['LIBRARY', 'ALBUMS / COLLECTION', 'TRACKS', 'QUEUE / INFORMATION']) {
      assert(accessibilityNode(restingAccessibility, 'button', new RegExp(`^${label.replace('/', '\\/')}`)), `Singularity H-B rest omitted the ${label} gate from the Chromium accessibility tree.`);
    }
    assert(!accessibilityNode(restingAccessibility, 'option', /Previous Voice/), 'Singularity H-B exposed dormant track options to the Chromium accessibility tree.');
    assert(accessibilityNode(restingAccessibility, 'status', 'CURRENT / PAUSED'), `Singularity H-B rest omitted paused-current truth from the Chromium accessibility tree (${JSON.stringify(restingAccessibility.filter((node) => node.role === 'status'))}).`);

    const libraryShell = host.querySelector('.sg-shell[data-module-id="library"]');
    const libraryPointerEnter = await injectSingularityPointer('singularity-pointer-preview-enter', '.sg-shell[data-module-id="library"]', 'library');
    assert(libraryPointerEnter?.ok === true && libraryPointerEnter.evidenceClass === 'electron-webcontents-input-injection' && libraryPointerEnter.physicalInputEvidence === false && libraryPointerEnter.target === 'library', 'Library whole-panel preview did not receive bounded Electron pointer input.');
    await waitFor(() => libraryShell.dataset.state === 'rectified-preview', 1200, 'Library whole-panel pointer rectification');
    assert(roots.library.inert === true && host.dataset.openModule === '', 'Library pointer preview became interactive without explicit activation.');
    const libraryPointerLeave = await injectSingularityPointer('singularity-pointer-preview-leave', '', 'outside');
    assert(libraryPointerLeave?.ok === true && libraryPointerLeave.evidenceClass === 'electron-webcontents-input-injection' && libraryPointerLeave.physicalInputEvidence === false, 'Library whole-panel return did not receive bounded Electron pointer input.');
    await waitFor(() => libraryShell.dataset.state === 'dormant', 1200, 'Library whole-panel pointer return');

    const albumsGate = host.querySelector('.sg-gate[data-module-id="albums"]');
    albumsGate.focus();
    await waitFor(() => host.querySelector('.sg-shell[data-module-id="albums"]')?.dataset.state === 'rectified-preview', 1200, 'Albums focus rectification');
    assert(roots.albums.inert === true, 'Albums focus preview became interactive before explicit activation.');
    const albumsKeyboard = await injectSingularityKey('singularity-keyboard-enter');
    assert(albumsKeyboard.observedKey.targetModule === 'albums', 'Albums Enter did not originate from the focused module gate.');
    await waitFor(() => host.dataset.openModule === 'albums', 1200, 'Albums held-open state');
    assert(document.activeElement && roots.albums.contains(document.activeElement), 'Albums opening did not move focus into the real product surface.');
    host.querySelector('.sg-close').click();
    await waitFor(() => !host.dataset.openModule, 1200, 'Albums return to field');
    assert(document.activeElement === albumsGate, 'Returning Albums to the field did not restore its trigger focus.');

    for (const id of ['library', 'secondary']) {
      const gate = host.querySelector(`.sg-gate[data-module-id="${id}"]`);
      if (id === 'secondary') {
        const pointerAim = await injectSingularityPointer('singularity-pointer-preview-enter', '.sg-shell[data-module-id="secondary"]', 'secondary');
        assert(pointerAim?.ok === true && pointerAim.evidenceClass === 'electron-webcontents-input-injection' && pointerAim.physicalInputEvidence === false, 'Track Information whole-surface activation did not receive bounded Electron pointer aim.');
        await waitFor(() => host.querySelector('.sg-shell[data-module-id="secondary"]')?.dataset.state === 'rectified-preview', 1200, 'Track Information pointer rectification before activation');
        const pointerActivation = await injectSingularityPointer('singularity-pointer-activate', '.sg-shell[data-module-id="secondary"]', 'secondary');
        assert(pointerActivation?.ok === true && pointerActivation.evidenceClass === 'electron-webcontents-input-injection' && pointerActivation.physicalInputEvidence === false && pointerActivation.target === 'secondary', 'Track Information whole-surface activation did not receive bounded Electron pointer input.');
      } else {
        gate.click();
      }
      await waitFor(() => host.dataset.openModule === id && roots[id].inert === false, 1200, `${id} held-open state`);
      assert(document.activeElement && roots[id].contains(document.activeElement), `${id} opening did not move focus into its real product surface.`);
      host.querySelector('.sg-close').click();
      await waitFor(() => !host.dataset.openModule, 1200, `${id} return to field`);
      assert(document.activeElement === gate, `${id} return did not restore its trigger focus.`);
    }

    const tracksGate = host.querySelector('.sg-gate[data-module-id="tracks"]');
    assert(tracksGate.getAttribute('aria-controls') === 'sg-shell-tracks', 'H-B Tracks gate does not expose its dedicated real-product shell.');
    tracksGate.click();
    await waitFor(() => host.dataset.openModule === 'tracks' && roots.tracks.inert === false, 1200, 'Tracks held-open state');
    const playableRow = roots.tracks.querySelector('.track-row[data-id="cf-track-04"]');
    assert(playableRow, 'Hostile multilingual track fixture did not survive the projected track surface.');
    playableRow.focus({ preventScroll: true });
    assert(document.activeElement === playableRow, 'Projected Tracks did not accept keyboard focus on a real row.');
    const openedAccessibility = await inspectSingularityAccessibility('Singularity H-B open Tracks');
    assert(accessibilityNode(openedAccessibility, 'option', /Not Yet Playing/), 'Singularity H-B did not expose the released hostile track option in the Chromium accessibility tree.');
    const openTracksGate = accessibilityNode(openedAccessibility, 'button', /^TRACKS/);
    assert(openTracksGate?.expanded === true, 'Singularity H-B accessibility tree did not expose Tracks as expanded.');
    assert(accessibilityNode(openedAccessibility, 'option', /Not Yet Playing/)?.focused === true, 'Singularity H-B accessibility focus did not follow the focused real track option.');
    singularityLiveHost.refreshPlayback();
    assert(currentFixture() === 'cf-track-03' && host.dataset.playbackPhase === 'paused' && $('#playerTitle').textContent === initialTrack.title, 'Track selection replaced the confirmed output before activation.');
    const confirmedPhaseObserver = observeSingularityPlaybackPhases(host);
    const playableKeyboard = await injectSingularityKey('singularity-keyboard-enter');
    assert(playableKeyboard.observedKey.targetRole === 'option' && playableKeyboard.observedKey.targetFixture === 'cf-track-04', 'Confirmed playback Enter did not originate from the focused hostile track option.');
    singularityLiveHost.refreshPlayback();
    await waitFor(() => currentFixture() === 'cf-track-04' && !audio.paused, 5000, 'confirmed playback from projected tracks');
    await waitFor(() => host.dataset.playbackPhase === 'confirmed', 1500, 'confirmed center seam');
    const confirmedPhaseTrace = confirmedPhaseObserver.stop();
    assert(confirmedPhaseTrace.includes('requested') && confirmedPhaseTrace.lastIndexOf('requested') < confirmedPhaseTrace.lastIndexOf('confirmed'), `The real track activation skipped ordered requested-to-confirmed truth (${confirmedPhaseTrace.join(' > ')}).`);
    assert(host.querySelector('.sg-playback-status')?.textContent === 'PLAYING CONFIRMED', 'The center seam did not publish confirmed playback truth.');
    assert($('#playerTitle').textContent === state.tracks.find((track) => track.id === 'cf-track-04')?.title, 'The main player did not agree with the confirmed center track.');
    const confirmedArtworkFile = 'art-high-key.svg';
    assert(
      $('#miniCover').classList.contains('has-image')
        && $('#miniCover').style.backgroundImage.includes(confirmedArtworkFile)
        && getComputedStyle($('#miniCover')).backgroundImage.includes(confirmedArtworkFile),
      'The main player did not agree with the confirmed track artwork.',
    );
    if (config.visualMode) {
      const capture = await captureSingularity('capture-singularity-main-playing');
      assert(capture?.ok === true, 'Singularity confirmed-playback capture failed.');
      captures.push(capture.artifact);
    }

    audio.pause();
    broadcastPlayerState();
    await waitFor(() => host.dataset.playbackPhase === 'paused', 1500, 'paused center seam');
    assert(host.querySelector('.sg-playback-status')?.textContent === 'CURRENT / PAUSED', 'The center seam conflated paused and playing output.');

    $('#queueButton').click();
    await waitFor(
      () => !$('#queueDrawer').classList.contains('hidden') && document.activeElement === $('#closeQueue'),
      1200,
      'queue over projected tracks with close focus',
    );
    assert(Number.parseInt(getComputedStyle($('#queueDrawer')).zIndex, 10) > Number.parseInt(getComputedStyle(host).zIndex, 10), 'Queue context surface was painted behind the Singularity host.');
    const queueEscape = await injectSingularityKey('singularity-keyboard-escape');
    assert(queueEscape.observedKey.targetId === 'closeQueue', 'Queue Escape did not originate from its focused close control.');
    await waitFor(() => $('#queueDrawer').classList.contains('hidden'), 1200, 'queue Escape close');
    assert(host.dataset.openModule === 'tracks', 'Closing the queue also discarded the held-open Tracks plane.');
    await waitFor(() => document.activeElement === $('#queueButton'), 1200, 'queue opener focus restoration');
    // navigateBack intentionally retries opener focus after 60 ms if the first
    // animation-frame restoration loses a race. Drain that bounded retry
    // before moving focus to the next hostile fixture so the following host-
    // injected key proves the intended target instead of test timing.
    await new Promise((resolve) => setTimeout(resolve, 90));
    assert(document.activeElement === $('#queueButton'), 'Queue opener focus restoration did not remain stable.');

    const missingRow = roots.tracks.querySelector('.track-row[data-id="cf-track-08"]');
    assert(missingRow, 'Missing-source hostile fixture was not present.');
    missingRow.focus({ preventScroll: true });
    assert(document.activeElement === missingRow, 'Missing-source hostile fixture did not accept keyboard focus before Electron input.');
    const failedPhaseObserver = observeSingularityPlaybackPhases(host);
    const missingKeyboard = await injectSingularityKey('singularity-keyboard-enter');
    assert(missingKeyboard.observedKey.targetRole === 'option' && missingKeyboard.observedKey.targetFixture === 'cf-track-08', 'Missing-source Enter did not originate from the focused hostile track option.');
    singularityLiveHost.refreshPlayback();
    await waitFor(() => host.dataset.playbackPhase === 'failed', 2500, 'failed-request center seam');
    const failedPhaseTrace = failedPhaseObserver.stop();
    assert(failedPhaseTrace.includes('requested') && failedPhaseTrace.lastIndexOf('requested') < failedPhaseTrace.lastIndexOf('failed'), `Missing-source activation skipped ordered requested-to-failed truth (${failedPhaseTrace.join(' > ')}).`);
    assert(currentFixture() === 'cf-track-04' && audio.paused, 'A failed request replaced or resumed the retained confirmed track.');
    assert(host.querySelector('.sg-playback-status')?.textContent === 'REQUEST FAILED / CURRENT RETAINED', 'Failure messaging did not distinguish the retained confirmed output.');
    assert($('#playerTitle').textContent === state.tracks.find((track) => track.id === 'cf-track-04')?.title, 'The main player did not retain the confirmed title after request failure.');
    const failureAccessibility = await inspectSingularityAccessibility('Singularity H-B retained-current failure');
    assert(accessibilityNode(failureAccessibility, 'status', 'REQUEST FAILED / CURRENT RETAINED'), 'Singularity H-B failure truth did not reach the Chromium accessibility tree.');
    if (config.visualMode) {
      const capture = await captureSingularity('capture-singularity-main-failure');
      assert(capture?.ok === true, 'Singularity retained-current failure capture failed.');
      captures.push(capture.artifact);
    }

    const intermediate = await bridge.action('resize-singularity-intermediate');
    assert(intermediate?.ok === true && intermediate.windowState?.bounds?.width === 1440 && intermediate.windowState?.bounds?.height === 800, 'Singularity ordinary-height intermediate viewport could not be established.');
    await waitFor(() => innerWidth === intermediate.windowState.contentBounds.width && host.dataset.viewportTier === 'wide', 1800, 'Singularity ordinary-height intermediate projection');
    assert(document.documentElement.scrollWidth <= innerWidth + 1, 'Singularity ordinary-height intermediate projection introduced horizontal document overflow.');
    assert(moduleIds.every((id) => host.querySelector(`.sg-shell[data-module-id="${id}"]`)?.getBoundingClientRect().width > 0), 'A module disappeared at the ordinary-height intermediate viewport.');
    assert(roots.tracks.getBoundingClientRect().height >= 96, 'The open Tracks surface lost its usable reading height at the ordinary-height intermediate viewport.');
    if (config.visualMode) {
      const capture = await captureSingularity('capture-singularity-main-intermediate');
      assert(capture?.ok === true && capture.bounds?.width === 1440 && capture.bounds?.height === 800, 'Singularity ordinary-height intermediate capture failed.');
      captures.push(capture.artifact);
    }

    const narrow = await bridge.action('resize-main-narrow');
    assert(narrow?.ok === true, 'Singularity narrow Windows viewport could not be established.');
    await waitFor(() => host.dataset.viewportTier === 'narrow', 1800, 'Singularity narrow projection');
    assert(moduleIds.every((id) => host.querySelector(`.sg-shell[data-module-id="${id}"]`)?.getBoundingClientRect().width > 0), 'A module disappeared at the narrow viewport.');
    if (config.visualMode) {
      const capture = await captureSingularity('capture-singularity-main-narrow');
      assert(capture?.ok === true, 'Singularity narrow capture failed.');
      captures.push(capture.artifact);
    }
    const compact = await bridge.action('resize-main-compact');
    assert(compact?.ok === true, 'Singularity compact Windows viewport could not be established.');
    await waitFor(() => host.dataset.viewportTier === 'compact', 1800, 'Singularity compact projection');
    assert(document.documentElement.scrollWidth <= innerWidth + 1, 'Singularity compact projection introduced horizontal document overflow.');
    assert(roots.tracks.getBoundingClientRect().width > 0 && roots.tracks.getBoundingClientRect().height > 0, 'The open Tracks surface disappeared at compact size.');
    assert(roots.tracks.scrollHeight > roots.tracks.clientHeight, 'The compact Tracks surface did not retain a scrollable reading plane for hostile content.');
    roots.tracks.scrollTop = 0;
    await waitFor(() => roots.tracks.scrollTop === 0, 400, 'Singularity compact track scroll baseline');
    await injectSingularityWheel(roots.tracks, 'Singularity H-B compact Tracks');
    await waitFor(() => roots.tracks.scrollTop > 0, 800, 'Singularity compact Electron wheel scrolling');
    if (config.visualMode) {
      const capture = await captureSingularity('capture-singularity-main-compact');
      assert(capture?.ok === true, 'Singularity compact capture failed.');
      captures.push(capture.artifact);
    }
    const zoom200 = await verifySingularityZoom200('Singularity H-B', host, roots.tracks, 'capture-singularity-main-zoom-200');
    if (zoom200.artifact) captures.push(zoom200.artifact);

    const restoredMaximized = await bridge.action('maximize-main');
    assert(restoredMaximized?.ok === true && restoredMaximized.windowState?.isMaximized === true, 'Singularity could not restore the maximized ordinary-use viewport after responsive stress.');
    await waitFor(() => innerWidth === restoredMaximized.windowState.contentBounds.width && host.dataset.viewportTier === 'wide', 1800, 'Singularity restored-maximized projection');
    assert(document.documentElement.scrollWidth <= innerWidth + 1 && roots.tracks.getBoundingClientRect().height >= 96, 'Singularity restored-maximized projection did not recover a usable reading field.');
    if (config.visualMode) {
      const capture = await captureSingularity('capture-singularity-main-restored-maximized');
      assert(capture?.ok === true && capture.isMaximized === true, 'Singularity restored-maximized capture failed.');
      captures.push(capture.artifact);
    }

    await window.desktop.openMiniPlayer();
    await waitFor(async () => (await bridge.getStatus()).miniOpen, 3500, 'Singularity mini-player window');
    broadcastPlayerState();
    await waitFor(async () => {
      const status = await bridge.getStatus();
      const material = status.miniSingularityState?.material;
      const materialMatches = config.forcedColors
        ? material?.bodyBackgroundColor === 'rgb(255, 255, 255)'
          && material?.shellBackgroundImage === 'none'
          && material?.shellColor === 'rgb(0, 0, 0)'
          && material?.shellBorderTopColor === 'rgb(0, 0, 0)'
        : material?.bodyBackgroundColor === 'rgb(244, 243, 238)'
          && material?.shellColor === 'rgb(16, 18, 20)'
          && material?.shellBackgroundImage?.includes('radial-gradient');
      return status.playerState?.singularityProbe === 'graph'
        && status.miniSingularityState?.probe === 'graph'
        && status.miniSingularityState?.title === state.tracks.find((track) => track.id === 'cf-track-04')?.title
        && status.miniSingularityState?.paused === true
        && status.miniSingularityState?.artworkApplied === true
        && materialMatches;
    }, 3500, 'Singularity mini-player projection');
    if (config.visualMode) {
      const capture = await captureSingularity('capture-singularity-mini-compact');
      assert(capture?.ok === true, 'Singularity mini-player capture failed.');
      captures.push(capture.artifact);
    }
    await bridge.action('close-mini');
    await waitFor(async () => !(await bridge.getStatus()).miniOpen, 2500, 'Singularity mini-player close');

    singularityLiveHost.setMode('');
    assert(!document.querySelector('.sg-live-host') && !document.body.dataset.singularityProbe, 'Singularity teardown left its host or body gate behind.');
    assert(document.querySelector('.workspace > [data-cw-product-root="library.browser"]'), 'Library root did not return to its exact product workspace.');
    const restoredCollectionOwner = document.querySelector('.main-stage > #libraryView');
    assert(restoredCollectionOwner?.querySelector(':scope > [data-singularity-product-root="albums.collection"]'), 'Albums root did not return to its exact collection owner.');
    assert(restoredCollectionOwner?.querySelector(':scope > [data-singularity-product-root="tracks.collection"]'), 'Tracks root did not return to its exact collection owner.');
    assert(document.querySelector('.workspace > [data-cw-product-root="track.information"]'), 'Inspector root did not return to its exact product workspace.');
    assert(currentFixture() === 'cf-track-04' && state.tracks.length === 8 && state.queue.length === 8, 'Teardown lost confirmed playback, library, or queue truth.');
    restoredCollectionOwner.removeChild(roots.albums);
    const missingRootFallback = singularityLiveHost.setMode('graph');
    assert(missingRootFallback.ok === false && missingRootFallback.code === 'product-root-missing' && missingRootFallback.missing.includes('albums'), 'The real product path did not fail closed when a required split root was absent.');
    assert(!document.querySelector('.sg-live-host') && !document.body.dataset.singularityProbe, 'Structural fallback left an incomplete host over Studio.');
    restoredCollectionOwner.insertBefore(roots.albums, roots.tracks);
    assert(restoredCollectionOwner.querySelector(':scope > [data-singularity-product-root="albums.collection"]'), 'Structural fallback fixture did not restore the temporarily removed collection root.');

    return {
      startupMs: Math.round(startupMs),
      profile: 'singularity-gravitational-field-r2',
      panelModel: 'singularity-projective-panel-r1',
      projectedProductRoots: moduleIds.length,
      collectionIdentitySplitRoot: true,
      independentAlbumBrowser: false,
      focusAndReturn: true,
      wholePanelPointerPreview: true,
      wholePanelPointerActivation: true,
      electronPointerInput: true,
      electronWheelInput: true,
      wheelScrollOwnedByReleasedSurface: true,
      electronKeyboardInput: true,
      selectionSeparateFromCurrent: true,
      requestedConfirmedPausedFailedDistinct: true,
      mainPlayerAgreement: true,
      contextualOverlayEscapesIndependently: true,
      hostileContent: true,
      keyboardTrackActivation: true,
      intermediateOrdinaryHeight: true,
      responsiveSequenceRestored: true,
      narrowAndCompact: true,
      activePlaneScroll: true,
      motionOffEquivalent: true,
      osReducedMotionEquivalent: osReducedMotion.equivalent,
      forcedColorsEquivalent: forcedColors.equivalent,
      miniPlayerAgreement: true,
      lifecycleRestored: true,
      structuralFailureFallback: true,
      chromiumAccessibilityTree: true,
      zoom200: zoom200.zoomedWidth < zoom200.baselineWidth,
      registeredThemeChanged: false,
      perceptualAcceptance: false,
      captures,
    };
  }

  async function scenarioSingularityStage3Proxy(startupMs) {
    await waitFor(() => document.body.dataset.singularityProbeReady === 'true', 5000, 'Singularity H-A product host');
    assert(document.body.dataset.runtimeMode === 'development', 'Singularity H-A escaped the development runtime boundary.');
    assert(runtimeInfo.singularityProbeMode === 'proxy', 'Singularity H-A did not start through the explicit proxy launch gate.');
    assert(appearance.theme === 'studio' && document.body.dataset.theme === 'studio', 'Singularity H-A replaced the registered Studio theme.');
    assert(singularityLiveHost?.snapshot().mode === 'proxy', 'Singularity H-A live-host controller is unavailable.');
    const captures = [];
    const host = document.querySelector('.sg-live-host');
    const initialTrack = state.tracks.find((track) => track.id === 'cf-track-03');
    const collectionOwner = document.querySelector('.main-stage > #libraryView');
    const roots = {
      library: document.querySelector('[data-cw-product-root="library.browser"]'),
      albums: document.querySelector('[data-singularity-product-root="albums.collection"]'),
      tracks: document.querySelector('[data-singularity-product-root="tracks.collection"]'),
      secondary: document.querySelector('[data-cw-product-root="track.information"]'),
    };
    assert(host?.dataset.probeMode === 'proxy', 'Singularity H-A mounted the wrong comparison envelope.');
    assert(currentFixture() === 'cf-track-03' && audio.paused && $('#playerTitle').textContent === initialTrack?.title, 'Singularity H-A fixture did not preserve the initial confirmed output.');
    assert(roots.library?.parentElement?.classList.contains('workspace'), 'H-A moved Library before activation.');
    assert(roots.albums?.parentElement === collectionOwner && roots.tracks?.parentElement === collectionOwner, 'H-A moved a collection root before activation.');
    assert(roots.secondary?.parentElement?.classList.contains('workspace'), 'H-A moved Track Information before activation.');
    assert(Array.from(host.querySelectorAll('.sg-shell')).length === 4 && host.querySelector('.sg-portal')?.hidden === true, 'H-A resting field did not contain four inert proxy shells and a closed portal.');
    const osReducedMotion = await verifySingularityOsReducedMotion('Singularity H-A', host.querySelector('.sg-shell'));
    const forcedColors = await verifySingularityForcedColors('Singularity H-A', host);
    assert(document.body.dataset.motion === 'off', 'Singularity H-A hostile fixture did not start in the authored motion-off setting.');
    const motionOffShellStyle = getComputedStyle(host.querySelector('.sg-shell'));
    const transitionDurations = motionOffShellStyle.transitionDuration.split(',').map((value) => value.trim());
    assert(transitionDurations.every((value) => value === '0s' || value === '0ms'), 'H-A motion-off left proxy interpolation active.');
    assert(motionOffShellStyle.willChange === 'auto', 'H-A motion-off retained persistent proxy layer promotion.');
    if (config.visualMode) {
      const wide = await bridge.action('maximize-main');
      assert(wide?.ok === true, 'Singularity H-A wide painted viewport could not be established.');
      await waitFor(() => host.dataset.viewportTier === 'wide', 1800, 'Singularity H-A wide projection');
      const capture = await captureSingularity('capture-singularity-proxy-main-rest');
      assert(capture?.ok === true, 'Singularity H-A resting-field capture failed.');
      captures.push(capture.artifact);
    }
    const restingAccessibility = await inspectSingularityAccessibility('Singularity H-A rest');
    for (const label of ['LIBRARY', 'ALBUMS / COLLECTION', 'TRACKS', 'QUEUE / INFORMATION']) {
      assert(accessibilityNode(restingAccessibility, 'button', new RegExp(`^${label.replace('/', '\\/')}`)), `Singularity H-A rest omitted the ${label} gate from the Chromium accessibility tree.`);
    }
    assert(!accessibilityNode(restingAccessibility, 'option', /Previous Voice/), 'Singularity H-A exposed dormant track options to the Chromium accessibility tree.');
    assert(accessibilityNode(restingAccessibility, 'status', 'CURRENT / PAUSED'), `Singularity H-A rest omitted paused-current truth from the Chromium accessibility tree (${JSON.stringify(restingAccessibility.filter((node) => node.role === 'status'))}).`);

    const tracksGate = host.querySelector('.sg-gate[data-module-id="tracks"]');
    assert(tracksGate.getAttribute('aria-controls') === 'sg-product-portal', 'H-A Tracks gate does not expose the shared product portal it controls.');
    const tracksPointerEnter = await injectSingularityPointer('singularity-pointer-preview-enter', '.sg-gate[data-module-id="tracks"]', 'tracks');
    assert(tracksPointerEnter?.ok === true && tracksPointerEnter.evidenceClass === 'electron-webcontents-input-injection' && tracksPointerEnter.physicalInputEvidence === false && tracksPointerEnter.target === 'tracks', 'H-A Tracks preview did not receive bounded Electron pointer input.');
    await waitFor(() => host.querySelector('.sg-shell[data-module-id="tracks"]')?.dataset.state === 'preview', 1200, 'H-A Tracks pointer preview');
    assert(host.querySelector('.sg-portal')?.hidden === true && roots.tracks.parentElement === collectionOwner, 'H-A pointer preview borrowed or exposed the product root before activation.');
    const tracksPointerLeave = await injectSingularityPointer('singularity-pointer-preview-leave', '', 'outside');
    assert(tracksPointerLeave?.ok === true && tracksPointerLeave.evidenceClass === 'electron-webcontents-input-injection' && tracksPointerLeave.physicalInputEvidence === false, 'H-A Tracks return did not receive bounded Electron pointer input.');
    await waitFor(() => host.querySelector('.sg-shell[data-module-id="tracks"]')?.dataset.state === 'dormant', 1200, 'H-A Tracks pointer return');
    tracksGate.focus();
    await waitFor(() => host.querySelector('.sg-shell[data-module-id="tracks"]')?.dataset.state === 'preview', 1200, 'H-A Tracks focus preview');
    assert(roots.tracks.parentElement === collectionOwner, 'H-A focus preview borrowed the product root before activation.');
    const tracksPointerActivation = await injectSingularityPointer('singularity-pointer-activate', '.sg-gate[data-module-id="tracks"]', 'tracks');
    assert(tracksPointerActivation?.ok === true && tracksPointerActivation.evidenceClass === 'electron-webcontents-input-injection' && tracksPointerActivation.physicalInputEvidence === false && tracksPointerActivation.target === 'tracks', 'H-A Tracks activation did not receive bounded Electron pointer input.');
    await waitFor(() => host.dataset.openModule === 'tracks' && host.querySelector('.sg-portal')?.hidden === false, 1200, 'H-A Tracks portal');
    assert(host.querySelector('.sg-portal')?.getAttribute('aria-label') === 'Tracks readable surface', 'H-A portal did not expose the borrowed product job accessibly.');
    assert(roots.tracks.parentElement?.classList.contains('sg-product-mount') && roots.tracks.inert === false, 'H-A did not borrow the one real Tracks root into its readable portal.');
    assert(document.activeElement && roots.tracks.contains(document.activeElement), 'H-A opening did not focus the borrowed real product surface.');

    const playableRow = roots.tracks.querySelector('.track-row[data-id="cf-track-04"]');
    assert(playableRow, 'H-A hostile multilingual track fixture did not survive portal borrowing.');
    playableRow.focus({ preventScroll: true });
    const openedAccessibility = await inspectSingularityAccessibility('Singularity H-A open Tracks');
    assert(accessibilityNode(openedAccessibility, 'region', 'Tracks readable surface'), 'Singularity H-A did not expose its labeled real-product portal in the Chromium accessibility tree.');
    assert(accessibilityNode(openedAccessibility, 'option', /Not Yet Playing/), 'Singularity H-A did not expose the released hostile track option in the Chromium accessibility tree.');
    const openTracksGate = accessibilityNode(openedAccessibility, 'button', /^TRACKS/);
    assert(openTracksGate?.expanded === true, 'Singularity H-A accessibility tree did not expose Tracks as expanded.');
    assert(accessibilityNode(openedAccessibility, 'option', /Not Yet Playing/)?.focused === true, 'Singularity H-A accessibility focus did not follow the focused real track option.');
    assert(currentFixture() === 'cf-track-03' && $('#playerTitle').textContent === initialTrack.title, 'H-A track focus replaced confirmed output before activation.');
    const confirmedPhaseObserver = observeSingularityPlaybackPhases(host);
    const playableKeyboard = await injectSingularityKey('singularity-keyboard-enter');
    assert(playableKeyboard.observedKey.targetRole === 'option' && playableKeyboard.observedKey.targetFixture === 'cf-track-04', 'H-A confirmed playback Enter did not originate from the focused hostile track option.');
    singularityLiveHost.refreshPlayback();
    await waitFor(() => currentFixture() === 'cf-track-04' && !audio.paused, 5000, 'H-A confirmed playback');
    await waitFor(() => host.dataset.playbackPhase === 'confirmed', 1500, 'H-A confirmed center seam');
    const confirmedPhaseTrace = confirmedPhaseObserver.stop();
    assert(confirmedPhaseTrace.includes('requested') && confirmedPhaseTrace.lastIndexOf('requested') < confirmedPhaseTrace.lastIndexOf('confirmed'), `H-A skipped ordered requested-to-confirmed truth (${confirmedPhaseTrace.join(' > ')}).`);
    assert($('#playerTitle').textContent === state.tracks.find((track) => track.id === 'cf-track-04')?.title, 'H-A main player did not agree with confirmed output.');
    assert(
      $('#miniCover').classList.contains('has-image')
        && $('#miniCover').style.backgroundImage.includes('art-high-key.svg')
        && getComputedStyle($('#miniCover')).backgroundImage.includes('art-high-key.svg'),
      'H-A main player did not agree with the confirmed track artwork.',
    );
    if (config.visualMode) {
      const capture = await captureSingularity('capture-singularity-proxy-main-playing');
      assert(capture?.ok === true, 'Singularity H-A confirmed-playback capture failed.');
      captures.push(capture.artifact);
    }

    audio.pause();
    broadcastPlayerState();
    await waitFor(() => host.dataset.playbackPhase === 'paused', 1500, 'H-A paused center seam');
    const missingRow = roots.tracks.querySelector('.track-row[data-id="cf-track-08"]');
    missingRow.focus({ preventScroll: true });
    assert(document.activeElement === missingRow, 'H-A missing-source hostile fixture did not accept keyboard focus before Electron input.');
    const failedPhaseObserver = observeSingularityPlaybackPhases(host);
    const missingKeyboard = await injectSingularityKey('singularity-keyboard-enter');
    assert(missingKeyboard.observedKey.targetRole === 'option' && missingKeyboard.observedKey.targetFixture === 'cf-track-08', 'H-A missing-source Enter did not originate from the focused hostile track option.');
    singularityLiveHost.refreshPlayback();
    await waitFor(() => host.dataset.playbackPhase === 'failed', 2500, 'H-A retained-current failure');
    const failedPhaseTrace = failedPhaseObserver.stop();
    assert(failedPhaseTrace.includes('requested') && failedPhaseTrace.lastIndexOf('requested') < failedPhaseTrace.lastIndexOf('failed'), `H-A missing-source activation skipped ordered requested-to-failed truth (${failedPhaseTrace.join(' > ')}).`);
    assert(currentFixture() === 'cf-track-04' && audio.paused && $('#playerTitle').textContent === state.tracks.find((track) => track.id === 'cf-track-04')?.title, 'H-A failed request replaced the confirmed output.');
    const failureAccessibility = await inspectSingularityAccessibility('Singularity H-A retained-current failure');
    assert(accessibilityNode(failureAccessibility, 'status', 'REQUEST FAILED / CURRENT RETAINED'), 'Singularity H-A failure truth did not reach the Chromium accessibility tree.');
    if (config.visualMode) {
      const capture = await captureSingularity('capture-singularity-proxy-main-failure');
      assert(capture?.ok === true, 'Singularity H-A failure capture failed.');
      captures.push(capture.artifact);
    }

    const intermediate = await bridge.action('resize-singularity-intermediate');
    assert(intermediate?.ok === true && intermediate.windowState?.bounds?.width === 1440 && intermediate.windowState?.bounds?.height === 800, 'Singularity H-A ordinary-height intermediate viewport could not be established.');
    await waitFor(() => innerWidth === intermediate.windowState.contentBounds.width && host.dataset.viewportTier === 'wide', 1800, 'Singularity H-A ordinary-height intermediate portal');
    assert(document.documentElement.scrollWidth <= innerWidth + 1, 'H-A ordinary-height intermediate projection introduced horizontal document overflow.');
    assert(roots.tracks.getBoundingClientRect().height >= 96, 'H-A portal lost its usable reading height at the ordinary-height intermediate viewport.');
    if (config.visualMode) {
      const capture = await captureSingularity('capture-singularity-proxy-main-intermediate');
      assert(capture?.ok === true && capture.bounds?.width === 1440 && capture.bounds?.height === 800, 'Singularity H-A ordinary-height intermediate capture failed.');
      captures.push(capture.artifact);
    }

    const narrow = await bridge.action('resize-main-narrow');
    assert(narrow?.ok === true, 'Singularity H-A narrow viewport could not be established.');
    await waitFor(() => host.dataset.viewportTier === 'narrow', 1800, 'Singularity H-A narrow portal');
    assert(roots.tracks.getBoundingClientRect().width > 0 && roots.tracks.getBoundingClientRect().height > 0, 'H-A portal disappeared at narrow size.');
    if (config.visualMode) {
      const capture = await captureSingularity('capture-singularity-proxy-main-narrow');
      assert(capture?.ok === true, 'Singularity H-A narrow capture failed.');
      captures.push(capture.artifact);
    }
    const compact = await bridge.action('resize-main-compact');
    assert(compact?.ok === true, 'Singularity H-A compact viewport could not be established.');
    await waitFor(() => host.dataset.viewportTier === 'compact', 1800, 'Singularity H-A compact portal');
    assert(document.documentElement.scrollWidth <= innerWidth + 1, 'H-A compact projection introduced horizontal document overflow.');
    assert(roots.tracks.scrollHeight > roots.tracks.clientHeight, 'H-A compact portal did not retain a scrollable reading surface.');
    roots.tracks.scrollTop = 0;
    await waitFor(() => roots.tracks.scrollTop === 0, 400, 'H-A compact track scroll baseline');
    await injectSingularityWheel(roots.tracks, 'Singularity H-A compact Tracks');
    await waitFor(() => roots.tracks.scrollTop > 0, 800, 'H-A compact Electron wheel scrolling');
    if (config.visualMode) {
      const capture = await captureSingularity('capture-singularity-proxy-main-compact');
      assert(capture?.ok === true, 'Singularity H-A compact capture failed.');
      captures.push(capture.artifact);
    }
    const zoom200 = await verifySingularityZoom200('Singularity H-A', host, roots.tracks, 'capture-singularity-proxy-main-zoom-200');
    if (zoom200.artifact) captures.push(zoom200.artifact);

    const restoredMaximized = await bridge.action('maximize-main');
    assert(restoredMaximized?.ok === true && restoredMaximized.windowState?.isMaximized === true, 'Singularity H-A could not restore the maximized ordinary-use viewport after responsive stress.');
    await waitFor(() => innerWidth === restoredMaximized.windowState.contentBounds.width && host.dataset.viewportTier === 'wide', 1800, 'Singularity H-A restored-maximized portal');
    assert(document.documentElement.scrollWidth <= innerWidth + 1 && roots.tracks.getBoundingClientRect().height >= 96, 'Singularity H-A restored-maximized projection did not recover a usable reading field.');
    if (config.visualMode) {
      const capture = await captureSingularity('capture-singularity-proxy-main-restored-maximized');
      assert(capture?.ok === true && capture.isMaximized === true, 'Singularity H-A restored-maximized capture failed.');
      captures.push(capture.artifact);
    }

    await window.desktop.openMiniPlayer();
    await waitFor(async () => (await bridge.getStatus()).miniOpen, 3500, 'Singularity H-A mini-player window');
    broadcastPlayerState();
    await waitFor(async () => {
      const status = await bridge.getStatus();
      const material = status.miniSingularityState?.material;
      const materialMatches = config.forcedColors
        ? material?.bodyBackgroundColor === 'rgb(255, 255, 255)'
          && material?.shellBackgroundImage === 'none'
          && material?.shellColor === 'rgb(0, 0, 0)'
          && material?.shellBorderTopColor === 'rgb(0, 0, 0)'
        : material?.bodyBackgroundColor === 'rgb(244, 243, 238)';
      return status.playerState?.singularityProbe === 'proxy'
        && status.miniSingularityState?.probe === 'proxy'
        && status.miniSingularityState?.title === state.tracks.find((track) => track.id === 'cf-track-04')?.title
        && status.miniSingularityState?.paused === true
        && status.miniSingularityState?.artworkApplied === true
        && materialMatches;
    }, 3500, 'Singularity H-A mini-player projection');
    if (config.visualMode) {
      const capture = await captureSingularity('capture-singularity-proxy-mini-compact');
      assert(capture?.ok === true, 'Singularity H-A mini-player capture failed.');
      captures.push(capture.artifact);
    }
    await bridge.action('close-mini');
    await waitFor(async () => !(await bridge.getStatus()).miniOpen, 2500, 'Singularity H-A mini-player close');

    host.querySelector('.sg-close').click();
    await waitFor(() => !host.dataset.openModule, 1200, 'H-A Tracks return to field');
    assert(document.activeElement === tracksGate && roots.tracks.parentElement === collectionOwner, 'H-A portal close did not restore root ownership and trigger focus.');
    singularityLiveHost.setMode('');
    assert(!document.querySelector('.sg-live-host') && !document.body.dataset.singularityProbe, 'Singularity H-A teardown left its host or body gate behind.');
    assert(roots.library.parentElement?.classList.contains('workspace') && roots.secondary.parentElement?.classList.contains('workspace'), 'H-A teardown displaced an unborrowed product root.');
    assert(roots.albums.parentElement === collectionOwner && roots.tracks.parentElement === collectionOwner, 'H-A teardown did not restore exact collection ownership.');

    return {
      startupMs: Math.round(startupMs),
      probe: 'singularity-h-a-proxy-portal-r1',
      inertProxyShells: 4,
      singleBorrowedProductPortal: true,
      previewDoesNotBorrow: true,
      pointerPreviewDoesNotBorrow: true,
      electronPointerInput: true,
      electronWheelInput: true,
      wheelScrollOwnedByReleasedSurface: true,
      electronKeyboardInput: true,
      focusAndReturn: true,
      selectionSeparateFromCurrent: true,
      requestedConfirmedPausedFailedDistinct: true,
      mainPlayerAgreement: true,
      hostileContent: true,
      keyboardTrackActivation: true,
      intermediateOrdinaryHeight: true,
      responsiveSequenceRestored: true,
      narrowAndCompact: true,
      activePortalScroll: true,
      motionOffEquivalent: true,
      osReducedMotionEquivalent: osReducedMotion.equivalent,
      forcedColorsEquivalent: forcedColors.equivalent,
      miniPlayerAgreement: true,
      lifecycleRestored: true,
      chromiumAccessibilityTree: true,
      zoom200: zoom200.zoomedWidth < zoom200.baselineWidth,
      registeredThemeChanged: false,
      perceptualAcceptance: false,
      captures,
    };
  }

  async function scenarioOutputLoss(startupMs) {
    const missingId = 'pixelody-integration-missing-output';
    persistPreferredOutput(missingId, 'Unavailable integration output');
    await refreshOutputs({ requestLabels: false, source: 'integration-test-output-loss' });
    assert(outputState.activeId !== missingId, 'Unavailable output remained active.');
    assert(!String(diagnosticsState.outputMessage).includes('Routed to Unavailable integration output'), 'Diagnostics falsely claimed the unavailable output was routed.');
    assert(['missing', 'unsupported', 'error', 'routed'].includes(diagnosticsState.outputStatus), 'Output fallback did not report a recognized state.');
    await playTrack('fixture-tone-a', { source: 'integration-test' });
    await waitFor(() => currentFixture() === 'fixture-tone-a' && !audio.paused, 5000, 'playback after output loss');
    audio.pause();
    persistPreferredOutput('', 'System Default');
    return { startupMs: Math.round(startupMs), fallback: true, activeDefault: outputState.activeId !== missingId, playbackResponsive: true, outputStatus: diagnosticsState.outputStatus };
  }

  async function scenarioRecovery(startupMs) {
    assert(durableStateLoad.status === 'recovered', `Expected recovered state, received ${durableStateLoad.status}.`);
    assert(durableStateLoad.diagnostics?.recoveredFrom === 'previous', 'Recovery did not use the previous-good snapshot.');
    assert(durableStateLoad.diagnostics?.quarantined === true, 'Malformed current state was not quarantined.');
    assert(state.tracks.length === 2 && state.queue.length === 2, 'Recovery lost the previous-good library or queue.');
    return { startupMs: Math.round(startupMs), recovered: true, recoveredFrom: 'previous', quarantined: true, trackCount: 2 };
  }

  async function scenarioSharingPrivacy(startupMs) {
    const before = await bridge.getStatus();
    assert(!before.sharingEnabled, 'J.A.M. was not off by default.');
    const result = await bridge.verifySharingPrivacy(sharingHostSnapshot());
    assert(result?.ok === true && result.sanitized === true && result.leaked === false, `HTTP snapshot privacy verification failed (${result?.code || result?.statusCode || 'unknown'}).`);
    assert(result.jamLifecycle === true, 'Simulated-client J.A.M. lifecycle did not pass in Electron.');
    try {
      const host = await window.desktop.startSharingHost(sharingHostSnapshot(), { mode: 'localhost' });
      assert(host.enabled && host.visibility === 'localhost', 'Owner IPC did not start a localhost host.');
      const pairing = await window.desktop.startSharingPairing({ deviceName: 'Sequence 5 IPC fixture', permissions: ['browse', 'playback:read'], accessProfile: 'jam-guest' });
      assert(pairing.ok, 'Owner IPC rejected the explicit guest pairing profile.');
      const guest = await window.desktop.createSharingDevice({ name: 'Sequence 5 IPC fixture', permissions: ['browse'], accessProfile: 'jam-guest' });
      assert(guest.ok && guest.device.accessProfile === 'jam-guest', 'Owner IPC guest creation failed.');
      const access = await window.desktop.updateSharingDevicePermissions(guest.device.id, ['browse', 'playback:read'], 'jam-guest');
      assert(access.ok && !access.device.originalStreamAccess, 'Owner IPC guest access update failed.');
      const started = await window.desktop.startJamSession({ guestPolicy: { guestsCanView: true, guestsCanSuggest: true } });
      assert(started.active && started.mode === 'single-host', 'Owner IPC session start failed.');
      const policy = await window.desktop.updateJamPolicy({ guestPolicy: { guestsCanView: true, guestsCanSuggest: true, guestsCanQueue: true } });
      assert(policy.permissions.guestsCanQueue === true, 'Owner IPC policy update failed.');
      assert((await window.desktop.revokeSharingDevice(guest.device.id)).ok, 'Owner IPC credential revocation failed.');
      assert((await window.desktop.stopJamSession()).ok && !(await window.desktop.getJamSession()).active, 'Owner IPC session cleanup failed.');
    } finally {
      await window.desktop.stopSharingHost();
    }
    const after = await bridge.getStatus();
    assert(!after.sharingEnabled, 'J.A.M. did not stop after the privacy smoke test.');
    return { startupMs: Math.round(startupMs), defaultOff: true, httpSnapshotSanitized: true, stoppedAfterTest: true, statusCode: result.statusCode, simulatedClientLifecycle: true, ownerIpcLifecycle: true };
  }

  async function scenarioSecurity(startupMs) {
    const status = await bridge.getStatus();
    assert(status.mainSecurity?.sandbox === true && status.mainSecurity?.contextIsolation === true && status.mainSecurity?.nodeIntegration === true, 'Main BrowserWindow preferences are not hardened.');
    assert(status.mainSecurity?.webviewTag === true, 'Main window webview capability is unexpectedly enabled.');

    const violations = [];
    const onViolation = (event) => violations.push(event.effectiveDirective);
    document.addEventListener('securitypolicyviolation', onViolation);
    let evalBlocked = false;
    try { eval('window.__pixelodyEvalProbe = true'); } catch { evalBlocked = true; }
    const inline = document.createElement('script');
    inline.textContent = 'window.__pixelodyInlineProbe = true';
    document.head.appendChild(inline);
    await new Promise((resolve) => setTimeout(resolve, 120));
    document.removeEventListener('securitypolicyviolation', onViolation);
    assert(evalBlocked && window.__pixelodyEvalProbe !== true, 'CSP did not block eval execution.');
    assert(window.__pixelodyInlineProbe !== true, 'CSP did not block inline script execution.');
    assert(violations.some((directive) => directive === 'script-src-elem' || directive === 'script-src'), 'CSP did not report the blocked inline script.');

    const invalidState = await window.desktop.saveStateSnapshot('not-an-object', { reason: 'security-probe' });
    const invalidNative = await window.desktop.runWasapiDiagnostics({ unexpected: true });
    const deniedHttp = await window.desktop.openExternal('http://musicbrainz.org/');
    const deniedHost = await window.desktop.openExternal('https://example.com/');
    const deniedPath = await window.desktop.cacheProfileImage('C:\\not-granted.png');
    assert(invalidState?.code === 'invalid_payload', 'Malformed state payload did not fail closed.');
    assert(invalidNative?.code === 'invalid_payload', 'Unexpected native-helper fields did not fail closed.');
    assert(deniedHttp === false || deniedHttp?.code === 'invalid_payload', 'Insecure external URL was accepted.');
    assert(deniedHost === false || deniedHost?.code === 'invalid_payload', 'Unlisted external host was accepted.');
    assert(deniedPath === '', 'Ungrantable filesystem path reached the main process.');

    const hostile = await bridge.action('run-security-probes');
    assert(hostile?.ok === true && hostile.payload, 'Hostile-window security probe did not complete.');
    for (const key of ['runtime', 'miniOpen', 'chooseFiles', 'stateCommit', 'sharingStart', 'external', 'testConfig']) {
      assert(hostile.payload[key]?.code === 'unauthorized_sender', `Hostile window unexpectedly accessed ${key}.`);
    }
    assert(hostile.payload.rendererSecurity?.sandboxed === true && hostile.payload.rendererSecurity?.contextIsolated === true, 'Hostile probe renderer was not sandboxed and isolated.');
    assert(hostile.preferences?.sandbox === true && hostile.preferences?.nodeIntegration === true && hostile.preferences?.contextIsolation === true, 'Hostile BrowserWindow preferences were not hardened.');
    assert(hostile.counters?.popupDenied >= 1, 'Hostile popup attempt was not denied.');
    const navigationBlocked = hostile.counters?.navigationDenied >= 1 || hostile.payload.cspViolations?.length >= 1;
    assert(navigationBlocked, 'Hostile top-level/frame navigation attempt was not denied by navigation policy or CSP.');
    assert(hostile.sideEffectsBlocked === true, 'Unauthorized IPC caused a main/mini playback or navigation side effect.');
    const after = await bridge.getStatus();
    assert(!after.miniOpen && !after.sharingEnabled, 'Security probes opened a privileged window or listener.');
    return {
      startupMs: Math.round(startupMs),
      sandbox: true,
      contextIsolation: true,
      cspEvalBlocked: true,
      cspInlineBlocked: true,
      malformedPayloadsBlocked: true,
      ungrantedPathBlocked: true,
      externalUrlPolicy: true,
      hostileIpcBlocked: true,
      popupDenied: hostile.counters.popupDenied,
      navigationDenied: hostile.counters.navigationDenied,
      navigationBlockedByCsp: hostile.payload.cspViolations?.length > 0,
    };
  }

  try {
    const startupMs = await waitForStartup();
    const scenarios = {
      fresh: scenarioFresh,
        core: scenarioCore,
        'counterform-choir': scenarioCounterformChoir,
        'theme-imprints': scenarioThemeImprints,
      'theme-package': scenarioThemePackage,
      'theme-package-write': scenarioThemePackageWrite,
      'theme-package-read': scenarioThemePackageRead,
      'flow-runtime': scenarioFlowRuntime,
      'persistence-write': scenarioPersistenceWrite,
      'persistence-read': scenarioPersistenceRead,
      'workspace-persistence-write': scenarioWorkspacePersistenceWrite,
      'workspace-persistence-read': scenarioWorkspacePersistenceRead,
        'workspace-production': scenarioWorkspaceProduction,
        'workspace-theme-experiment': scenarioWorkspaceThemeExperiment,
        'workspace-canvas-studio': scenarioWorkspaceCanvasStudio,
        'singularity-stage3': scenarioSingularityStage3,
        'singularity-stage3-proxy': scenarioSingularityStage3Proxy,
      'output-loss': scenarioOutputLoss,
      recovery: scenarioRecovery,
      'sharing-privacy': scenarioSharingPrivacy,
      security: scenarioSecurity,
    };
    const run = scenarios[config.scenario];
    assert(typeof run === 'function', `Unsupported integration scenario: ${config.scenario}`);
    const summary = await run(startupMs);
    await report('scenario-passed', { code: config.scenario, ...summary, pathsHidden: true });
    await bridge.finish({ ok: true, code: config.scenario, summary });
  } catch (error) {
    const message = String(error?.message || error).slice(0, 500);
    await report('scenario-failed', { code: config.scenario, message, pathsHidden: true }).catch(() => {});
    await bridge.captureFailure(config.scenario).catch(() => {});
    await bridge.finish({ ok: false, code: config.scenario, summary: { message, pathsHidden: true } }).catch(() => {});
  }
}());
