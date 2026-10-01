(function pixelodyThemeInstrumentRegistryFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyThemeInstrumentRegistry = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createRegistryApi() {
  'use strict';

  const CONTRACT_VERSION = 1;
  const KEY_PATTERN = /^[a-z][a-z0-9-]{1,47}$/;
  const ROLES = Object.freeze(['aesthetic', 'functional', 'hybrid', 'platform']);
  const RENDERERS = Object.freeze(['css', 'svg', 'dom', 'canvas', 'audio']);
  const COSTS = Object.freeze(['low', 'medium', 'high']);
  const CATEGORY_DEFINITIONS = Object.freeze([
    Object.freeze({ id: 'material-atmosphere', label: 'Visual material + atmosphere', shortLabel: 'Material' }),
    Object.freeze({ id: 'artwork-identity', label: 'Artwork + identity', shortLabel: 'Identity' }),
    Object.freeze({ id: 'truth-information', label: 'Truthful reactive + information', shortLabel: 'Truth' }),
    Object.freeze({ id: 'interaction-control', label: 'Interaction + control', shortLabel: 'Control' }),
    Object.freeze({ id: 'motion-feedback', label: 'Motion + feedback language', shortLabel: 'Feedback' }),
    Object.freeze({ id: 'composition-delivery', label: 'Composition + delivery', shortLabel: 'Composition' }),
  ]);
  const CATEGORY_IDS = new Set(CATEGORY_DEFINITIONS.map((entry) => entry.id));

  function stringArray(value) {
    return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && item.trim().length > 0);
  }

  function validateDescriptor(descriptor) {
    const errors = [];
    if (!descriptor || typeof descriptor !== 'object') return { valid: false, errors: ['Descriptor must be an object.'] };
    if (!KEY_PATTERN.test(descriptor.id || '')) errors.push('id must be lowercase kebab-case, 2-48 characters.');
    if (!CATEGORY_IDS.has(descriptor.category)) errors.push('category must be one of the six registered catalog families.');
    if (typeof descriptor.name !== 'string' || !descriptor.name.trim()) errors.push('name is required.');
    if (typeof descriptor.summary !== 'string' || !descriptor.summary.trim()) errors.push('summary is required.');
    if (!ROLES.includes(descriptor.role)) errors.push('role must be aesthetic, functional, hybrid, or platform.');
    if (!RENDERERS.includes(descriptor.renderer)) errors.push('renderer must be css, svg, dom, canvas, or audio.');
    if (!COSTS.includes(descriptor.cost)) errors.push('cost must be low, medium, or high.');
    if (!stringArray(descriptor.placements)) errors.push('placements must contain at least one product-owned placement key.');
    if (!Array.isArray(descriptor.inputs)) errors.push('inputs must be an array, even when empty.');
    if (!Array.isArray(descriptor.jobs)) errors.push('jobs must be an array, even when empty.');
    if (typeof descriptor.fallback !== 'string' || !descriptor.fallback.trim()) errors.push('fallback must describe safe behavior.');
    if (typeof descriptor.accessibility !== 'string' || !descriptor.accessibility.trim()) errors.push('accessibility must describe the non-visual contract.');
    if (typeof descriptor.create !== 'function') errors.push('create must be a lifecycle factory.');
    return { valid: errors.length === 0, errors };
  }

  function validateLifecycle(module) {
    const errors = [];
    ['mount', 'update', 'destroy'].forEach((method) => {
      if (typeof module?.[method] !== 'function') errors.push(`lifecycle.${method} must be a function.`);
    });
    return { valid: errors.length === 0, errors };
  }

  function freezeDescriptor(descriptor) {
    return Object.freeze({
      ...descriptor,
      jobs: Object.freeze(descriptor.jobs.slice()),
      inputs: Object.freeze(descriptor.inputs.slice()),
      placements: Object.freeze(descriptor.placements.slice()),
      contractVersion: CONTRACT_VERSION,
    });
  }

  function createRegistry() {
    const entries = new Map();
    function register(descriptor) {
      const validation = validateDescriptor(descriptor);
      if (!validation.valid) throw new Error(`Invalid theme instrument:\n- ${validation.errors.join('\n- ')}`);
      if (entries.has(descriptor.id)) throw new Error(`Theme instrument "${descriptor.id}" is already registered.`);
      const probe = descriptor.create();
      const lifecycle = validateLifecycle(probe);
      try { probe?.destroy?.(); } catch {}
      if (!lifecycle.valid) throw new Error(`Theme instrument "${descriptor.id}" has an invalid lifecycle:\n- ${lifecycle.errors.join('\n- ')}`);
      entries.set(descriptor.id, freezeDescriptor(descriptor));
      return true;
    }
    function get(id) { return entries.get(String(id)) || null; }
    function has(id) { return entries.has(String(id)); }
    function list() { return [...entries.values()]; }
    function listByCategory(category) { return list().filter((entry) => entry.category === category); }
    function create(id) {
      const descriptor = get(id);
      if (!descriptor) return null;
      const module = descriptor.create();
      const validation = validateLifecycle(module);
      if (!validation.valid) throw new Error(`Theme instrument "${id}" lifecycle became invalid.`);
      return module;
    }
    function clear() { entries.clear(); }
    return Object.freeze({ register, get, has, list, listByCategory, create, clear });
  }

  return Object.freeze({ CATEGORY_DEFINITIONS, CONTRACT_VERSION, COSTS, RENDERERS, ROLES, createRegistry, validateDescriptor, validateLifecycle });
}));
