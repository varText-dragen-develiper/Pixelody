(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyListeningEditions = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const KEYS = ['cosmic-cinema', 'neon-burst', 'obsession', 'crystal'];
  function projectLens(snapshot = {}) {
    const model = project(snapshot), track = snapshot.track;
    const duration = Number(snapshot.duration || track?.duration);
    const position = Number.isFinite(Number(snapshot.position)) ? Number(snapshot.position) : 0;
    const seconds = track && Number.isFinite(duration) && duration > 0 ? Math.ceil(Math.max(0, duration - Math.max(0, position))) : null;
    const remaining = seconds === null ? 'Duration unknown' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} left`;
    const rate = Number(track?.sampleRate);
    return { ...model, remaining, title: track?.title || 'Choose a track',
      sourceShort: track ? Number.isFinite(rate) && rate > 0 ? `${rate / 1000} kHz` : 'Unknown rate' : 'No track',
      output: snapshot.outputLabel || 'System Default' };
  }
  function mountLens(host, key, command) {
    const doc = host.ownerDocument, strip = doc.createElement('section');
    strip.className = 'listening-lens'; strip.dataset.lensTheme = key;
    strip.setAttribute('aria-label', key === 'obsession' ? 'Listening margin notes' : 'Audio signal facets');
    const status = doc.createElement('span'); status.className = 'lens-status';
    const controls = doc.createElement('div'); controls.className = 'lens-controls';
    const keys = ['source', 'queue', 'output'], labels = ['Source', 'Queue', 'Output'];
    const actions = ['track-information.open', 'queue.open', 'systems.open'];
    const buttons = keys.map((field, i) => {
      const button = doc.createElement('button'); button.type = 'button'; button.dataset.lensField = field;
      const label = doc.createElement('small'); label.textContent = labels[i];
      const value = doc.createElement('span'); button.append(label, value); controls.append(button);
      button.addEventListener('click', () => {
        if (key === 'obsession') { selected = i; paint(); }
        else command(actions[i], button);
      });
      return { button, value };
    });
    const note = doc.createElement('button'); note.type = 'button'; note.className = 'lens-note';
    note.addEventListener('click', () => command(actions[selected], note));
    strip.append(status, controls);
    if (key === 'obsession') strip.append(note);
    host.prepend(strip);
    let selected = 0, model = projectLens(), last = '';
    function paint() {
      status.textContent = `${model.status} · ${model.title === 'Choose a track' ? 'Choose a track' : model.remaining}`;
      const readings = [`${model.title} · ${model.source}`, model.queue, model.output];
      buttons.forEach(({ button, value }, i) => {
        if (key === 'obsession') button.setAttribute('aria-pressed', String(i === selected));
        else value.textContent = [model.sourceShort, model.queue, model.output][i];
        button.title = readings[i];
        if (key === 'crystal') button.setAttribute('aria-label', `${labels[i]}: ${readings[i]}. ${['Inspect track', 'Open queue', 'Open audio settings'][i]}`);
      });
      note.textContent = `${readings[selected]} ↗`; note.title = readings[selected];
      note.setAttribute('aria-label', `${labels[selected]}: ${readings[selected]}. ${['Inspect track', 'Open queue', 'Open audio settings'][selected]}`);
    }
    paint();
    return { update(snapshot) {
      const next = projectLens(snapshot), signature = JSON.stringify(next);
      if (signature === last) return;
      last = signature; model = next; paint();
    }, destroy() { strip.remove(); } };
  }
  function project(snapshot = {}) {
    const positive = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0;
    const track = snapshot.track;
    const duration = positive(snapshot.duration) || positive(track?.duration);
    const position = positive(snapshot.position);
    const progress = track && duration > 0 ? Math.min(1, position / duration) : 0;
    const source = track ? [track.format || track.codec || 'Unknown format',
      positive(track.sampleRate) ? `${positive(track.sampleRate) / 1000} kHz` : '',
      positive(track.bitDepth) ? `${positive(track.bitDepth)} bit` : ''].filter(Boolean).join(' · ') : 'Choose a track';
    return { progress, source, status: snapshot.pending ? 'Changing track' : !track ? 'Idle' : snapshot.paused ? 'Paused' : 'Playing',
      tempo: Number.isFinite(snapshot.bpm) && snapshot.bpm > 0 ? `${snapshot.bpm} BPM · tag` : 'No BPM tag',
      queue: `${Math.floor(positive(snapshot.queueLength))} queued` };
  }
  function mount(host, key, command) {
    if (!host || !KEYS.includes(key)) return null;
    if (key === 'obsession' || key === 'crystal') return mountLens(host, key, command);
    const doc = host.ownerDocument;
    const strip = doc.createElement('section');
    strip.className = 'listening-edition';
    strip.setAttribute('aria-label', `${key === 'cosmic-cinema' ? 'Observatory' : 'Print desk'} navigation and source readings`);
    const nav = doc.createElement('nav');
    nav.setAttribute('aria-label', 'Listening shortcuts');
    [['library.open', 'Library'], ['tracks.open', 'Tracks'], ['queue.open', 'Queue'], ['track-information.open', 'Info']].forEach(([action, label]) => {
      const button = doc.createElement('button');
      button.type = 'button'; button.textContent = label;
      button.dataset.editionAction = action;
      button.addEventListener('click', () => command(action, button));
      nav.append(button);
    });
    const readings = doc.createElement('div'); readings.className = 'edition-readings';
    const fields = {};
    ['status', 'source', 'tempo', 'queue'].forEach(key => {
      fields[key] = doc.createElement('span'); fields[key].dataset.editionReading = key; readings.append(fields[key]);
    });
    const progress = doc.createElement('div'); progress.className = 'edition-progress';
    progress.setAttribute('role', 'progressbar'); progress.setAttribute('aria-label', 'Current track progress');
    progress.setAttribute('aria-valuemin', '0'); progress.setAttribute('aria-valuemax', '100');
    strip.append(nav, readings, progress); host.prepend(strip);
    let last = '';
    return { update(snapshot) {
      const model = project(snapshot);
      const signature = JSON.stringify(model);
      if (signature === last) return;
      last = signature;
      Object.keys(fields).forEach(key => { if (fields[key].textContent !== model[key]) fields[key].textContent = model[key]; });
      strip.dataset.playback = model.status;
      strip.style.setProperty('--edition-progress', `${model.progress * 100}%`);
      progress.setAttribute('aria-valuenow', String(Math.round(model.progress * 100)));
    }, destroy() { strip.remove(); } };
  }
  return Object.freeze({ KEYS: Object.freeze(KEYS), project, projectLens, mount });
}));
