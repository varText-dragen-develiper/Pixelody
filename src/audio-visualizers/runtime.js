(function pixelodyVisualizerRuntimeFactory(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./renderers.js'), require('./signal-frame.js'));
  else if (root) root.PixelodyVisualizerRuntime = factory(root.PixelodyVisualizerRenderers, root.PixelodyVisualizerSignal);
}(typeof globalThis !== 'undefined' ? globalThis : this, function createRuntimeApi(renderersApi, signalApi) {
  'use strict';

  if (!renderersApi || !signalApi) throw new Error('Visualizer runtime requires renderer and signal modules.');

  const DEFAULT_PALETTE = Object.freeze({ background: '#07090d', primary: '#7cf3d0', secondary: '#8e7dff', highlight: '#fff3a8', muted: '#72808f' });
  const MOTION_STATES = Object.freeze(['full', 'reduced', 'off']);
  const PERFORMANCE_STATES = Object.freeze(['full', 'conserve']);

  function normalizePalette(palette = {}) { return Object.freeze({ ...DEFAULT_PALETTE, ...palette }); }
  function normalizeMotion(value) { return MOTION_STATES.includes(value) ? value : 'full'; }
  function normalizePerformance(value) { return PERFORMANCE_STATES.includes(value) ? value : 'full'; }

  function fitCanvas(canvas, performance = 'full', forcedSize = null) {
    const rect = forcedSize || canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || canvas.clientWidth || canvas.width || 320));
    const height = Math.max(1, Math.round(rect.height || canvas.clientHeight || canvas.height || 180));
    const deviceScale = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    const scale = performance === 'conserve' ? 1 : Math.min(2, Math.max(1, deviceScale));
    const pixelWidth = Math.round(width * scale); const pixelHeight = Math.round(height * scale);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('A 2D canvas context is required.');
    context.setTransform(scale, 0, 0, scale, 0, 0);
    return { context, width, height, scale };
  }

  function createInstance(canvas, rendererId, options = {}) {
    if (!canvas || typeof canvas.getContext !== 'function') throw new Error('Visualizer instance requires a canvas element.');
    const renderer = renderersApi.getRenderer(rendererId);
    if (!renderer) throw new Error(`Unknown visualizer renderer: ${rendererId}`);
    const instance = {
      canvas,
      renderer,
      state: Object.create(null),
      palette: normalizePalette(options.palette),
      motion: normalizeMotion(options.motion),
      performance: normalizePerformance(options.performance),
      visible: options.visible !== false,
      forcedSize: options.size || null,
      dirty: true,
      lastRenderedAt: 0,
    };
    canvas.dataset.visualizer = renderer.id;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', options.label || `${renderer.name} audio visualization. Decorative; playback controls and status are available elsewhere.`);
    return instance;
  }

  function createScheduler(options = {}) {
    const requestFrame = options.requestFrame || ((callback) => requestAnimationFrame(callback));
    const cancelFrame = options.cancelFrame || ((handle) => cancelAnimationFrame(handle));
    const instances = new Set();
    let frameHandle = 0;
    let lastTick = 0;
    let currentFrame = signalApi.makeSignalFrame();
    let frameSource = typeof options.frameSource === 'function' ? options.frameSource : null;
    let stopped = false;

    function targetInterval(instance) {
      if (instance.motion !== 'full') return Infinity;
      if (instance.performance === 'conserve') return instance.renderer.complexity === 'high' ? 100 : 66.67;
      if (instance.renderer.complexity === 'high') return 33.33;
      return 16.67;
    }

    function renderInstance(instance, timestamp, delta, force = false) {
      if (!instance.visible) return false;
      const interval = targetInterval(instance);
      if (!force && !instance.dirty && timestamp - instance.lastRenderedAt < interval) return false;
      const fitted = fitCanvas(instance.canvas, instance.performance, instance.forcedSize);
      const safeTimestamp = instance.motion === 'full' ? timestamp : 0;
      const frame = instance.motion === 'full' ? currentFrame : { ...currentFrame, timestamp: 0, beat: 0, flux: 0 };
      fitted.context.save();
      try {
        instance.renderer.render({ ctx: fitted.context, width: fitted.width, height: fitted.height, scale: fitted.scale, frame, palette: instance.palette, state: instance.state, delta: instance.motion === 'full' ? delta : 0, timestamp: safeTimestamp, quality: instance.performance });
      } finally {
        fitted.context.restore();
      }
      instance.lastRenderedAt = timestamp;
      instance.dirty = false;
      return true;
    }

    function isDocumentVisible() {
      return typeof document === 'undefined' || !document.hidden;
    }

    function needsContinuousFrames() {
      return isDocumentVisible() && [...instances].some((instance) => instance.visible && instance.motion === 'full');
    }

    function schedule() {
      if (stopped || frameHandle || !instances.size) return;
      if (!isDocumentVisible() && ![...instances].some((instance) => instance.visible && instance.dirty)) return;
      frameHandle = requestFrame(tick);
    }
    function tick(timestamp = 0) {
      frameHandle = 0;
      const delta = lastTick ? Math.min(100, Math.max(0, timestamp - lastTick)) : 16.67;
      lastTick = timestamp;
      const hasDirtyInstance = [...instances].some((instance) => instance.visible && instance.dirty);
      if (frameSource && (needsContinuousFrames() || hasDirtyInstance)) currentFrame = signalApi.makeSignalFrame(frameSource(timestamp));
      instances.forEach((instance) => renderInstance(instance, timestamp, delta, instance.dirty));
      if (needsContinuousFrames()) schedule();
    }
    function invalidate(instance) { if (instance) instance.dirty = true; else instances.forEach((item) => { item.dirty = true; }); schedule(); }

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) invalidate();
      });
    }
    function add(canvas, rendererId, instanceOptions = {}) {
      const instance = createInstance(canvas, rendererId, instanceOptions);
      instances.add(instance); invalidate(instance);
      return Object.freeze({
        id: rendererId,
        updateFrame(frame) { currentFrame = signalApi.makeSignalFrame(frame); invalidate(instance); },
        setMotion(value) { instance.motion = normalizeMotion(value); invalidate(instance); },
        setPerformance(value) { instance.performance = normalizePerformance(value); invalidate(instance); },
        setPalette(value) { instance.palette = normalizePalette(value); invalidate(instance); },
        setVisible(value) { instance.visible = value !== false; invalidate(instance); },
        resize(size = null) { instance.forcedSize = size; invalidate(instance); },
        renderNow(timestamp = 0) { renderInstance(instance, timestamp, 0, true); },
        destroy() { instances.delete(instance); instance.state = Object.create(null); if (!instances.size && frameHandle) { cancelFrame(frameHandle); frameHandle = 0; } },
      });
    }
    function pushFrame(frame) { currentFrame = signalApi.makeSignalFrame(frame); invalidate(); }
    function setFrameSource(source) { frameSource = typeof source === 'function' ? source : null; invalidate(); }
    function stop() { stopped = true; if (frameHandle) cancelFrame(frameHandle); frameHandle = 0; }
    function start() { stopped = false; invalidate(); }
    function snapshot() { return Object.freeze({ instanceCount: instances.size, running: !stopped && Boolean(frameHandle || needsContinuousFrames()), continuousCount: [...instances].filter((item) => item.visible && item.motion === 'full').length }); }
    return Object.freeze({ add, invalidate, pushFrame, setFrameSource, snapshot, start, stop });
  }

  return Object.freeze({ DEFAULT_PALETTE, MOTION_STATES, PERFORMANCE_STATES, createScheduler, fitCanvas, normalizePalette });
}));
