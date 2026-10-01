(function pixelodyPlaybackControllerFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyPlaybackController = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createPlaybackControllerApi() {
  'use strict';
  function buildQueue(tracks = [], startId = '') {
    const ids = tracks.map((track) => String(track?.id || '')).filter(Boolean);
    const start = ids.indexOf(String(startId || ''));
    return start > 0 ? ids.slice(start).concat(ids.slice(0, start)) : ids;
  }
  function activeQueue(queueIds = [], tracks = []) {
    const byId = new Map(tracks.map((track) => [track.id, track]));
    return queueIds.map((id) => byId.get(id)).filter(Boolean);
  }
  function linearAdjacent(queue = [], currentId = '', offset = 1, options = {}) {
    if (!queue.length) return null;
    const index = Math.max(0, queue.findIndex((track) => track.id === currentId));
    const nextIndex = index + Number(offset || 0);
    if (nextIndex >= queue.length && options.fromEnded && options.repeat === 'off') return null;
    return queue[(nextIndex + queue.length) % queue.length] || null;
  }
  function normalizeSession(session = null) {
    if (!session || typeof session !== 'object') return null;
    return {
      id: typeof session.id === 'string' ? session.id : '',
      time: Math.max(0, Number(session.time) || 0),
      volume: Math.max(0, Math.min(1, Number(session.volume) || 0)),
    };
  }
  function shouldTriggerTransition(currentTime = 0, duration = 0, crossfadeDuration = 0) {
    const cur = Math.max(0, Number(currentTime) || 0);
    const dur = Math.max(0, Number(duration) || 0);
    const xfade = Math.max(0, Number(crossfadeDuration) || 0);
    if (dur <= 0 || xfade <= 0 || dur <= xfade) return false;
    return cur >= (dur - xfade);
  }
  function calculateTransitionProgress(currentTime = 0, duration = 0, crossfadeDuration = 0) {
    const cur = Math.max(0, Number(currentTime) || 0);
    const dur = Math.max(0, Number(duration) || 0);
    const xfade = Math.max(0, Number(crossfadeDuration) || 0);
    if (dur <= 0 || xfade <= 0) return 0;
    const triggerTime = Math.max(0, dur - xfade);
    if (cur < triggerTime) return 0;
    if (cur >= dur) return 1;
    return Math.max(0, Math.min(1, (cur - triggerTime) / xfade));
  }
  function createTransitionState(options = {}) {
    return {
      mode: options.mode || 'gapless',
      duration: Math.max(0, Number(options.duration) || 0),
      isTransitioning: Boolean(options.isTransitioning),
      progress: Math.max(0, Math.min(1, Number(options.progress) || 0)),
      outgoingTrackId: String(options.outgoingTrackId || ''),
      incomingTrackId: String(options.incomingTrackId || ''),
      outgoingGain: Math.max(0, Math.min(1, Number(options.outgoingGain ?? 1))),
      incomingGain: Math.max(0, Math.min(1, Number(options.incomingGain ?? 0))),
    };
  }
  return Object.freeze({ activeQueue, buildQueue, calculateTransitionProgress, createTransitionState, linearAdjacent, normalizeSession, shouldTriggerTransition });
}));
