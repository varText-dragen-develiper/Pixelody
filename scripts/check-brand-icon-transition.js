'use strict';
const assert = require('node:assert/strict');
const { transitionBitmap, createBrandIconAnimator } = require('../src/brand-icon-transition');
const { validateIpcArguments } = require('../src/electron-security');
const size = { width: 32, height: 32 }, base = Buffer.alloc(32 * 32 * 4);
for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
  const mark = Math.hypot(x - 15.5, y - 15.5) < 11 && !(y === 15 || y === 16);
  base.set(mark ? [255, 61, 106, 255] : [18, 15, 14, 255], (y * 32 + x) * 4);
}
for (const effect of ['sweep', 'quest']) {
  assert.deepEqual(transitionBitmap(base, base, size, '#ff1438', 0, effect), base, 'Start pixels must be unchanged.');
  const frames = new Set();
  for (let frame = 0; frame <= 66; frame++) {
    const bitmap = transitionBitmap(base, base, size, '#ff1438', frame / 66, effect);
    frames.add(bitmap.toString('hex'));
    for (let i = 0; i < base.length; i += 4) {
      assert.equal(bitmap[i + 3], base[i + 3], 'Animation cannot change alpha.');
      if (base[i] === 18) assert.deepEqual(bitmap.subarray(i, i + 4), base.subarray(i, i + 4), 'Tile and wave cut must stay fixed.');
      else if (frame === 66) assert.deepEqual([...bitmap.subarray(i, i + 3)], [56, 20, 255], 'Final mark must be exactly the new color.');
    }
  }
  assert.ok(frames.size >= 45, 'The slower transition must contain enough distinct intermediate frames.');
  assert.equal(validateIpcArguments('app:set-brand-icon', ['ultraviolet', '#ff1438', effect]).ok, true);
}
for (const args of [['ultraviolet', '', {}], ['ultraviolet', '', 'file:///icon'], ['ultraviolet', '', 'quest', 1000], ['ultraviolet', null, 'sweep']]) {
  assert.equal(validateIpcArguments('app:set-brand-icon', args).ok, false, 'Reject arbitrary transition payloads.');
}
const image = bytes => ({ toBitmap: () => Buffer.from(bytes), getSize: () => size, isEmpty: () => false });
(async () => {
  const painted = [], waits = [];
  const window = { isDestroyed: () => false, setIcon: value => painted.push(value) };
  const animator = createBrandIconAnimator({ nativeImage: { createFromBitmap: image }, getBaseImage: () => image(base), windows: () => [window, null], platform: 'win32', now: () => 0, wait: () => new Promise(resolve => waits.push(resolve)) });
  const purple = image(base), red = image(transitionBitmap(base, base, size, '#ff1438', 1, 'sweep'));
  assert.equal((await animator.apply({ image: purple, color: '#6a3dff', effect: 'sweep' })).frames, 0, 'Startup must not animate.');
  const old = animator.apply({ image: red, color: '#ff1438', effect: 'quest' });
  assert.equal(waits.length, 1);
  assert.equal((await animator.apply({ image: purple, color: '#6a3dff', effect: 'none' })).frames, 0, 'Reduced motion must settle immediately.');
  waits.shift()();
  assert.equal((await old).cancelled, true, 'Superseded frames cannot overwrite the newest color.');
  assert.equal(painted.at(-1), purple);
  const direct = createBrandIconAnimator({ nativeImage: { createFromBitmap: image }, getBaseImage: () => image(base), windows: () => [window], platform: 'win32', wait: async () => {} });
  await direct.apply({ image: purple, color: '#6a3dff' });
  assert.equal((await direct.apply({ image: red, color: '#ff1438', effect: 'sweep' })).frames, 66);
  assert.equal(painted.at(-1), red, 'Use the exact final image rather than an approximation.');
  let starts = 0, current = true;
  await direct.apply({ image: red, color: '#ff1438', effect: 'sweep', onStart: async () => starts++ });
  assert.equal(starts, 0, 'Unchanged colors never enter a temporary taskbar group.');
  assert.equal((await direct.apply({ image: purple, color: '#6a3dff', effect: 'sweep', onStart: async () => { starts++; current = false; }, isCurrent: () => current })).cancelled, true);
  assert.equal(starts, 1);
  assert.equal(painted.at(-1), red, 'A request superseded during native setup cannot paint stale frames.');
  let clock = 0;
  const frameTimes = [];
  const paced = createBrandIconAnimator({ nativeImage: { createFromBitmap: image }, getBaseImage: () => image(base), windows: () => [{ isDestroyed: () => false, setIcon: () => frameTimes.push(clock) }], platform: 'win32', now: () => clock, wait: async ms => { assert.ok(ms >= 0); clock += ms; } });
  await paced.apply({ image: purple, color: '#6a3dff' }); frameTimes.length = 0;
  await paced.apply({ image: red, color: '#ff1438', effect: 'quest', onStart: async () => { clock += 700; } });
  const visibleDuration = frameTimes.at(-1) - frameTimes[0];
  assert.ok(visibleDuration >= 1050 && visibleDuration <= 1150, 'Native setup time must not consume the slower transition duration.');
  assert.ok(frameTimes.slice(1).every((time, i) => time - frameTimes[i] <= 18), 'Frames are evenly paced near 60 Hz.');
  console.log('Brand icon transitions passed: fixed geometry, color endpoints, bounded frames, cancellation, reduced motion, and hostile IPC.');
})().catch(error => { console.error(error); process.exitCode = 1; });
