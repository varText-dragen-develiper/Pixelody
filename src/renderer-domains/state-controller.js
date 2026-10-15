(function pixelodyStateControllerFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyStateController = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createStateControllerApi() {
  'use strict';

  function createStateController(options = {}) {
    const desktop = options.desktop || null;
    const initialLoad = options.initialLoad || { status: 'unavailable', readOnly: true, state: null, diagnostics: null };
    const getValues = typeof options.getValues === 'function' ? options.getValues : () => ({});
    const malformedLegacyKeys = Array.isArray(options.malformedLegacyKeys) ? options.malformedLegacyKeys : [];
    const now = typeof options.now === 'function' ? options.now : () => new Date();
    const clock = typeof options.clock === 'function' ? options.clock : () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    // Browser timer functions are Web API methods. Storing them directly on a
    // plain object and invoking `timers.setTimeout(...)` gives them that object
    // as `this`, which Chromium rejects with "Illegal invocation". Wrappers
    // preserve normal global timer invocation while keeping timers injectable.
    const timers = options.timers || {
      setTimeout: (...args) => setTimeout(...args),
      clearTimeout: (...args) => clearTimeout(...args),
    };
    let writeTimer = 0;
    // Settles after the most recently requested write.
    let writeChain = Promise.resolve();
    // A snapshot carries the current value of every key its reason needs, so
    // while one is in flight any number of new requests collapse into a single
    // follow-up snapshot (with merged reasons), captured when it starts. Bursts
    // of persist() calls then cost one extra IPC write instead of one per call.
    let activeWrite = null;
    let followUpWrite = null;
    let followUpReason = '';
    let suspended = false;
    const runtime = {
      status: initialLoad.status || 'unknown',
      readOnly: initialLoad.readOnly === true,
      diagnostics: initialLoad.diagnostics || null,
      lastWriteAt: '',
      lastWriteMs: 0,
      lastWriteBytes: 0,
      lastWriteLargestKey: '',
      lastWriteLargestKeyBytes: 0,
      lastWriteReason: '',
      lastError: '',
      revision: Number(initialLoad.state?.revision) || 0,
      coalescedWrites: 0,
      malformedLegacyKeys,
    };

    // Combines the reasons of requests that one write will serve. getValues()
    // may return a trimmed payload for some reasons (frequent, library-unrelated
    // saves), so a combined write must use a reason that covers every request;
    // otherwise a trimmed save could silently replace a pending full one. The
    // renderer knows which reasons trim and can supply a finer rule; this
    // default keeps a reason only when all requests agree.
    const mergeReasons = typeof options.mergeReasons === 'function'
      ? options.mergeReasons
      : (pending, next) => (!pending || pending === next ? next : 'coalesced-persist');
    let scheduledReason = '';

    // Rough UTF-16 byte estimate, matching the ×2 approximation the renderer
    // uses for localStorage sizing. Diagnostics only, recorded once per write
    // actually sent; a single serialization pass yields the per-key sizes and
    // the total is derived from them instead of serializing everything twice.
    function recordWriteSize(values, reason) {
      runtime.lastWriteReason = String(reason || '');
      let chars = 2;
      let entries = 0;
      let largest = { key: '', bytes: 0 };
      for (const [key, value] of Object.entries(values || {})) {
        let json;
        try { json = JSON.stringify(value); } catch { json = undefined; }
        if (json === undefined) continue;
        chars += JSON.stringify(key).length + 1 + json.length;
        entries += 1;
        if (json.length * 2 > largest.bytes) largest = { key, bytes: json.length * 2 };
      }
      runtime.lastWriteBytes = (chars + Math.max(0, entries - 1)) * 2;
      runtime.lastWriteLargestKey = largest.key;
      runtime.lastWriteLargestKeyBytes = largest.bytes;
    }

    function applyResult(result, startedAt) {
      runtime.lastWriteMs = Math.max(0, clock() - startedAt);
      if (!result?.ok) {
        runtime.lastError = result?.error || result?.status || 'Durable state write failed.';
        return result;
      }
      runtime.status = result.status || 'committed';
      runtime.diagnostics = result.diagnostics || runtime.diagnostics;
      runtime.revision = Number(result.state?.revision) || runtime.revision;
      runtime.lastWriteAt = now().toISOString();
      runtime.lastError = '';
      return result;
    }

    // Values are captured when the write starts. The returned promise never
    // rejects, so follow-ups chained on it always run.
    function startWrite(send, failureStatus, reason, after = null) {
      const values = getValues(reason);
      recordWriteSize(values, reason);
      const write = Promise.resolve(after).then(async () => {
        const startedAt = clock();
        return applyResult(await send(values), startedAt);
      }).catch((error) => {
        runtime.lastError = error?.message || String(error);
        return { ok: false, status: failureStatus, error: runtime.lastError };
      });
      activeWrite = write;
      write.then(() => { if (activeWrite === write) activeWrite = null; });
      writeChain = write;
      return write;
    }

    function sendSnapshot(reason) {
      return startWrite((values) => desktop.saveStateSnapshot(values, { reason }), 'write-error', reason);
    }

    function enqueue(reason = 'renderer-persist') {
      if (runtime.readOnly || suspended || typeof desktop?.saveStateSnapshot !== 'function') return writeChain;
      if (!activeWrite) return sendSnapshot(reason);
      if (followUpWrite) {
        followUpReason = mergeReasons(followUpReason, reason);
        runtime.coalescedWrites += 1;
        return followUpWrite;
      }
      followUpReason = reason;
      const followUp = activeWrite.then(() => {
        // flush() already sent a newer snapshot that covers this request.
        if (followUpWrite !== followUp) return activeWrite || writeChain;
        followUpWrite = null;
        return suspended ? { ok: false, status: 'suspended' } : sendSnapshot(followUpReason);
      });
      followUpWrite = followUp;
      writeChain = followUp;
      return followUp;
    }

    function schedule(delay = 420, reason = 'renderer-persist') {
      if (runtime.readOnly || suspended) return;
      scheduledReason = writeTimer ? mergeReasons(scheduledReason, reason) : reason;
      timers.clearTimeout(writeTimer);
      writeTimer = timers.setTimeout(() => {
        writeTimer = 0;
        enqueue(scheduledReason);
      }, Math.max(0, Number(delay) || 0));
    }

    function initialize() {
      if (runtime.readOnly) return Promise.resolve({ ok: false, status: runtime.status });
      if (!initialLoad.needsLegacyMigration) return writeChain;
      if (typeof desktop?.migrateLegacyState !== 'function') {
        runtime.lastError = 'Legacy migration bridge is unavailable.';
        return Promise.resolve({ ok: false, status: 'migration-unavailable', error: runtime.lastError });
      }
      return startWrite((values) => desktop.migrateLegacyState(values, malformedLegacyKeys), 'migration-error', undefined, followUpWrite || activeWrite);
    }

    // Used when the window is closing: the snapshot is sent now rather than
    // queued behind an in-flight write, because a queued follow-up would not
    // survive unload. The main process commits writes in arrival order.
    function flush(reason = 'flush-persist') {
      // The flush replaces any scheduled or queued write, so it must cover them.
      let combined = reason;
      if (writeTimer) {
        combined = mergeReasons(scheduledReason, combined);
        timers.clearTimeout(writeTimer);
        writeTimer = 0;
      }
      if (followUpWrite) combined = mergeReasons(followUpReason, combined);
      if (runtime.readOnly || suspended || typeof desktop?.saveStateSnapshot !== 'function') return writeChain;
      followUpWrite = null;
      return sendSnapshot(combined);
    }

    function pending() {
      return Boolean(writeTimer || followUpWrite);
    }

    // Stops all further writes, including queued follow-ups. Used after a
    // backup restore has replaced durable state and the window is reloading,
    // so the stale in-memory state cannot overwrite the restored data.
    function suspend() {
      suspended = true;
      timers.clearTimeout(writeTimer);
      writeTimer = 0;
    }

    // Undoes suspend() when the operation it guarded did not happen (a restore
    // the main process refused), so the window keeps saving normally.
    function resume() {
      suspended = false;
    }

    return Object.freeze({ runtime, enqueue, schedule, initialize, flush, pending, suspend, resume });
  }

  return Object.freeze({ createStateController });
}));
