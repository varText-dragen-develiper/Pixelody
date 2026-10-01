(function pixelodyConfirmedOutputTransitionFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyConfirmedOutputTransition = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createConfirmedOutputTransitionModule() {
  'use strict';

  function createConfirmedOutputTransition(options = {}) {
    const now = typeof options.now === 'function' ? options.now : () => Date.now();
    let activeId = options.activeId || null;
    let published = {
      activeId,
      source: '',
      paused: true,
      currentTime: 0,
      ...(options.published || {}),
    };
    let pending = null;
    let failedId = null;
    let eventSequence = 0;
    const events = [];

    function record(type, detail = {}) {
      const event = {
        sequence: ++eventSequence,
        at: now(),
        type,
        ...detail,
        activeId,
        pendingId: pending?.requestedId || null,
        requestSerial: pending?.requestSerial || null,
        failedId,
        published: { ...published },
      };
      events.push(event);
      if (events.length > 240) events.splice(0, events.length - 240);
      return event;
    }

    function snapshot() {
      return {
        activeId,
        pending: pending ? { ...pending } : null,
        failedId,
        published: { ...published },
        events: events.map((event) => ({ ...event })),
      };
    }

    function syncActive(id, reason = 'host-sync') {
      activeId = id || null;
      record('active-synced', { reason });
      return snapshot();
    }

    function syncPublished(next = {}, reason = 'host-published-sync') {
      if (pending) {
        record('pending-published-sync-ignored', { reason, ignoredPublished: { ...next } });
        return snapshot();
      }
      published = {
        ...published,
        ...next,
        activeId: Object.prototype.hasOwnProperty.call(next, 'activeId') ? (next.activeId || null) : activeId,
        paused: Object.prototype.hasOwnProperty.call(next, 'paused') ? Boolean(next.paused) : Boolean(published.paused),
      };
      activeId = published.activeId;
      record('published-synced', { reason });
      return snapshot();
    }

    function begin(requestedId, requestSerial, detail = {}) {
      if (!requestedId) throw new Error('Confirmed output transition requires a requested ID.');
      if (!Number.isFinite(Number(requestSerial))) throw new Error('Confirmed output transition requires a numeric request serial.');
      const previousPublished = { ...published, activeId, paused: true };
      published = previousPublished;
      pending = { requestedId, requestSerial: Number(requestSerial), previousPublished, ...detail };
      failedId = null;
      record('request-began');
      return snapshot();
    }

    function matches(requestSerial) {
      return Boolean(pending && pending.requestSerial === Number(requestSerial));
    }

    function note(type, requestSerial, detail = {}) {
      if (!matches(requestSerial)) {
        record('stale-event-ignored', { ignoredType: type, ignoredRequestSerial: Number(requestSerial), ...detail });
        return { accepted: false, snapshot: snapshot() };
      }
      record(type, detail);
      return { accepted: true, snapshot: snapshot() };
    }

    function observe(type, detail = {}) {
      record(type, detail);
      return snapshot();
    }

    function confirm(requestSerial, detail = {}) {
      if (!matches(requestSerial)) {
        record('stale-confirmation-ignored', { ignoredRequestSerial: Number(requestSerial), ...detail });
        return { committed: false, snapshot: snapshot() };
      }
      const requestedId = pending.requestedId;
      const requestedSource = detail.source || pending.requestedSource || '';
      activeId = requestedId;
      published = {
        ...published,
        activeId: requestedId,
        source: requestedSource,
        paused: Object.prototype.hasOwnProperty.call(detail, 'paused') ? Boolean(detail.paused) : false,
        currentTime: Number.isFinite(Number(detail.currentTime)) ? Number(detail.currentTime) : 0,
      };
      pending = null;
      failedId = null;
      record('request-confirmed', { committedId: requestedId, ...detail });
      return { committed: true, activeId, snapshot: snapshot() };
    }

    function fail(requestSerial, detail = {}) {
      if (!matches(requestSerial)) {
        record('stale-failure-ignored', { ignoredRequestSerial: Number(requestSerial), ...detail });
        return { failed: false, snapshot: snapshot() };
      }
      const requestedId = pending.requestedId;
      published = { ...pending.previousPublished, activeId, paused: true };
      failedId = requestedId;
      pending = null;
      record('request-failed', { requestedId, retainedActiveId: activeId, ...detail });
      return { failed: true, failedId, activeId, snapshot: snapshot() };
    }

    function cancel(requestSerial, detail = {}) {
      if (!matches(requestSerial)) return { cancelled: false, snapshot: snapshot() };
      const requestedId = pending.requestedId;
      pending = null;
      record('request-cancelled', { requestedId, retainedActiveId: activeId, ...detail });
      return { cancelled: true, activeId, snapshot: snapshot() };
    }

    return Object.freeze({ snapshot, syncActive, syncPublished, begin, note, observe, confirm, fail, cancel });
  }

  return Object.freeze({ createConfirmedOutputTransition });
}));
