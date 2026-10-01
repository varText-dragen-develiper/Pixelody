(function pixelodyThemeInstrumentsFactory(root, factory) {
  const fixtures = (typeof module === 'object' && module.exports) ? require('./fixtures.js') : root && root.PixelodyThemeInstrumentFixtures;
  const api = factory(fixtures);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyThemeInstruments = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createInstrumentApi(fixtures) {
  'use strict';
  if (!fixtures) throw new Error('Theme instruments require fixture helpers.');

  function createElement(tag, className = '', text = '') {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }
  function setPressed(root, selector, value, attribute = 'data-value') {
    root?.querySelectorAll(selector).forEach((button) => button.setAttribute('aria-pressed', String(button.getAttribute(attribute) === value)));
  }
  function baseLifecycle(setup) {
    let root = null;
    let host = null;
    let cleanup = () => {};
    return {
      mount(container, nextHost) {
        root = container; host = nextHost; root.replaceChildren(); cleanup = setup(root, host) || (() => {});
      },
      update(snapshot) { if (root) setup.update?.(root, host, snapshot); },
      destroy() { try { cleanup(); } finally { root?.replaceChildren(); root = null; host = null; cleanup = () => {}; } },
    };
  }

  function materialSwitchboard() {
    let recipe = 'glass';
    const setup = (root, host) => {
      root.innerHTML = '<div class="ti-material-board"><div class="ti-material-sample"><span class="ti-material-code">SURFACE / GLASS</span><strong>Collection signal</strong><p>48 local tracks · lossless archive</p><i></i></div><div class="ti-inline-controls" role="group" aria-label="Surface material"><button data-value="glass" aria-pressed="true">Glass</button><button data-value="paper" aria-pressed="false">Paper</button><button data-value="polymer" aria-pressed="false">Polymer</button></div></div>';
      const onClick = (event) => {
        const button = event.target.closest('[data-value]'); if (!button) return;
        recipe = button.dataset.value; render(); host.announce(`Surface recipe changed to ${recipe}.`);
      };
      const render = () => {
        root.querySelector('.ti-material-board').dataset.material = recipe;
        root.querySelector('.ti-material-code').textContent = `SURFACE / ${recipe.toUpperCase()}`;
        setPressed(root, '[data-value]', recipe);
      };
      root.addEventListener('click', onClick); render();
      return () => root.removeEventListener('click', onClick);
    };
    setup.update = (root, host, snapshot) => { root.querySelector('.ti-material-sample p').textContent = `${snapshot.collection.count} local tracks · ${fixtures.currentTrack(snapshot).format} archive`; };
    return baseLifecycle(setup);
  }

  function ambientField() {
    let field = 'orbit';
    const setup = (root, host) => {
      const fieldShell = createElement('div', 'ti-atmosphere');
      const scene = createElement('div', 'ti-atmosphere-scene');
      scene.setAttribute('aria-hidden', 'true');
      for (let index = 0; index < 18; index += 1) { const mote = createElement('i'); mote.style.setProperty('--i', index); scene.append(mote); }
      const label = createElement('div', 'ti-atmosphere-label', 'ORBIT FIELD / DECORATIVE');
      const controls = createElement('div', 'ti-inline-controls'); controls.setAttribute('role', 'group'); controls.setAttribute('aria-label', 'Atmosphere field');
      ['orbit', 'rain', 'steam'].forEach((value) => { const button = createElement('button', '', value[0].toUpperCase() + value.slice(1)); button.dataset.value = value; button.setAttribute('aria-pressed', String(value === field)); controls.append(button); });
      scene.append(label); fieldShell.append(scene, controls); root.append(fieldShell);
      const render = () => { scene.dataset.field = field; label.textContent = `${field.toUpperCase()} FIELD / DECORATIVE`; setPressed(root, '[data-value]', field); };
      const onClick = (event) => { const button = event.target.closest('[data-value]'); if (!button) return; field = button.dataset.value; render(); host.announce(`${field} atmosphere selected. Decorative only.`); };
      root.addEventListener('click', onClick); render();
      return () => root.removeEventListener('click', onClick);
    };
    return baseLifecycle(setup);
  }

  function artworkPrism() {
    let treatment = 'duotone';
    const setup = (root, host) => {
      root.innerHTML = '<div class="ti-artwork-workbench"><div class="ti-artwork-frame"><div class="ti-generated-art" aria-label="Generated abstract artwork fixture"><i></i><i></i><i></i><i></i><i></i></div><span>ARBITRARY ART / PRESERVED</span></div><div class="ti-inline-controls" role="group" aria-label="Artwork treatment"><button data-value="raw">Raw</button><button data-value="duotone">Duotone</button><button data-value="halftone">Halftone</button><button data-value="prism">Prism</button></div></div>';
      const art = root.querySelector('.ti-generated-art');
      const render = () => { art.dataset.treatment = treatment; setPressed(root, '[data-value]', treatment); };
      const onClick = (event) => { const button = event.target.closest('[data-value]'); if (!button) return; treatment = button.dataset.value; render(); host.announce(`${treatment} artwork treatment selected.`); };
      root.addEventListener('click', onClick); render();
      return () => root.removeEventListener('click', onClick);
    };
    return baseLifecycle(setup);
  }

  function playlistSigil() {
    const setup = (root, host) => {
      root.innerHTML = '<div class="ti-sigil-layout"><div class="ti-sigil" role="img" aria-label="Deterministic playlist identity mark"><i></i><i></i><i></i><b></b></div><div class="ti-sigil-copy"><label>Playlist seed<input type="text" value="Night Transit Archive" maxlength="48"></label><strong></strong><span></span><p>Same local name and seed produce the same mark.</p></div></div>';
      const input = root.querySelector('input');
      const render = () => {
        const value = input.value.trim() || 'Untitled Playlist'; const hash = fixtures.hashString(value); const sigil = root.querySelector('.ti-sigil');
        sigil.style.setProperty('--sigil-rotation', `${hash % 360}deg`); sigil.style.setProperty('--sigil-cut', `${20 + hash % 46}%`); sigil.style.setProperty('--sigil-shift', `${(hash >>> 8) % 28 - 14}px`);
        sigil.querySelector('b').textContent = value.split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase();
        root.querySelector('.ti-sigil-copy strong').textContent = value;
        root.querySelector('.ti-sigil-copy span').textContent = `PX-${hash.toString(16).toUpperCase().padStart(8, '0')}`;
      };
      const onInput = () => { render(); host.announce('Playlist identity mark regenerated.'); };
      input.addEventListener('input', onInput); render();
      return () => input.removeEventListener('input', onInput);
    };
    return baseLifecycle(setup);
  }

  function seekTimeline() {
    let style = 'tape';
    const setup = (root, host) => {
      root.innerHTML = '<div class="ti-timeline"><div class="ti-timeline-readout"><strong></strong><span></span></div><label><span class="sr-only">Playback position</span><input type="range" min="0" max="264" value="102" step="1"></label><div class="ti-timeline-marks" aria-hidden="true"></div><div class="ti-inline-controls" role="group" aria-label="Timeline style"><button data-value="tape">Tape</button><button data-value="orbit">Orbit</button><button data-value="seismograph">Seismograph</button></div></div>';
      const input = root.querySelector('input');
      const onInput = () => host.dispatch({ type: 'SEEK', position: Number(input.value) });
      const onClick = (event) => { const button = event.target.closest('[data-value]'); if (!button) return; style = button.dataset.value; root.querySelector('.ti-timeline').dataset.timeline = style; setPressed(root, '[data-value]', style); host.announce(`${style} timeline selected.`); };
      input.addEventListener('input', onInput); root.addEventListener('click', onClick); root.querySelector('.ti-timeline').dataset.timeline = style; setPressed(root, '[data-value]', style);
      return () => { input.removeEventListener('input', onInput); root.removeEventListener('click', onClick); };
    };
    setup.update = (root, host, snapshot) => {
      const input = root.querySelector('input'); input.max = snapshot.playback.duration; input.value = snapshot.playback.position;
      input.style.setProperty('--progress', `${snapshot.playback.position / Math.max(1, snapshot.playback.duration) * 100}%`);
      root.querySelector('.ti-timeline-readout strong').textContent = fixtures.formatTime(snapshot.playback.position);
      root.querySelector('.ti-timeline-readout span').textContent = fixtures.formatTime(snapshot.playback.duration);
    };
    return baseLifecycle(setup);
  }

  function truthSignalBank() {
    const setup = (root, host) => {
      root.innerHTML = '<div class="ti-truth-bank"><div class="ti-truth-signal" role="status"><i></i><div><small>AUTHORITATIVE PLAYBACK</small><strong></strong><span></span></div></div><dl><div><dt>Source</dt><dd></dd></div><div><dt>Output</dt><dd></dd></div><div><dt>Queue</dt><dd></dd></div></dl><div class="ti-inline-controls" role="group" aria-label="Playback truth fixture"><button data-phase="playing">Playing</button><button data-phase="paused">Paused</button><button data-phase="pending">Pending</button><button data-phase="failed">Failed</button></div></div>';
      const onClick = (event) => { const button = event.target.closest('[data-phase]'); if (!button) return; host.dispatch({ type: 'SET_PHASE', phase: button.dataset.phase }); };
      root.addEventListener('click', onClick); return () => root.removeEventListener('click', onClick);
    };
    setup.update = (root, host, snapshot) => {
      const track = fixtures.currentTrack(snapshot); const phase = snapshot.playback.phase; const signal = root.querySelector('.ti-truth-signal'); signal.dataset.phase = phase;
      signal.querySelector('strong').textContent = phase === 'failed' ? 'Unavailable' : phase[0].toUpperCase() + phase.slice(1);
      signal.querySelector('span').textContent = phase === 'failed' ? snapshot.playback.error : `${track.title} · ${track.artist}`;
      const values = root.querySelectorAll('dd'); values[0].textContent = `${track.format} · ${track.quality}`; values[1].textContent = snapshot.output.label; values[2].textContent = `${snapshot.queue.count} items · ${snapshot.queue.manual} manual`;
      root.querySelectorAll('[data-phase]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.phase === phase)));
    };
    return baseLifecycle(setup);
  }

  function transportConsole() {
    const setup = (root, host) => {
      root.innerHTML = '<div class="ti-transport"><div class="ti-transport-display"><small>LOCAL TRANSPORT / FIXTURE</small><strong></strong><span></span></div><div class="ti-transport-controls"><button data-action="shuffle" aria-label="Toggle shuffle">SHF</button><button data-action="previous" aria-label="Previous track">◀</button><button class="ti-play" data-action="play" aria-label="Pause">Ⅱ</button><button data-action="next" aria-label="Next track">▶</button><button data-action="repeat" aria-label="Cycle repeat">RPT</button></div><p></p></div>';
      const onClick = (event) => {
        const action = event.target.closest('[data-action]')?.dataset.action; if (!action) return;
        const map = { play: 'TOGGLE_PLAY', previous: 'PREVIOUS_TRACK', next: 'NEXT_TRACK', shuffle: 'TOGGLE_SHUFFLE', repeat: 'CYCLE_REPEAT' };
        host.dispatch({ type: map[action] });
      };
      root.addEventListener('click', onClick); return () => root.removeEventListener('click', onClick);
    };
    setup.update = (root, host, snapshot) => {
      const track = fixtures.currentTrack(snapshot); root.querySelector('.ti-transport-display strong').textContent = track.title; root.querySelector('.ti-transport-display span').textContent = `${track.artist} · ${track.album}`;
      const play = root.querySelector('[data-action="play"]'); const playing = snapshot.playback.phase === 'playing'; play.textContent = playing ? 'Ⅱ' : '▶'; play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
      root.querySelector('[data-action="shuffle"]').setAttribute('aria-pressed', String(snapshot.modes.shuffle)); root.querySelector('[data-action="repeat"]').setAttribute('aria-pressed', String(snapshot.modes.repeat !== 'off'));
      root.querySelector('.ti-transport p').textContent = `Shuffle ${snapshot.modes.shuffle ? 'on' : 'off'} · Repeat ${snapshot.modes.repeat}`;
    };
    return baseLifecycle(setup);
  }

  function focusCabinet() {
    let opener = null;
    const setup = (root, host) => {
      root.innerHTML = '<div class="ti-cabinet"><button class="ti-cabinet-open" aria-expanded="false">Open technical cabinet <span>↗</span></button><div class="ti-cabinet-drawer" hidden><div><small>OUTPUT ROUTE</small><strong>Studio DAC / USB</strong></div><div><small>PROCESSING</small><strong>Track EQ + System EQ</strong></div><button class="ti-cabinet-close">Close cabinet</button></div></div>';
      opener = root.querySelector('.ti-cabinet-open'); const close = root.querySelector('.ti-cabinet-close');
      const openCabinet = () => host.dispatch({ type: 'SET_CABINET', open: true }); const closeCabinet = () => host.dispatch({ type: 'SET_CABINET', open: false });
      const onKeydown = (event) => { if (event.key === 'Escape' && !root.querySelector('.ti-cabinet-drawer').hidden) { event.preventDefault(); closeCabinet(); requestAnimationFrame(() => opener.focus()); } };
      opener.addEventListener('click', openCabinet); close.addEventListener('click', closeCabinet); root.addEventListener('keydown', onKeydown);
      return () => { opener.removeEventListener('click', openCabinet); close.removeEventListener('click', closeCabinet); root.removeEventListener('keydown', onKeydown); };
    };
    setup.update = (root, host, snapshot) => {
      const drawer = root.querySelector('.ti-cabinet-drawer'); const wasHidden = drawer.hidden; drawer.hidden = !snapshot.cabinetOpen; opener.setAttribute('aria-expanded', String(snapshot.cabinetOpen));
      if (snapshot.cabinetOpen && wasHidden) requestAnimationFrame(() => root.querySelector('.ti-cabinet-close')?.focus());
    };
    return baseLifecycle(setup);
  }

  function choreographyStage() {
    let timer = 0;
    const setup = (root, host) => {
      root.innerHTML = '<div class="ti-choreo"><div class="ti-choreo-stage"><span>TRANSITION TARGET</span><strong>Night Transit Archive</strong><p>48 local tracks</p><i></i></div><div class="ti-inline-controls" role="group" aria-label="Transition choreography"><button data-transition="paper">Paper lift</button><button data-transition="eclipse">Eclipse</button><button data-transition="shutter">Shutter</button></div></div>';
      const stage = root.querySelector('.ti-choreo-stage');
      const onClick = (event) => {
        const button = event.target.closest('[data-transition]'); if (!button) return;
        clearTimeout(timer); stage.className = 'ti-choreo-stage'; delete stage.dataset.staticReceipt; void stage.offsetWidth;
        if (host.getContext().motion === 'full' && host.getContext().performance !== 'conserve') { stage.classList.add(`is-${button.dataset.transition}`); timer = setTimeout(() => { stage.className = 'ti-choreo-stage'; }, 820); host.announce(`${button.textContent} choreography played.`); }
        else { stage.dataset.staticReceipt = button.dataset.transition; host.announce(`${button.textContent} shown as a static transition receipt.`); }
      };
      root.addEventListener('click', onClick); return () => { clearTimeout(timer); root.removeEventListener('click', onClick); };
    };
    return baseLifecycle(setup);
  }

  function recoveryReceipt() {
    let timer = 0;
    const setup = (root, host) => {
      root.innerHTML = '<div class="ti-receipt" role="status"><div class="ti-receipt-mark"></div><small></small><strong></strong><p></p><div class="ti-receipt-actions"><button data-receipt="error">Simulate missing file</button><button data-receipt="retry">Retry</button><button data-receipt="undo">Undo</button></div></div>';
      const onClick = (event) => {
        const action = event.target.closest('[data-receipt]')?.dataset.receipt; if (!action) return; clearTimeout(timer);
        if (action === 'error') host.dispatch({ type: 'SET_FEEDBACK', state: 'error', message: 'Track file could not be found.', action: 'Locate the file or retry without removing playlist membership.' });
        if (action === 'undo') host.dispatch({ type: 'SET_FEEDBACK', state: 'success', message: 'Last queue change was undone.', action: 'Queue order has been restored.' });
        if (action === 'retry') { host.dispatch({ type: 'SET_FEEDBACK', state: 'pending', message: 'Checking the local file path…', action: 'You can continue using the library.' }); timer = setTimeout(() => host.dispatch({ type: 'SET_FEEDBACK', state: 'success', message: 'Local file was reconnected.', action: 'Playback is available again.' }), 900); }
      };
      root.addEventListener('click', onClick); return () => { clearTimeout(timer); root.removeEventListener('click', onClick); };
    };
    setup.update = (root, host, snapshot) => {
      const receipt = root.querySelector('.ti-receipt'); receipt.dataset.state = snapshot.feedback.state; receipt.querySelector('small').textContent = `HOST OUTCOME / ${snapshot.feedback.state.toUpperCase()}`; receipt.querySelector('strong').textContent = snapshot.feedback.message; receipt.querySelector('p').textContent = snapshot.feedback.action;
      root.querySelector('[data-receipt="retry"]').disabled = snapshot.feedback.state === 'pending';
    };
    return baseLifecycle(setup);
  }

  function slotComposer() {
    let slot = 'hero'; let instrument = 'status-signal';
    const compatibility = { 'status-signal': ['hero', 'player', 'inspector', 'mini'], visualizer: ['hero', 'player'], 'material-panel': ['hero', 'inspector', 'mini'] };
    const setup = (root, host) => {
      root.innerHTML = '<div class="ti-slot-composer"><div class="ti-slot-controls"><label>Instrument<select><option value="status-signal">Status signal</option><option value="visualizer">Audio visualizer</option><option value="material-panel">Material panel</option></select></label><label>Product slot<select><option value="hero">Hero overlay</option><option value="player">Player overlay</option><option value="inspector">Inspector start</option><option value="mini">Mini companion</option></select></label></div><div class="ti-slot-map"><div data-slot="hero">HERO</div><div data-slot="inspector">INSPECTOR</div><div data-slot="player">PLAYER</div><div data-slot="mini">MINI</div></div><p class="ti-slot-result" role="status"></p></div>';
      const selects = root.querySelectorAll('select');
      const render = () => {
        root.querySelectorAll('[data-slot]').forEach((node) => { node.dataset.active = String(node.dataset.slot === slot); node.textContent = node.dataset.slot.toUpperCase(); });
        const supported = compatibility[instrument].includes(slot); const target = root.querySelector(`[data-slot="${slot}"]`); target.textContent = supported ? `${slot.toUpperCase()} / ${instrument.replace('-', ' ').toUpperCase()}` : `${slot.toUpperCase()} / SAFE FALLBACK`;
        root.querySelector('.ti-slot-result').textContent = supported ? `Compatible: ${instrument} can mount in ${slot}.` : `Incompatible placement: the ${slot} keeps its ordinary baseline.`;
        root.querySelector('.ti-slot-composer').dataset.compatible = String(supported);
      };
      const onChange = () => { instrument = selects[0].value; slot = selects[1].value; render(); host.announce(root.querySelector('.ti-slot-result').textContent); };
      selects.forEach((select) => select.addEventListener('change', onChange)); render();
      return () => selects.forEach((select) => select.removeEventListener('change', onChange));
    };
    return baseLifecycle(setup);
  }

  function miniCompanion() {
    let relationship = 'distinct';
    const setup = (root, host) => {
      root.innerHTML = '<div class="ti-companion"><div class="ti-companion-previews"><div class="ti-main-preview"><small>MAIN / EXPANDED</small><strong></strong><span></span><button data-play aria-label="Toggle playback in main preview">Ⅱ</button></div><div class="ti-mini-preview"><small>MINI / CONFIRMED</small><strong></strong><span></span><button data-play aria-label="Toggle playback in mini preview">Ⅱ</button></div></div><div class="ti-inline-controls" role="group" aria-label="Main and mini relationship"><button data-relation="distinct">Distinct companion</button><button data-relation="shared">Shared recipe</button><button data-relation="unsupported">Mini unsupported</button></div><p role="status"></p></div>';
      const renderRelation = () => { root.querySelector('.ti-companion').dataset.relationship = relationship; setPressed(root, '[data-relation]', relationship, 'data-relation'); const copy = { distinct: 'Same truth, deliberately condensed mini composition.', shared: 'Same recipe scales into both registered slots.', unsupported: 'Mini keeps the ordinary safe baseline.' }; root.querySelector('.ti-companion > p').textContent = copy[relationship]; };
      const onClick = (event) => { if (event.target.closest('[data-play]')) host.dispatch({ type: 'TOGGLE_PLAY' }); const button = event.target.closest('[data-relation]'); if (button) { relationship = button.dataset.relation; renderRelation(); host.announce(root.querySelector('.ti-companion > p').textContent); } };
      root.addEventListener('click', onClick); renderRelation(); return () => root.removeEventListener('click', onClick);
    };
    setup.update = (root, host, snapshot) => {
      const track = fixtures.currentTrack(snapshot); root.querySelectorAll('.ti-companion-previews strong').forEach((node) => { node.textContent = track.title; }); root.querySelectorAll('.ti-companion-previews span').forEach((node) => { node.textContent = `${track.artist} · ${snapshot.playback.phase}`; }); root.querySelectorAll('[data-play]').forEach((button) => { button.textContent = snapshot.playback.phase === 'playing' ? 'Ⅱ' : '▶'; });
    };
    return baseLifecycle(setup);
  }

  const DEFINITIONS = Object.freeze([
    { id: 'material-switchboard', category: 'material-atmosphere', name: 'Material Switchboard', summary: 'Glass, paper, and molded-polymer surface recipes over the same truthful content.', role: 'aesthetic', renderer: 'css', cost: 'low', jobs: [], inputs: ['palette', 'detail', 'performance'], placements: ['panel', 'card', 'mini-shell'], fallback: 'Plain elevated surface.', accessibility: 'Decorative material never changes content order or contrast ownership.', create: materialSwitchboard },
    { id: 'ambient-field', category: 'material-atmosphere', name: 'Ambient Field', summary: 'Orbit, rain, and steam atmospheres with static and conserve substitutions.', role: 'aesthetic', renderer: 'css', cost: 'medium', jobs: [], inputs: ['motion', 'detail', 'performance'], placements: ['canvas-background', 'hero', 'stage-overlay'], fallback: 'Static sparse atmosphere or no layer.', accessibility: 'Scene is aria-hidden and never communicates playback state.', create: ambientField },
    { id: 'artwork-prism', category: 'artwork-identity', name: 'Artwork Treatment Prism', summary: 'Raw, duotone, halftone, and prism treatments that preserve the artwork frame.', role: 'hybrid', renderer: 'css', cost: 'medium', jobs: ['artwork presentation'], inputs: ['artwork', 'palette', 'detail', 'performance'], placements: ['hero-artwork', 'cover', 'mini-artwork'], fallback: 'Unfiltered artwork with a readable frame.', accessibility: 'Artwork remains labelled and treatments never replace track identity.', create: artworkPrism },
    { id: 'playlist-sigil', category: 'artwork-identity', name: 'Playlist Sigil Generator', summary: 'Deterministic local identity marks and catalog codes from playlist seed text.', role: 'hybrid', renderer: 'dom', cost: 'low', jobs: ['playlist identity', 'missing artwork fallback'], inputs: ['playlist.id', 'playlist.name', 'palette'], placements: ['playlist-card', 'hero-artwork', 'mini-artwork'], fallback: 'Literal playlist name and default music glyph.', accessibility: 'Generated mark has a literal playlist label and deterministic text code.', create: playlistSigil },
    { id: 'seek-timeline', category: 'truth-information', name: 'Seek Timeline Deck', summary: 'One precise seek control embodied as tape, orbit, or seismograph progress.', role: 'functional', renderer: 'dom', cost: 'low', jobs: ['seek', 'elapsed time', 'duration'], inputs: ['playback.position', 'playback.duration'], placements: ['player', 'hero', 'mini-progress'], fallback: 'Native range input with elapsed and duration labels.', accessibility: 'Real labelled range input remains the interaction owner.', create: seekTimeline },
    { id: 'truth-signal-bank', category: 'truth-information', name: 'Truth Signal Bank', summary: 'Literal playing, paused, pending, and failure receipts plus source/output facts.', role: 'functional', renderer: 'dom', cost: 'low', jobs: ['playback status', 'source status', 'output status'], inputs: ['playback.phase', 'playback.error', 'playback.technical', 'output.route', 'queue.summary'], placements: ['hero-overlay', 'player-overlay', 'inspector', 'mini-status'], fallback: 'Plain text status and technical labels.', accessibility: 'Role=status, literal labels, and non-color phase differences.', create: truthSignalBank },
    { id: 'transport-console', category: 'interaction-control', name: 'Transport Object Console', summary: 'A coherent hardware object that retains canonical transport operations.', role: 'functional', renderer: 'dom', cost: 'low', jobs: ['previous', 'play/pause', 'next', 'shuffle', 'repeat'], inputs: ['playback.phase', 'track identity', 'shuffle', 'repeat'], placements: ['player-controls', 'hero-controls', 'mini-controls'], fallback: 'Ordinary labelled transport buttons.', accessibility: 'Canonical labels, keyboard buttons, aria-pressed modes, and aligned controls.', create: transportConsole },
    { id: 'focus-cabinet', category: 'interaction-control', name: 'Focus-Safe Technical Cabinet', summary: 'A themeable reveal container with explicit focus entry, Escape, close, and return.', role: 'functional', renderer: 'dom', cost: 'low', jobs: ['progressive disclosure', 'technical inspection'], inputs: ['cabinet.open', 'output.route'], placements: ['inspector', 'popover', 'hero-cabinet'], fallback: 'Ordinary disclosure region and button.', accessibility: 'aria-expanded, focus entry, Escape dismissal, and opener focus return.', create: focusCabinet },
    { id: 'choreography-stage', category: 'motion-feedback', name: 'Transition Choreography Stage', summary: 'Paper lift, eclipse, and shutter transitions with static receipts when motion yields.', role: 'hybrid', renderer: 'css', cost: 'medium', jobs: ['transition feedback'], inputs: ['event.kind', 'motion', 'performance'], placements: ['hero', 'stage', 'overlay'], fallback: 'Immediate state swap with a static named receipt.', accessibility: 'Motion is optional and never delays or owns the outcome.', create: choreographyStage },
    { id: 'recovery-receipt', category: 'motion-feedback', name: 'Recovery Receipt', summary: 'Pending, error, retry, undo, and success language paired with the literal next action.', role: 'functional', renderer: 'dom', cost: 'low', jobs: ['feedback', 'recovery', 'undo'], inputs: ['operation.outcome', 'operation.recovery'], placements: ['overlay', 'drawer', 'status-region'], fallback: 'Plain outcome message and ordinary action buttons.', accessibility: 'Role=status and explicit next action; metaphor never replaces error meaning.', create: recoveryReceipt },
    { id: 'slot-composer', category: 'composition-delivery', name: 'Product Slot Composer', summary: 'Tests instrument-to-slot compatibility and demonstrates safe fallback in place.', role: 'platform', renderer: 'dom', cost: 'low', jobs: ['instrument placement', 'fallback validation'], inputs: ['instrument descriptor', 'slot descriptor'], placements: ['foundry'], fallback: 'Keep the ordinary product-owned slot baseline.', accessibility: 'Literal compatibility result and native selects.', create: slotComposer },
    { id: 'mini-companion', category: 'composition-delivery', name: 'Main / Mini Companion Profile', summary: 'Compares distinct, shared, and unsupported mini relationships over synchronized truth.', role: 'platform', renderer: 'dom', cost: 'low', jobs: ['main/mini composition', 'playback parity'], inputs: ['track identity', 'playback.phase', 'recipe relationship'], placements: ['foundry', 'main-preview', 'mini-preview'], fallback: 'Mini uses the ordinary synchronized player baseline.', accessibility: 'Both previews expose the same literal state and labelled playback action.', create: miniCompanion },
  ].map((entry) => Object.freeze({ ...entry, jobs: Object.freeze(entry.jobs), inputs: Object.freeze(entry.inputs), placements: Object.freeze(entry.placements) })));

  function registerAll(registry) { DEFINITIONS.forEach((descriptor) => { if (!registry.has(descriptor.id)) registry.register(descriptor); }); return DEFINITIONS.length; }
  return Object.freeze({ DEFINITIONS, registerAll });
}));
