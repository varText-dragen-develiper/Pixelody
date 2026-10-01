(function pixelodyWorkspaceModuleRegistryFactory(root, factory) {
  const composition = typeof module === 'object' && module.exports
    ? require('./contract')
    : root.PixelodyWorkspaceCompositionContract;
  const moduleContract = typeof module === 'object' && module.exports
    ? require('./module-contract')
    : root.PixelodyWorkspaceModuleContract;
  const api = factory(composition, moduleContract);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyWorkspaceModuleRegistry = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createWorkspaceModuleRegistryApi(composition, moduleContract) {
  'use strict';

  if (!composition || !moduleContract) throw new Error('Workspace module registry requires the composition and module contracts.');

  const ORIGINS = Object.freeze(['product', 'trusted-runtime']);

  function failure(code, message, details = {}) {
    const error = new Error(message);
    error.code = code;
    Object.assign(error, details);
    return error;
  }

  function assertValidResult(result, code, message) {
    if (!result.valid) throw failure(code, message, { validation: result });
    return result;
  }

  function normalizeConfiguration(value, path) {
    return assertValidResult(
      composition.normalizeConfiguration(value, path),
      'MODULE_CONFIGURATION_INVALID',
      `${path} must contain bounded JSON data.`,
    ).configuration;
  }

  function normalizeFocusRequest(value = {}) {
    const normalized = normalizeConfiguration(value, 'focusRequest');
    const allowed = new Set(['reason', 'target']);
    Object.keys(normalized).forEach((key) => {
      if (!allowed.has(key)) throw failure('MODULE_FOCUS_REQUEST_FIELD_UNKNOWN', `Unknown focus request field "${key}".`);
    });
    const reason = normalized.reason ?? 'programmatic';
    const target = normalized.target ?? 'entry';
    if (typeof reason !== 'string' || !reason.trim()) throw failure('MODULE_FOCUS_REASON_INVALID', 'Focus reason must be non-empty text.');
    if (typeof target !== 'string' || !target.trim()) throw failure('MODULE_FOCUS_TARGET_INVALID', 'Focus target must be non-empty text.');
    return Object.freeze({ reason: reason.trim(), target: target.trim() });
  }

  function createRegistry() {
    const records = new Map();
    const activeRequested = new Map();
    const activeResolved = new Map();
    let sealed = false;
    let catalog = null;

    function register(value, options = {}) {
      if (sealed) throw failure('MODULE_REGISTRY_SEALED', 'The module registry is sealed.');
      const result = moduleContract.normalizeDescriptor(value);
      assertValidResult(result, 'MODULE_DESCRIPTOR_INVALID', 'Module descriptor validation failed.');
      const origin = options.origin || 'product';
      if (!ORIGINS.includes(origin)) throw failure('MODULE_ORIGIN_INVALID', `Unknown module origin "${origin}".`);
      if (result.descriptor.isFallback && origin !== 'product') {
        throw failure('MODULE_FALLBACK_NOT_PRODUCT_OWNED', `Fallback module "${result.descriptor.key}" must be product-owned.`);
      }
      if (records.has(result.descriptor.key)) throw failure('MODULE_KEY_DUPLICATE', `Module "${result.descriptor.key}" is already registered.`);
      records.set(result.descriptor.key, Object.freeze({ descriptor: result.descriptor, origin }));
      return result.descriptor;
    }

    function validateFallback(record) {
      const descriptor = record.descriptor;
      if (descriptor.isFallback) return;
      const fallbackRecord = records.get(descriptor.fallbackKey);
      if (!fallbackRecord) throw failure('MODULE_FALLBACK_MISSING', `Fallback "${descriptor.fallbackKey}" for "${descriptor.key}" is not registered.`);
      if (!fallbackRecord.descriptor.isFallback || fallbackRecord.origin !== 'product') {
        throw failure('MODULE_FALLBACK_NOT_PRODUCT_OWNED', `Fallback "${descriptor.fallbackKey}" for "${descriptor.key}" must be a product-owned fallback.`);
      }
      const missingJobs = descriptor.productJobs.filter((job) => !fallbackRecord.descriptor.productJobs.includes(job));
      if (missingJobs.length) throw failure('MODULE_FALLBACK_JOB_MISMATCH', `Fallback "${descriptor.fallbackKey}" does not preserve jobs: ${missingJobs.join(', ')}.`, { missingJobs: Object.freeze(missingJobs) });
      const missingShapes = Object.keys(descriptor.shapes).filter((shape) => !Object.prototype.hasOwnProperty.call(fallbackRecord.descriptor.shapes, shape));
      if (missingShapes.length) throw failure('MODULE_FALLBACK_SHAPE_MISMATCH', `Fallback "${descriptor.fallbackKey}" does not preserve shapes: ${missingShapes.join(', ')}.`, { missingShapes: Object.freeze(missingShapes) });
      const incompatibleBounds = Object.keys(descriptor.shapes).filter((shape) => {
        const primaryShape = descriptor.shapes[shape];
        const fallbackShape = fallbackRecord.descriptor.shapes[shape];
        return fallbackShape.minInline > primaryShape.minInline
          || fallbackShape.minBlock > primaryShape.minBlock
          || fallbackShape.maxInline < primaryShape.maxInline
          || fallbackShape.maxBlock < primaryShape.maxBlock;
      });
      if (incompatibleBounds.length) throw failure('MODULE_FALLBACK_BOUNDS_MISMATCH', `Fallback "${descriptor.fallbackKey}" cannot occupy the full size envelope for shapes: ${incompatibleBounds.join(', ')}.`, { incompatibleBounds: Object.freeze(incompatibleBounds) });
    }

    function seal() {
      if (sealed) return catalog;
      records.forEach(validateFallback);
      const nextCatalog = Object.create(null);
      [...records.keys()].sort().forEach((key) => {
        const descriptor = records.get(key).descriptor;
        nextCatalog[key] = Object.freeze({
          productJobs: descriptor.productJobs,
          shapes: Object.freeze(Object.keys(descriptor.shapes).sort()),
          instancePolicy: descriptor.instancePolicy,
          targetShape: descriptor.defaultShape,
          defaultConfiguration: descriptor.defaultConfiguration,
        });
      });
      catalog = Object.freeze(nextCatalog);
      sealed = true;
      return catalog;
    }

    function get(key) {
      return records.get(key)?.descriptor || null;
    }

    function count(map, key) {
      return map.get(key) || 0;
    }

    function assertInstanceAvailable(descriptor, map, role) {
      if (descriptor.instancePolicy === 'single' && count(map, descriptor.key) > 0) {
        throw failure('MODULE_INSTANCE_POLICY_VIOLATED', `${role} module "${descriptor.key}" permits only one active instance.`);
      }
    }

    function createLifecycle(descriptor, instanceId, host) {
      const context = moduleContract.createCapabilityContext(descriptor, host, { instanceId });
      let lifecycle;
      try {
        lifecycle = descriptor.create(context);
      } catch (cause) {
        throw failure('MODULE_FACTORY_FAILED', `Module factory "${descriptor.key}" failed.`, { cause });
      }
      const validation = moduleContract.validateLifecycle(lifecycle);
      if (!validation.valid) {
        if (lifecycle && typeof lifecycle.destroy === 'function') {
          try { lifecycle.destroy(); } catch (_ignored) { /* best-effort cleanup of an invalid factory result */ }
        }
        throw failure('MODULE_LIFECYCLE_INVALID', `Module "${descriptor.key}" returned an invalid lifecycle.`, { validation });
      }
      return lifecycle;
    }

    function createInstance(request, host = {}) {
      if (!sealed) throw failure('MODULE_REGISTRY_NOT_SEALED', 'Seal the module registry before creating instances.');
      if (!composition.isPlainRecord(request)) throw failure('MODULE_INSTANCE_REQUEST_INVALID', 'Module instance request must be an object.');
      const allowed = new Set(['moduleKey', 'instanceId', 'configuration', 'layout', 'visibility']);
      Object.keys(request).forEach((key) => {
        if (!allowed.has(key)) throw failure('MODULE_INSTANCE_REQUEST_FIELD_UNKNOWN', `Unknown module instance request field "${key}".`);
      });
      const requested = get(request.moduleKey);
      if (!requested) throw failure('MODULE_UNKNOWN', `Module "${request.moduleKey}" is not registered.`);
      if (!composition.NODE_ID_PATTERN.test(request.instanceId || '')) throw failure('MODULE_INSTANCE_ID_INVALID', 'Module instanceId is invalid.');
      assertInstanceAvailable(requested, activeRequested, 'Requested');
      let configuration = normalizeConfiguration(request.configuration ?? requested.defaultConfiguration, 'module.configuration');
      const initialLayout = assertValidResult(
        moduleContract.normalizeLayoutContext(request.layout ?? { shape: requested.defaultShape }, requested),
        'MODULE_LAYOUT_INVALID',
        `Initial layout for "${requested.key}" is invalid.`,
      ).layout;
      const initialVisibility = assertValidResult(
        moduleContract.normalizeVisibilityState(request.visibility ?? true),
        'MODULE_VISIBILITY_INVALID',
        `Initial visibility for "${requested.key}" is invalid.`,
      ).visibility;

      let descriptor = requested;
      let lifecycle;
      let primaryFailure = null;
      try {
        assertInstanceAvailable(descriptor, activeResolved, 'Resolved');
        lifecycle = createLifecycle(descriptor, request.instanceId, host);
      } catch (cause) {
        primaryFailure = cause;
        if (requested.isFallback) throw cause;
        descriptor = get(requested.fallbackKey);
        try {
          assertInstanceAvailable(descriptor, activeResolved, 'Fallback');
          lifecycle = createLifecycle(descriptor, request.instanceId, host);
        } catch (fallbackFailure) {
          throw failure('MODULE_PRIMARY_AND_FALLBACK_FAILED', `Module "${requested.key}" and fallback "${requested.fallbackKey}" both failed.`, { primaryFailure, fallbackFailure });
        }
      }

      let layout = initialLayout;
      let visibility = initialVisibility;
      let mounted = false;
      let destroyed = false;

      activeRequested.set(requested.key, count(activeRequested, requested.key) + 1);
      activeResolved.set(descriptor.key, count(activeResolved, descriptor.key) + 1);

      function assertAlive() {
        if (destroyed) throw failure('MODULE_INSTANCE_DESTROYED', `Module instance "${request.instanceId}" is destroyed.`);
      }

      function invoke(method, value) {
        assertAlive();
        try {
          return lifecycle[method](value);
        } catch (cause) {
          throw failure('MODULE_LIFECYCLE_FAILED', `Module "${descriptor.key}" failed during ${method}().`, { method, cause });
        }
      }

      const instance = {
        instanceId: request.instanceId,
        requestedKey: requested.key,
        moduleKey: descriptor.key,
        usedFallback: descriptor.key !== requested.key,
        primaryFailure,
        descriptor,
        mount(surface) {
          assertAlive();
          if (mounted) throw failure('MODULE_ALREADY_MOUNTED', `Module instance "${request.instanceId}" is already mounted.`);
          invoke('mount', Object.freeze({ surface, configuration, layout, visibility }));
          mounted = true;
        },
        update(nextConfiguration, cause = 'host') {
          configuration = normalizeConfiguration(nextConfiguration, 'module.configuration');
          invoke('update', Object.freeze({ configuration, cause: String(cause || 'host') }));
          return configuration;
        },
        setLayout(nextLayout) {
          const result = assertValidResult(moduleContract.normalizeLayoutContext(nextLayout, descriptor), 'MODULE_LAYOUT_INVALID', `Layout for "${descriptor.key}" is invalid.`);
          layout = result.layout;
          invoke('setLayout', layout);
          return layout;
        },
        setVisibility(nextVisibility) {
          const result = assertValidResult(moduleContract.normalizeVisibilityState(nextVisibility), 'MODULE_VISIBILITY_INVALID', `Visibility for "${descriptor.key}" is invalid.`);
          visibility = result.visibility;
          invoke('setVisibility', visibility);
          return visibility;
        },
        focus(requestValue = {}) {
          return invoke('focus', normalizeFocusRequest(requestValue));
        },
        serializeConfiguration() {
          const serialized = invoke('serializeConfiguration');
          return normalizeConfiguration(serialized, 'module.serializedConfiguration');
        },
        snapshot() {
          assertAlive();
          return Object.freeze({ configuration, layout, visibility, mounted });
        },
        destroy() {
          if (destroyed) return false;
          try {
            lifecycle.destroy();
          } catch (cause) {
            throw failure('MODULE_LIFECYCLE_FAILED', `Module "${descriptor.key}" failed during destroy().`, { method: 'destroy', cause });
          } finally {
            destroyed = true;
            mounted = false;
            activeRequested.set(requested.key, Math.max(0, count(activeRequested, requested.key) - 1));
            activeResolved.set(descriptor.key, Math.max(0, count(activeResolved, descriptor.key) - 1));
          }
          return true;
        },
      };
      return Object.freeze(instance);
    }

    return Object.freeze({
      register,
      seal,
      get,
      createInstance,
      isSealed: () => sealed,
      catalog: () => catalog,
      keys: () => Object.freeze([...records.keys()].sort()),
    });
  }

  return Object.freeze({ ORIGINS, createRegistry });
}));
