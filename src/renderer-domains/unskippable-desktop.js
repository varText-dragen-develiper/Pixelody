(function pixelodyUnskippableDesktopFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyUnskippableDesktop = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createUnskippableDesktopApi() {
  'use strict';

  // Unskippable mode on Windows: the make / preview / save builder and the
  // cover that plays a saved mix straight through. The tracklist comes from
  // PixelodyUnskippableMix; the renderer supplies playback and storage through
  // the host object and asks blocks() before every skip, seek or queue edit.
  const PROGRESS_SAVE_MS = 5000;
  const UNTAGGED_PAGE = 200;
  const EQ_BARS = 24;
  const IDLE_MS = 3000;
  // How the cover lays out the sharp artwork and the song details over the
  // blurred backdrop. 'theme' follows the theme's own choice.
  const COVER_LAYOUTS = Object.freeze([
    { id: 'theme', label: 'Theme default' },
    { id: 'stacked', label: 'Artwork, details below' },
    { id: 'side', label: 'Artwork and details side by side' },
    { id: 'art', label: 'Artwork only' },
  ]);
  function normalizeCoverLayout(value) {
    return COVER_LAYOUTS.some((layout) => layout.id === value) ? value : 'theme';
  }
  // What a cover actually shows: the listener's pick, or the theme's when
  // they left it on Theme default. Themes without a look of their own stack.
  // Themes with a cover look of their own, and the layout each look uses.
  // A look only applies on Theme default; picking a layout gives the plain cover.
  const THEME_COVER_LOOKS = Object.freeze({
    'cartridge-quest': 'stacked', // cartridge-framed art over an RPG dialogue box
    obsession: 'side', // thriller poster: art beside oversized type
    'lo-fi-cafe': 'stacked', // polaroid on the desk with an index-card note
  });
  function themeCoverLook(preference, look) {
    return normalizeCoverLayout(preference) === 'theme' && Object.hasOwn(THEME_COVER_LOOKS, look) ? look : '';
  }
  function resolveCoverLayout(preference, themeLayout) {
    const picked = normalizeCoverLayout(preference);
    if (picked !== 'theme') return picked;
    const theme = normalizeCoverLayout(themeLayout);
    return theme === 'theme' ? 'stacked' : theme;
  }

  function formatDuration(ms) {
    const minutes = Math.max(0, Math.round(ms / 60000));
    const hours = Math.floor(minutes / 60);
    if (!hours) return `${minutes} min`;
    return minutes % 60 ? `${hours} hr ${minutes % 60} min` : `${hours} hr`;
  }
  function recipeLine(recipe) {
    if (!recipe) return 'Unskippable';
    return recipe.style === 'rigid' ? `One genre · ${recipe.genre || 'Unknown'}` : 'Flow mix';
  }
  function isUnskippable(playlist) {
    return Boolean(playlist && playlist.unskippable && Array.isArray(playlist.trackIds));
  }

  function createUnskippableDesktop(host) {
    const { mix, doc } = host;
    const esc = host.escapeHtml;
    let builder = null; // { el, recipe, preview, untaggedOpen, untaggedSelected:Set, untaggedShown, name }
    let cover = null; // { el, playlistId, finished, lastSaveAt, raf, analyser, bins, priorModes }

    // ---------- shared bits ----------
    function items() {
      return host.tracks().filter((track) => track && !track.missing).map((track) => ({ entry: host.entryFor(track), durationMs: host.durationMs(track) }));
    }
    function artworkUrl(track) {
      return track?.artworkPath ? host.fileUrl(track.artworkPath) : '';
    }
    function mosaicHtml(trackIds, label) {
      const seen = new Set(), urls = [];
      for (const id of trackIds) {
        const url = artworkUrl(host.trackById(id));
        if (url && !seen.has(url)) { seen.add(url); urls.push(url); }
        if (urls.length === 4) break;
      }
      if (!urls.length) return `<span class="unskippable-mosaic is-empty" aria-hidden="true"><b>${esc((label || 'U').charAt(0).toUpperCase())}</b></span>`;
      const cells = urls.length >= 4 ? urls : [urls[0]];
      return `<span class="unskippable-mosaic${cells.length === 4 ? ' is-grid' : ''}" aria-hidden="true">${cells.map((url) => `<i style="background-image:url('${esc(url)}')"></i>`).join('')}</span>`;
    }

    // ---------- builder ----------
    function openBuilder(seedRecipe = null) {
      closeBuilder();
      const catalog = mix.genreCatalog(items());
      const prior = seedRecipe ? mix.normalizeRecipe(seedRecipe) : null;
      builder = {
        catalog,
        recipe: prior || { style: 'flow', genre: catalog.genres[0]?.label || null, targetMinutes: mix.DEFAULT_MINUTES, includedUntaggedIds: [] },
        preview: null, untaggedOpen: false, untaggedAcknowledged: false, untaggedSelected: new Set(), untaggedShown: UNTAGGED_PAGE,
        name: '', customMinutes: false,
        opener: doc.activeElement,
      };
      if (prior && prior.style === 'rigid' && !builder.recipe.genre) builder.recipe.genre = catalog.genres[0]?.label || null;
      builder.customMinutes = !mix.LENGTHS.includes(builder.recipe.targetMinutes);
      const el = doc.createElement('div');
      el.className = 'unskippable-builder-overlay';
      el.innerHTML = '<div class="unskippable-builder-backdrop" data-unskippable-close></div><section class="unskippable-builder" role="dialog" aria-modal="true" aria-labelledby="unskippableBuilderTitle"></section>';
      doc.body.appendChild(el);
      builder.el = el;
      el.addEventListener('click', onBuilderClick);
      el.addEventListener('change', onBuilderChange);
      el.addEventListener('input', onBuilderInput);
      el.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); closeBuilder(); } });
      renderBuilder();
      setTimeout(() => el.querySelector('button, input, select')?.focus(), 0);
    }
    function closeBuilder() {
      if (!builder) return;
      const opener = builder.opener;
      builder.el.remove();
      builder = null;
      if (opener && typeof opener.focus === 'function' && doc.contains(opener)) opener.focus();
    }
    function untaggedNoticeHtml() {
      const ids = builder.catalog.untaggedTrackIds;
      if (builder.recipe.style !== 'rigid' || !ids.length) return '';
      const added = builder.recipe.includedUntaggedIds.length;
      const count = ids.length;
      const songs = (n) => `${n} song${n === 1 ? '' : 's'}`;
      const status = added
        ? `${songs(count)} have no genre tag. You added ${added} to this mix; the rest stay out.`
        : builder.untaggedAcknowledged
          ? `${songs(count)} have no genre tag and stay out of this mix.`
          : `${songs(count)} have no genre tag, so a one-genre mix can't place them.`;
      let panel = '';
      if (builder.untaggedOpen) {
        const shown = ids.slice(0, builder.untaggedShown);
        const rows = shown.map((id) => {
          const track = host.trackById(id);
          if (!track) return '';
          const checked = builder.untaggedSelected.has(id) ? ' checked' : '';
          const included = builder.recipe.includedUntaggedIds.includes(id) ? '<em>In this mix</em>' : '';
          return `<label class="unskippable-untagged-row"><input type="checkbox" data-untagged-id="${encodeURIComponent(id)}"${checked}><span><strong>${esc(track.title || 'Untitled')}</strong><small>${esc(track.artist || 'Unknown artist')}</small></span>${included}</label>`;
        }).join('');
        const more = ids.length > shown.length ? `<button type="button" class="quiet-button" data-unskippable-action="untagged-more">Show ${Math.min(UNTAGGED_PAGE, ids.length - shown.length)} more</button>` : '';
        const selected = builder.untaggedSelected.size;
        const genre = builder.recipe.genre || 'this genre';
        panel = `<div class="unskippable-untagged-panel">
          <div class="unskippable-untagged-tools"><button type="button" class="quiet-button" data-unskippable-action="untagged-all">${selected === ids.length ? 'Clear selection' : 'Select all'}</button><span>${selected} selected</span></div>
          <div class="unskippable-untagged-list" role="group" aria-label="Songs with no genre tag">${rows}${more}</div>
          <div class="unskippable-untagged-actions">
            <button type="button" data-unskippable-action="untagged-tag"${selected ? '' : ' disabled'}>Tag selected as ${esc(genre)}</button>
            <button type="button" data-unskippable-action="untagged-include"${selected ? '' : ' disabled'}>Add selected to this mix only</button>
            <button type="button" class="quiet-button" data-unskippable-action="untagged-leave">Leave them out</button>
          </div>
          <p class="unskippable-hint">Tagging saves the genre to those songs in your library. Adding them to this mix only leaves their tags alone.</p>
        </div>`;
      }
      return `<div class="unskippable-untagged" data-state="${added ? 'included' : builder.untaggedAcknowledged ? 'acknowledged' : 'unreviewed'}">
        <p role="status">${esc(status)}</p>
        <button type="button" class="quiet-button" data-unskippable-action="untagged-toggle" aria-expanded="${builder.untaggedOpen}">${builder.untaggedOpen ? 'Hide untagged songs' : 'Review untagged songs'}</button>
        ${panel}
      </div>`;
    }
    function setupHtml() {
      const recipe = builder.recipe;
      const genres = builder.catalog.genres;
      const genreOptions = genres.map((genre) => `<option value="${esc(genre.label)}"${genre.label === recipe.genre ? ' selected' : ''}>${esc(genre.label)} (${genre.count})</option>`).join('');
      const lengthChips = mix.LENGTHS.map((minutes) => `<button type="button" class="unskippable-chip${!builder.customMinutes && recipe.targetMinutes === minutes ? ' active' : ''}" data-unskippable-length="${minutes}" aria-pressed="${!builder.customMinutes && recipe.targetMinutes === minutes}">${formatDuration(minutes * 60000)}</button>`).join('');
      const rigidDisabled = !genres.length;
      return `<div class="unskippable-builder-heading"><div><p>UNSKIPPABLE</p><h2 id="unskippableBuilderTitle">Make an unskippable mix</h2></div><button type="button" data-unskippable-close aria-label="Close"><span class="public-icon icon-close" aria-hidden="true"></span></button></div>
        <p class="unskippable-lede">It plays start to finish. No skipping or seeking until it ends or you leave.</p>
        <fieldset class="unskippable-styles"><legend>Style</legend>
          <label class="unskippable-style${recipe.style === 'rigid' ? ' active' : ''}${rigidDisabled ? ' disabled' : ''}"><input type="radio" name="unskippableStyle" value="rigid"${recipe.style === 'rigid' ? ' checked' : ''}${rigidDisabled ? ' disabled' : ''}><strong>One genre</strong><span>Stays in one genre. A few close neighbours keep it from repeating itself.</span></label>
          <label class="unskippable-style${recipe.style === 'flow' ? ' active' : ''}"><input type="radio" name="unskippableStyle" value="flow"${recipe.style === 'flow' ? ' checked' : ''}><strong>Flow mix</strong><span>A general mix from your whole library, ordered by Flow.</span></label>
        </fieldset>
        ${recipe.style === 'rigid' ? `<label class="unskippable-field">Genre<select data-unskippable-genre>${genreOptions}</select></label>` : '<p class="unskippable-hint">Flow uses genre only as a hint, so songs without a genre tag can still show up.</p>'}
        ${rigidDisabled && recipe.style === 'flow' ? '<p class="unskippable-hint">None of your songs have a genre tag yet, so One genre is off.</p>' : ''}
        ${untaggedNoticeHtml()}
        <div class="unskippable-field"><span>Length</span><div class="unskippable-chips">${lengthChips}<button type="button" class="unskippable-chip${builder.customMinutes ? ' active' : ''}" data-unskippable-length="custom" aria-pressed="${builder.customMinutes}">Custom</button>${builder.customMinutes ? `<label class="unskippable-custom"><input type="number" min="${mix.MIN_MINUTES}" max="${mix.MAX_MINUTES}" step="5" value="${recipe.targetMinutes}" data-unskippable-minutes aria-label="Length in minutes"> min</label>` : ''}</div></div>
        <div class="unskippable-builder-actions"><button type="button" class="quiet-button" data-unskippable-close>Cancel</button><button type="button" class="unskippable-primary" data-unskippable-action="make"${recipe.style === 'rigid' && !recipe.genre ? ' disabled' : ''}>Make mix</button></div>`;
    }
    function previewHtml() {
      const preview = builder.preview;
      const recipe = preview.recipe;
      const neighbours = new Set(preview.neighbourIds || []);
      const rows = preview.trackIds.map((id, index) => {
        const track = host.trackById(id);
        if (!track) return '';
        const tag = neighbours.has(id) ? `<em title="A close genre">${esc(track.genre || 'Close genre')}</em>` : '';
        return `<li class="unskippable-preview-row"><span class="unskippable-preview-index">${index + 1}</span><span class="unskippable-preview-copy"><strong>${esc(track.title || 'Untitled')}</strong><small>${esc(track.artist || 'Unknown artist')}</small></span>${tag}<span class="unskippable-preview-time">${esc(host.formatTime(host.durationMs(track) / 1000))}</span><button type="button" class="quiet-button" data-unskippable-swap="${encodeURIComponent(id)}" aria-label="Swap ${esc(track.title || 'this song')}">Swap</button><button type="button" class="quiet-button" data-unskippable-remove="${encodeURIComponent(id)}" aria-label="Remove ${esc(track.title || 'this song')}">Remove</button></li>`;
      }).join('');
      const short = preview.shortfallMs > recipe.targetMinutes * 60000 / 20
        ? `<p class="unskippable-hint" role="status">${recipe.style === 'rigid' ? `There's only ${formatDuration(preview.durationMs)} of ${esc(recipe.genre)} to use, so the mix is shorter than the requested length.` : `Your library only fills ${formatDuration(preview.durationMs)}.`}</p>` : '';
      const added = recipe.includedUntaggedIds.length;
      const untagged = recipe.style === 'rigid' && builder.catalog.untaggedTrackIds.length
        ? `<p class="unskippable-hint">${added ? `${added} untagged song${added === 1 ? '' : 's'} added by hand. ` : ''}${builder.catalog.untaggedTrackIds.length - added} untagged song${builder.catalog.untaggedTrackIds.length - added === 1 ? '' : 's'} left out. <button type="button" class="link-button" data-unskippable-action="back-untagged">Review</button></p>` : '';
      const empty = !preview.trackIds.length ? '<p class="unskippable-hint" role="status">Nothing to play yet. Go back and pick another genre or style.</p>' : '';
      return `<div class="unskippable-builder-heading"><div><p>PREVIEW</p><h2 id="unskippableBuilderTitle">${esc(recipeLine(recipe))}</h2></div><button type="button" data-unskippable-close aria-label="Close"><span class="public-icon icon-close" aria-hidden="true"></span></button></div>
        <div class="unskippable-preview-head">${mosaicHtml(preview.trackIds, builder.name)}<div><label class="unskippable-field">Name<input type="text" maxlength="80" data-unskippable-name value="${esc(builder.name)}"></label><p class="unskippable-preview-stats">${preview.trackIds.length} song${preview.trackIds.length === 1 ? '' : 's'} · ${formatDuration(preview.durationMs)}</p></div></div>
        ${short}${untagged}${empty}
        <ol class="unskippable-preview-list">${rows}</ol>
        <div class="unskippable-builder-actions"><button type="button" class="quiet-button" data-unskippable-action="back">Back</button><button type="button" class="quiet-button" data-unskippable-action="regenerate">Make another</button><button type="button" class="unskippable-primary" data-unskippable-action="save"${preview.trackIds.length ? '' : ' disabled'}>Save</button></div>`;
    }
    function renderBuilder() {
      if (!builder) return;
      const dialog = builder.el.querySelector('.unskippable-builder');
      const scroll = dialog.querySelector('.unskippable-preview-list, .unskippable-untagged-list')?.scrollTop || 0;
      dialog.innerHTML = builder.preview ? previewHtml() : setupHtml();
      const list = dialog.querySelector('.unskippable-preview-list, .unskippable-untagged-list');
      if (list) list.scrollTop = scroll;
    }
    function defaultName(recipe) {
      return host.uniqueName(recipe.style === 'rigid' ? `Unskippable · ${recipe.genre}` : 'Unskippable · Flow');
    }
    function make(newSeed = true) {
      const recipe = { ...builder.recipe, seed: newSeed || !builder.recipe.seed ? `${host.nowMs().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}` : builder.recipe.seed };
      const preview = mix.generate(items(), recipe);
      builder.recipe = { ...builder.recipe, seed: preview.recipe.seed };
      if (!builder.name || builder.name === builder.autoName) builder.name = builder.autoName = defaultName(preview.recipe);
      builder.preview = preview;
      renderBuilder();
      builder.el.querySelector('.unskippable-primary')?.focus();
    }
    function save() {
      const preview = builder?.preview;
      if (!preview?.trackIds.length) return;
      const name = host.uniqueName((builder.name || '').trim() || defaultName(preview.recipe));
      const playlist = host.savePlaylist({
        name, trackIds: preview.trackIds.slice(), background: null,
        unskippable: { version: mix.VERSION, recipe: preview.recipe, neighbourIds: (preview.neighbourIds || []).slice(), createdAt: new Date(host.nowMs()).toISOString(), progress: null },
      });
      closeBuilder();
      host.toast(`Saved ${playlist.name}.`);
      openCover(playlist.id);
    }
    function onBuilderClick(event) {
      if (!builder) return;
      const target = event.target.closest('button, [data-unskippable-close]');
      if (!target) return;
      if (target.hasAttribute('data-unskippable-close')) { closeBuilder(); return; }
      if (target.dataset.unskippableLength) {
        if (target.dataset.unskippableLength === 'custom') builder.customMinutes = true;
        else { builder.customMinutes = false; builder.recipe.targetMinutes = Number(target.dataset.unskippableLength); }
        renderBuilder();
        return;
      }
      if (target.dataset.unskippableSwap) {
        const next = mix.swap(items(), builder.preview, decodeURIComponent(target.dataset.unskippableSwap));
        if (next) { builder.preview = next; renderBuilder(); } else host.toast('No other song fits here.');
        return;
      }
      if (target.dataset.unskippableRemove) {
        const next = mix.remove(items(), builder.preview, decodeURIComponent(target.dataset.unskippableRemove));
        if (next) { builder.preview = next; renderBuilder(); }
        return;
      }
      const action = target.dataset.unskippableAction;
      const ids = builder.catalog.untaggedTrackIds;
      if (action === 'make') make(true);
      else if (action === 'regenerate') make(true);
      else if (action === 'save') save();
      else if (action === 'back') { builder.preview = null; renderBuilder(); }
      else if (action === 'back-untagged') { builder.preview = null; builder.untaggedOpen = true; renderBuilder(); }
      else if (action === 'untagged-toggle') { builder.untaggedOpen = !builder.untaggedOpen; renderBuilder(); }
      else if (action === 'untagged-more') { builder.untaggedShown += UNTAGGED_PAGE; renderBuilder(); }
      else if (action === 'untagged-all') { builder.untaggedSelected = builder.untaggedSelected.size === ids.length ? new Set() : new Set(ids); renderBuilder(); }
      else if (action === 'untagged-leave') { builder.untaggedAcknowledged = true; builder.untaggedOpen = false; builder.untaggedSelected = new Set(); renderBuilder(); }
      else if (action === 'untagged-include') {
        builder.recipe.includedUntaggedIds = [...new Set([...builder.recipe.includedUntaggedIds, ...builder.untaggedSelected])];
        builder.untaggedSelected = new Set(); builder.untaggedAcknowledged = true;
        renderBuilder();
      } else if (action === 'untagged-tag') {
        const genre = builder.recipe.genre;
        const selected = [...builder.untaggedSelected];
        if (!genre || !selected.length) return;
        host.setGenre(selected, genre);
        host.toast(`Tagged ${selected.length} song${selected.length === 1 ? '' : 's'} as ${genre}.`);
        builder.catalog = mix.genreCatalog(items());
        builder.recipe.includedUntaggedIds = builder.recipe.includedUntaggedIds.filter((id) => builder.catalog.untaggedTrackIds.includes(id));
        builder.untaggedSelected = new Set(); builder.untaggedAcknowledged = true;
        renderBuilder();
      }
    }
    function onBuilderChange(event) {
      if (!builder) return;
      const target = event.target;
      if (target.name === 'unskippableStyle') {
        builder.recipe.style = target.value === 'rigid' ? 'rigid' : 'flow';
        if (builder.recipe.style === 'rigid' && !builder.recipe.genre) builder.recipe.genre = builder.catalog.genres[0]?.label || null;
        renderBuilder();
      } else if (target.matches('[data-unskippable-genre]')) {
        builder.recipe.genre = target.value;
        renderBuilder();
      } else if (target.matches('[data-untagged-id]')) {
        const id = decodeURIComponent(target.dataset.untaggedId);
        if (target.checked) builder.untaggedSelected.add(id); else builder.untaggedSelected.delete(id);
        renderBuilder();
      } else if (target.matches('[data-unskippable-minutes]')) {
        const minutes = Math.round(Number(target.value));
        builder.recipe.targetMinutes = Number.isFinite(minutes) ? Math.max(mix.MIN_MINUTES, Math.min(mix.MAX_MINUTES, minutes)) : mix.DEFAULT_MINUTES;
        target.value = builder.recipe.targetMinutes;
      }
    }
    function onBuilderInput(event) {
      if (builder && event.target.matches('[data-unskippable-name]')) builder.name = event.target.value;
    }

    // ---------- cover and the locked session ----------
    function coverPlaylist() {
      return cover ? host.findPlaylist(cover.playlistId) : null;
    }
    function playing() {
      return Boolean(cover && cover.session);
    }
    // The renderer asks before a skip, seek, queue edit or mode change. Pause,
    // resume and volume are never blocked.
    function blocks(kind) {
      if (!playing()) return false;
      if (kind === 'natural-next') return false;
      notify('Unskippable is on. Leave the mix to skip, seek or change the queue.');
      return true;
    }
    function openCover(playlistId) {
      const playlist = host.findPlaylist(playlistId);
      if (!isUnskippable(playlist)) return false;
      if (cover && cover.playlistId !== playlistId) leave();
      if (!cover) {
        const el = doc.createElement('div');
        el.className = 'unskippable-cover-layer';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-modal', 'true');
        el.setAttribute('aria-label', `Unskippable mix: ${playlist.name}`);
        el.innerHTML = `<div class="unskippable-cover-backdrop" aria-hidden="true"></div>
          <header class="unskippable-cover-top"><button type="button" class="unskippable-leave" data-unskippable-cover="leave">Leave</button><div class="unskippable-cover-heading"><p>UNSKIPPABLE</p><strong class="unskippable-cover-name"></strong><small class="unskippable-cover-recipe"></small></div>
            <div class="unskippable-cover-tools">
              <button type="button" class="unskippable-cover-tool" data-unskippable-cover="display" aria-haspopup="menu" aria-expanded="false">Display</button>
              <div class="unskippable-cover-menu" role="menu" aria-label="Cover display" hidden>${COVER_LAYOUTS.map((layout) => `<button type="button" role="menuitemradio" aria-checked="false" data-unskippable-cover="layout" data-layout="${layout.id}">${esc(layout.label)}</button>`).join('')}</div>
              <button type="button" class="unskippable-cover-tool" data-unskippable-cover="fullscreen" aria-pressed="false" title="Full screen (F)">Full screen</button>
            </div></header>
          <main class="unskippable-cover-main">
            <div class="unskippable-cover-art"></div>
            <div class="unskippable-cover-details">
            <div class="unskippable-cover-now"><strong class="unskippable-cover-title"></strong><span class="unskippable-cover-artist"></span><small class="unskippable-cover-position"></small></div>
            <div class="unskippable-cover-progress" role="progressbar" aria-label="Song progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>
            <button type="button" class="unskippable-cover-play" data-unskippable-cover="toggle" aria-label="Play"><span class="unskippable-icon is-play" aria-hidden="true"></span></button>
            </div>
          </main>
          <p class="unskippable-cover-notice" role="status" aria-live="polite"></p>
          <footer class="unskippable-cover-eq" aria-hidden="true">${Array.from({ length: EQ_BARS }, () => '<i></i>').join('')}</footer>`;
        doc.body.appendChild(el);
        el.addEventListener('click', onCoverClick);
        el.addEventListener('keydown', onCoverKey);
        ['pointermove', 'pointerdown', 'keydown'].forEach((type) => el.addEventListener(type, wake, { passive: true }));
        cover = { el, playlistId, session: false, finished: false, lastSaveAt: 0, raf: 0, analyser: null, bins: null, opener: doc.activeElement, idleTimer: 0, fullscreenExitAt: 0 };
        doc.addEventListener('fullscreenchange', onFullscreenChange);
        doc.body.classList.add('unskippable-cover-open');
        applyLayout();
        wake();
      }
      paint();
      setTimeout(() => cover?.el.querySelector('.unskippable-cover-play')?.focus(), 0);
      return true;
    }
    async function begin(fromStart = false) {
      const playlist = coverPlaylist();
      if (!playlist) return false;
      if (fromStart) playlist.unskippable.progress = null;
      const point = mix.resumePoint(playlist.trackIds, playlist.unskippable.progress, (id) => { const track = host.trackById(id); return Boolean(track && !track.missing); });
      if (!point) { host.toast("None of this mix's songs are available."); return false; }
      cover.finished = false;
      cover.session = true;
      cover.priorModes = host.takeOverQueue(playlist, point);
      const started = await host.play(point.trackId, point.positionMs);
      if (!started) { cover.session = false; host.restoreModes(cover.priorModes); paint(); return false; }
      saveProgress(true);
      paint();
      return true;
    }
    function saveProgress(force = false) {
      const playlist = coverPlaylist();
      if (!playlist || !cover.session) return;
      const now = host.nowMs();
      if (!force && now - cover.lastSaveAt < PROGRESS_SAVE_MS) return;
      const trackId = host.currentTrackId();
      if (!trackId || !playlist.trackIds.includes(trackId)) return;
      playlist.unskippable.progress = { trackId, positionMs: Math.max(0, Math.floor(host.positionMs())) };
      cover.lastSaveAt = now;
      host.persist();
    }
    // Called by the renderer when a natural end finds nothing after the last song.
    function finished() {
      if (!playing()) return false;
      const playlist = coverPlaylist();
      if (playlist) { playlist.unskippable.progress = null; playlist.unskippable.lastFinishedAt = new Date(host.nowMs()).toISOString(); host.persist(); }
      cover.session = false;
      cover.finished = true;
      host.restoreModes(cover.priorModes);
      paint();
      return true;
    }
    function leave() {
      if (!cover) return;
      if (cover.session) {
        saveProgress(true);
        host.pause();
        host.restoreModes(cover.priorModes);
      }
      stopEq();
      clearTimeout(cover.idleTimer);
      doc.removeEventListener('fullscreenchange', onFullscreenChange);
      if (doc.fullscreenElement) doc.exitFullscreen?.().catch(() => {});
      const opener = cover.opener;
      cover.el.remove();
      cover = null;
      doc.body.classList.remove('unskippable-cover-open');
      host.onLeave?.();
      if (opener && typeof opener.focus === 'function' && doc.contains(opener)) opener.focus();
    }
    async function onCoverClick(event) {
      const button = event.target.closest('[data-unskippable-cover]');
      if (!button || !cover) return;
      const action = button.dataset.unskippableCover;
      if (action !== 'display' && action !== 'layout') closeMenu();
      if (action === 'leave') leave();
      else if (action === 'fullscreen') toggleFullscreen();
      else if (action === 'display') toggleMenu();
      else if (action === 'layout') { host.setCoverLayout(normalizeCoverLayout(button.dataset.layout)); applyLayout(); closeMenu(); cover?.el.querySelector('[data-unskippable-cover="display"]')?.focus(); }
      else if (action === 'restart') await begin(true);
      else if (action === 'toggle') {
        if (!cover.session) await begin(false);
        else await host.togglePlayback();
        paint();
      }
    }
    // ---------- display: layout, full screen, fading controls ----------
    function applyLayout() {
      if (!cover) return;
      const preference = normalizeCoverLayout(host.coverLayout());
      const look = themeCoverLook(preference, host.themeCoverLook?.());
      cover.el.dataset.layout = resolveCoverLayout(preference, look ? THEME_COVER_LOOKS[look] : host.themeCoverLayout());
      if (look) cover.el.dataset.look = look; else delete cover.el.dataset.look;
      cover.el.querySelectorAll('[data-unskippable-cover="layout"]').forEach((item) => item.setAttribute('aria-checked', String(item.dataset.layout === preference)));
    }
    function menuEl() { return cover?.el.querySelector('.unskippable-cover-menu'); }
    function toggleMenu() {
      const menu = menuEl();
      if (!menu) return;
      if (!menu.hidden) { closeMenu(); return; }
      menu.hidden = false;
      cover.el.querySelector('[data-unskippable-cover="display"]').setAttribute('aria-expanded', 'true');
      (menu.querySelector('[aria-checked="true"]') || menu.firstElementChild)?.focus();
    }
    function closeMenu() {
      const menu = menuEl();
      if (!menu || menu.hidden) return false;
      menu.hidden = true;
      cover.el.querySelector('[data-unskippable-cover="display"]').setAttribute('aria-expanded', 'false');
      return true;
    }
    // App toasts sit under a full-screen cover, so the cover says it itself.
    function notify(message) {
      const notice = isFullscreen() ? cover.el.querySelector('.unskippable-cover-notice') : null;
      if (!notice) { host.toast(message); return; }
      notice.textContent = message;
      notice.classList.add('is-shown');
      clearTimeout(cover.noticeTimer);
      cover.noticeTimer = setTimeout(() => notice.classList.remove('is-shown'), 3200);
    }
    function isFullscreen() { return Boolean(cover && doc.fullscreenElement === cover.el); }
    function toggleFullscreen() {
      if (!cover) return;
      if (isFullscreen()) { doc.exitFullscreen?.().catch(() => {}); return; }
      const request = cover.el.requestFullscreen?.();
      if (!request) { host.toast("Full screen isn't available here."); return; }
      request.catch(() => host.toast("Full screen isn't available here."));
    }
    function onFullscreenChange() {
      if (!cover) return;
      const on = isFullscreen();
      if (!on) cover.fullscreenExitAt = host.nowMs();
      cover.el.classList.toggle('is-fullscreen', on);
      const button = cover.el.querySelector('[data-unskippable-cover="fullscreen"]');
      button.setAttribute('aria-pressed', String(on));
      button.textContent = on ? 'Exit full screen' : 'Full screen';
      wake();
    }
    function onCoverKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (closeMenu()) { cover.el.querySelector('[data-unskippable-cover="display"]')?.focus(); return; }
        // Esc first takes the window out of full screen (the browser may have
        // done that already this keypress); a second Esc leaves the mix.
        if (isFullscreen()) { doc.exitFullscreen?.().catch(() => {}); return; }
        if (host.nowMs() - cover.fullscreenExitAt < 500) return;
        leave();
        return;
      }
      if (event.target.closest?.('input,select,textarea')) return;
      if (event.key === 'F11' || ((event.key === 'f' || event.key === 'F') && !event.ctrlKey && !event.metaKey && !event.altKey)) {
        event.preventDefault();
        toggleFullscreen();
      }
    }
    // Controls fade after a few quiet seconds in full screen or artwork-only,
    // and come back on any mouse move, tap or key.
    function wake() {
      if (!cover) return;
      cover.el.classList.remove('is-idle');
      clearTimeout(cover.idleTimer);
      cover.idleTimer = setTimeout(() => {
        if (!cover) return;
        const fades = isFullscreen() || cover.el.dataset.layout === 'art';
        const busy = menuEl() && !menuEl().hidden;
        if (fades && !busy && cover.session && !host.isPaused()) cover.el.classList.add('is-idle');
      }, IDLE_MS);
    }

    function paint() {
      if (!cover) return;
      applyLayout();
      const playlist = coverPlaylist();
      if (!playlist) { leave(); return; }
      const el = cover.el;
      const currentId = cover.session ? host.currentTrackId() : (mix.resumePoint(playlist.trackIds, playlist.unskippable.progress, (id) => Boolean(host.trackById(id) && !host.trackById(id).missing))?.trackId || playlist.trackIds[0]);
      const track = host.trackById(currentId);
      const index = playlist.trackIds.indexOf(currentId);
      el.querySelector('.unskippable-cover-name').textContent = playlist.name;
      el.querySelector('.unskippable-cover-recipe').textContent = `${recipeLine(playlist.unskippable.recipe)} · ${playlist.trackIds.length} songs`;
      const url = artworkUrl(track);
      const art = el.querySelector('.unskippable-cover-art');
      const artKey = url || `mosaic:${playlist.id}`;
      if (art.dataset.key !== artKey) {
        art.dataset.key = artKey;
        art.innerHTML = url ? `<span class="unskippable-cover-image" style="background-image:url('${esc(url)}')"></span>` : mosaicHtml(playlist.trackIds, playlist.name);
        el.querySelector('.unskippable-cover-backdrop').style.backgroundImage = url ? `url("${url}")` : '';
      }
      const paused = !cover.session || host.isPaused();
      el.classList.toggle('is-playing', !paused);
      el.classList.toggle('is-finished', cover.finished);
      el.querySelector('.unskippable-cover-title').textContent = cover.finished ? "That's the whole mix." : track?.title || 'Untitled';
      el.querySelector('.unskippable-cover-artist').textContent = cover.finished ? '' : track?.artist || '';
      el.querySelector('.unskippable-cover-position').textContent = cover.finished ? '' : index >= 0 ? `${el.dataset.look === 'cartridge-quest' ? 'STAGE' : 'Song'} ${index + 1} of ${playlist.trackIds.length}${!cover.session && playlist.unskippable.progress ? ' · picks up where you left off' : ''}` : '';
      const play = el.querySelector('.unskippable-cover-play');
      if (cover.finished) {
        play.dataset.unskippableCover = 'restart';
        play.setAttribute('aria-label', 'Play again from the start');
        play.innerHTML = '<span class="unskippable-cover-play-label">Play again</span>';
      } else {
        play.dataset.unskippableCover = 'toggle';
        play.setAttribute('aria-label', paused ? 'Play' : 'Pause');
        play.innerHTML = `<span class="unskippable-icon ${paused ? 'is-play' : 'is-pause'}" aria-hidden="true"></span>`;
      }
      progress();
      if (!paused) startEq(); else { stopEq(); el.classList.remove('is-idle'); }
      if (cover.wasPaused && !paused) wake();
      cover.wasPaused = paused;
    }
    function progress() {
      if (!cover) return;
      const bar = cover.el.querySelector('.unskippable-cover-progress');
      const duration = cover.session ? host.durationSeconds() : 0;
      const ratio = duration > 0 ? Math.max(0, Math.min(1, host.positionMs() / 1000 / duration)) : 0;
      bar.firstElementChild.style.width = `${(ratio * 100).toFixed(2)}%`;
      bar.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
      saveProgress(false);
    }
    function startEq() {
      if (!cover || cover.raf || host.reducedMotion()) { cover?.el.classList.toggle('eq-static', host.reducedMotion()); return; }
      if (!cover.analyser) {
        cover.analyser = host.analyser();
        cover.bins = cover.analyser ? new Uint8Array(cover.analyser.frequencyBinCount) : null;
      }
      const bars = [...cover.el.querySelectorAll('.unskippable-cover-eq i')];
      cover.el.classList.toggle('eq-fallback', !cover.analyser);
      if (!cover.analyser) return;
      const frame = () => {
        if (!cover || !cover.analyser) return;
        cover.analyser.getByteFrequencyData(cover.bins);
        const usable = Math.floor(cover.bins.length * 0.7);
        let any = 0;
        bars.forEach((bar, i) => {
          // Log-spaced bands so the low end doesn't take every bar.
          const from = Math.floor(Math.pow(usable, i / bars.length)), to = Math.max(from + 1, Math.floor(Math.pow(usable, (i + 1) / bars.length)));
          let peak = 0;
          for (let b = from; b < to && b < usable; b += 1) peak = Math.max(peak, cover.bins[b]);
          any = Math.max(any, peak);
          bar.style.transform = `scaleY(${(0.08 + peak / 255 * 0.92).toFixed(3)})`;
        });
        // A silent tap (no processed graph) falls back to the CSS animation.
        cover.el.classList.toggle('eq-fallback', any === 0);
        cover.raf = requestAnimationFrame(frame);
      };
      cover.raf = requestAnimationFrame(frame);
    }
    function stopEq() {
      if (!cover) return;
      if (cover.raf) cancelAnimationFrame(cover.raf);
      cover.raf = 0;
      cover.el.querySelectorAll('.unskippable-cover-eq i').forEach((bar) => { bar.style.transform = ''; });
      if (cover.analyser) { host.releaseAnalyser(cover.analyser); cover.analyser = null; cover.bins = null; }
    }

    return Object.freeze({
      openBuilder, closeBuilder, openCover, leave, blocks, finished, paint, progress, applyLayout, toggleFullscreen,
      isOpen: () => Boolean(cover), playing, builderOpen: () => Boolean(builder),
      remake: (playlistId) => { const playlist = host.findPlaylist(playlistId); if (isUnskippable(playlist)) openBuilder(playlist.unskippable.recipe); },
    });
  }

  return Object.freeze({ formatDuration, recipeLine, isUnskippable, COVER_LAYOUTS, THEME_COVER_LOOKS, normalizeCoverLayout, resolveCoverLayout, themeCoverLook, createUnskippableDesktop });
}));
