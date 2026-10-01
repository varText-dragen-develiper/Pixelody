const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
function extract(pattern, label) {
  const match = renderer.match(pattern);
  assert.ok(match, `renderer.js no longer defines ${label}`);
  return match[0];
}

// Space toggles playback without stealing activation from focused controls or
// from navigation mechanics that already handled the key.
const source = [
  extract(/const SPACE_OWNING_TARGETS = '[^']+';/, 'SPACE_OWNING_TARGETS'),
  extract(/function spaceIsPlaybackKey\(event\) \{[\s\S]*?\n\}/, 'spaceIsPlaybackKey'),
].join('\n');
const context = {};
vm.createContext(context);
vm.runInContext(`${source}; this.spaceIsPlaybackKey = spaceIsPlaybackKey;`, context);
// Each fake target lists the selectors it matches, so closest() behaves like
// the DOM for the owning-target list without needing a browser.
const target = (...matches) => ({ closest: (selector) => selector.split(',').some((part) => matches.includes(part)) });
const press = (eventTarget, extra = {}) => context.spaceIsPlaybackKey({ code: 'Space', repeat: false, defaultPrevented: false, target: eventTarget, ...extra });

assert.equal(press(target()), true, 'Space on the page toggles playback');
assert.equal(press(target('button')), false, 'Space on a focused button activates the button instead');
assert.equal(press(target('[role="option"]')), false, 'Space on a focused track row stays with the row');
assert.equal(press(target('a[href]')), false, 'Space on a focused link is left alone');
assert.equal(press(target('summary')), false, 'Space on a focused disclosure is left alone');
for (const role of ['button', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'checkbox', 'radio', 'switch', 'tab', 'slider']) {
  assert.equal(press(target(`[role="${role}"]`)), false, `Space on role=${role} belongs to that control`);
}
assert.equal(press(target(), { defaultPrevented: true }), false, 'a mechanic that handled Space is not followed by a second toggle');
assert.equal(press(target(), { code: 'Enter' }), false, 'only Space is the playback key');
assert.equal(press(target(), { repeat: true }), true, 'held Space is still consumed so the page does not scroll');
assert.match(renderer, /if \(spaceIsPlaybackKey\(event\)\) \{ event\.preventDefault\(\); if \(!event\.repeat\) \$\('#playButton'\)\.click\(\); \}/, 'a held Space must toggle playback only once');

console.log('Space-key audit passed: Space toggles playback on the page without taking activation from focused controls, and a held Space toggles once.');
