const assert = require('node:assert/strict');
const { createContextFolio } = require('../src/theme-runtime/composition/context-folio');

function element(documentObject, dataset = {}) {
  const attributes = new Map();
  const listeners = {};
  return {
    dataset: { ...dataset },
    hidden: false,
    inert: false,
    id: '',
    _focusable: [],
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    hasAttribute(name) { return attributes.has(name); },
    removeAttribute(name) { attributes.delete(name); },
    addEventListener(type, fn) { listeners[type] = fn; },
    removeEventListener(type, fn) { if (listeners[type] === fn) delete listeners[type]; },
    dispatch(type, event) { listeners[type]?.(event); },
    querySelector(selector) { return selector === '[data-context-folio-close]' ? this._close || null : this._focusable[0] || null; },
    querySelectorAll() { return this._focusable; },
    focus() { documentObject.activeElement = this; },
    closest(selector) { return selector === '[data-context-folio-section]' && this.dataset.contextFolioSection ? this : null; },
    _attributes: attributes,
    _listeners: listeners,
  };
}

(async () => {
  const documentObject = { activeElement: null };
  const technical = element(documentObject, { contextFolioSection: 'technical' });
  const output = element(documentObject, { contextFolioSection: 'output' });
  const triggerRoot = element(documentObject);
  triggerRoot.querySelectorAll = () => [technical, output];
  triggerRoot.contains = (node) => node === technical || node === output;

  const surface = element(documentObject);
  const close = element(documentObject);
  const finalControl = element(documentObject);
  surface._close = close;
  surface._focusable = [close, finalControl];

  const events = { sections: [], closes: [] };
  const folio = createContextFolio({ document: documentObject });
  folio.mount({
    id: 'tc-context-folio',
    triggerRoot,
    surface,
    closeButton: close,
    onSectionChange: (section) => events.sections.push(section),
    onClose: (section, reason) => events.closes.push([section, reason]),
  });

  assert.equal(surface.id, 'tc-context-folio');
  assert.equal(surface.hidden, true);
  assert.equal(surface.inert, true);
  assert.equal(surface.getAttribute('aria-hidden'), 'true');
  assert.equal(technical.getAttribute('aria-expanded'), 'false');

  triggerRoot.dispatch('click', { target: technical, preventDefault() {} });
  await Promise.resolve();
  assert.equal(folio.state().activeSection, 'technical');
  assert.equal(surface.hidden, false);
  assert.equal(surface.inert, false);
  assert.equal(surface.dataset.contextFolioSection, 'technical');
  assert.equal(technical.getAttribute('aria-expanded'), 'true');
  assert.equal(technical.getAttribute('aria-current'), 'page');
  assert.equal(documentObject.activeElement, close);
  assert.deepEqual(events.sections, ['technical']);

  documentObject.activeElement = finalControl;
  let tabPrevented = false;
  surface.dispatch('keydown', { key: 'Tab', shiftKey: false, preventDefault() { tabPrevented = true; } });
  assert.equal(tabPrevented, true);
  assert.equal(documentObject.activeElement, close, 'Tab from the last control must wrap to the first');

  surface.dispatch('keydown', { key: 'Escape', preventDefault() {} });
  await Promise.resolve();
  assert.equal(surface.hidden, true);
  assert.equal(surface.inert, true);
  assert.equal(documentObject.activeElement, technical, 'Escape must restore focus to its portal');
  assert.deepEqual(events.closes.at(-1), ['technical', 'escape']);

  folio.open('output', output);
  await Promise.resolve();
  assert.equal(output.getAttribute('aria-expanded'), 'true');
  close.dispatch('click', { preventDefault() {} });
  await Promise.resolve();
  assert.equal(documentObject.activeElement, output);
  assert.deepEqual(events.closes.at(-1), ['output', 'close-button']);

  assert.throws(() => folio.open('../unsafe', technical), /Invalid Context Folio section/);
  folio.destroy();
  assert.equal(triggerRoot._listeners.click, undefined);
  assert.equal(surface._listeners.keydown, undefined);
  assert.equal(close._listeners.click, undefined);
  assert.equal(folio.state().mounted, false);

  console.log('Context Folio audit passed: presentation-only ownership, one active section, dialog/inert state, portal semantics, Tab containment, Escape/Close dismissal, focus return, input validation, and teardown are intact.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
