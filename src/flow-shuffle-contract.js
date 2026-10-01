(function flowShuffleContractFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyFlowShuffleContract = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createFlowShuffleContract() {
  'use strict';
  const VERSION = 1;
  const MODES = new Set(['flow', 'discovery', 'comfort', 'energy', 'genre-weave', 'deep-library']);
  const SHAPES = new Set(['auto', 'steady', 'rise', 'wave', 'wind-down']);
  const unique = (values) => [...new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean))];
  function normalizeSnapshot(source = {}) {
    const plan = source.plan && typeof source.plan === 'object' ? source.plan : {};
    const session = source.session && typeof source.session === 'object' ? source.session : {};
    return {
      version: VERSION,
      enabled: source.enabled === true,
      mode: MODES.has(source.mode) ? source.mode : 'flow',
      session: {
        horizon: Math.max(5, Math.min(10, Math.round(Number(session.horizon) || 6))),
        energyShape: SHAPES.has(session.energyShape) ? session.energyShape : 'auto',
        albumPolicy: session.albumPolicy === 'album' ? 'album' : 'track',
        preserveAlbumRuns: session.preserveAlbumRuns === true,
      },
      plan: {
        style: plan.style === 'standard' ? 'standard' : 'flow',
        seed: String(plan.seed || ''),
        generation: Math.max(0, Math.round(Number(plan.generation) || 0)),
        cursor: Math.max(-1, Math.round(Number(plan.cursor) || 0)),
        sourceQueueIds: unique(plan.sourceQueueIds),
        order: unique(plan.order),
        future: unique(plan.future),
        priorityIds: unique(source.priorityIds),
      },
    };
  }
  function publicSnapshot(source, publicIdFor) {
    const normalized = normalizeSnapshot(source);
    const publicId = typeof publicIdFor === 'function' ? publicIdFor : (id) => id;
    const mapIds = (ids) => ids.map(publicId).filter(Boolean);
    return {
      ...normalized,
      plan: {
        ...normalized.plan,
        sourceQueueIds: mapIds(normalized.plan.sourceQueueIds),
        order: mapIds(normalized.plan.order),
        future: mapIds(normalized.plan.future),
        priorityIds: mapIds(normalized.plan.priorityIds),
      },
    };
  }
  function commandPayload(body = {}) {
    const action = String(body.action || body.command || '').toLowerCase();
    if (!['setenabled', 'setmode', 'setsession'].includes(action)) throw Object.assign(new Error('Unsupported shuffle command.'), { statusCode: 400, code: 'unsupported_shuffle_command' });
    const payload = { version: VERSION, action };
    if (action === 'setenabled') payload.enabled = body.enabled === true;
    if (action === 'setmode') {
      if (!MODES.has(body.mode)) throw Object.assign(new Error('Shuffle mode is invalid.'), { statusCode: 400, code: 'invalid_shuffle_mode' });
      payload.mode = body.mode;
    }
    if (action === 'setsession') payload.session = normalizeSnapshot({ session: body.session }).session;
    return payload;
  }
  return Object.freeze({ VERSION, commandPayload, normalizeSnapshot, publicSnapshot });
}));
