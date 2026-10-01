(function initializeVisualizerLab() {
  'use strict';
  const signal = window.PixelodyVisualizerSignal;
  const renderers = window.PixelodyVisualizerRenderers;
  const runtime = window.PixelodyVisualizerRuntime;
  if (!signal || !renderers || !runtime) throw new Error('Visualizer lab modules did not load.');

  const palettes = Object.freeze({
    electric: { background: '#07090d', primary: '#7cf3d0', secondary: '#8e7dff', highlight: '#fff3a8', muted: '#72808f' },
    paper: { background: '#17130f', primary: '#edaa63', secondary: '#89a878', highlight: '#ffe9bd', muted: '#746858' },
    mono: { background: '#070707', primary: '#f1f1ed', secondary: '#929892', highlight: '#ffffff', muted: '#555b58' },
    signal: { background: '#090708', primary: '#ff4d67', secondary: '#ff9b66', highlight: '#fff3d0', muted: '#735661' },
  });
  const familyColors = Object.freeze({ frequency: '#7cf3d0', waveform: '#8e7dff', history: '#ffca74', stereo: '#74caff', particles: '#ff7bbb', geometry: '#b6ff73', metering: '#fff3a8', mechanical: '#ff8f70', weave: '#78e8ff' });
  const grid = document.querySelector('#visualizerGrid');
  const familyIndex = document.querySelector('#familyIndex');
  const presetControl = document.querySelector('#signalPreset');
  const motionControl = document.querySelector('#motionMode');
  const performanceControl = document.querySelector('#performanceMode');
  const paletteControl = document.querySelector('#paletteMode');
  const status = document.querySelector('#labStatus');
  const handles = [];
  let selectedPreset = presetControl.value;

  const scheduler = runtime.createScheduler({ frameSource: (timestamp) => signal.makeDemoFrame(timestamp, selectedPreset, 19) });
  const definitions = renderers.listRenderers();
  const counts = definitions.reduce((result, definition) => ({ ...result, [definition.family]: (result[definition.family] || 0) + 1 }), {});
  familyIndex.innerHTML = Object.entries(counts).map(([family, count]) => `<span class="family-chip" style="--chip-color:${familyColors[family] || '#7cf3d0'}"><i></i><b>${family}</b>${count}</span>`).join('');

  definitions.forEach((definition, index) => {
    const article = document.createElement('article');
    article.className = 'visualizer-card';
    article.innerHTML = `<div class="visualizer-stage"><canvas></canvas></div><div class="visualizer-copy"><div><span class="visualizer-number">FORM ${String(index + 1).padStart(2, '0')} · ${definition.family.toUpperCase()}</span><h2>${definition.name}</h2><p>${definition.process}</p></div><div class="visualizer-meta"><span class="complexity-${definition.complexity}">${definition.complexity} cost</span><span>${definition.channels}</span></div><div class="visualizer-placements">${definition.placements.map((placement) => `<i>${placement}</i>`).join('')}</div></div>`;
    grid.append(article);
    handles.push(scheduler.add(article.querySelector('canvas'), definition.id, { palette: palettes[paletteControl.value], motion: motionControl.value, performance: performanceControl.value }));
  });

  function syncStatus() {
    const motionLabel = motionControl.value === 'full' ? 'full motion' : `${motionControl.value} static diagnostic`;
    status.value = `${definitions.length} renderers active · ${motionLabel} · ${performanceControl.value} budget`;
    status.textContent = status.value;
    document.body.dataset.motion = motionControl.value;
    document.body.dataset.performance = performanceControl.value;
  }
  presetControl.addEventListener('change', () => { selectedPreset = presetControl.value; scheduler.invalidate(); syncStatus(); });
  motionControl.addEventListener('change', () => { handles.forEach((handle) => handle.setMotion(motionControl.value)); syncStatus(); });
  performanceControl.addEventListener('change', () => { handles.forEach((handle) => handle.setPerformance(performanceControl.value)); syncStatus(); });
  paletteControl.addEventListener('change', () => { handles.forEach((handle) => handle.setPalette(palettes[paletteControl.value])); syncStatus(); });
  window.addEventListener('resize', () => scheduler.invalidate(), { passive: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) scheduler.stop(); else scheduler.start(); });
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { motionControl.value = 'reduced'; handles.forEach((handle) => handle.setMotion('reduced')); }
  syncStatus();
}());
