'use strict';

const EFFECTS = Object.freeze(['none', 'sweep', 'quest']);

// Runtime recoloring of generator-owned pixels. Never rotate the mark or fill its cut.
function transitionBitmap(base, previous, size, color, progress, effect) {
  const output = Buffer.from(base);
  const rgb = color.slice(1).match(/../g).map(value => parseInt(value, 16));
  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < size.width; x++) {
      const i = (y * size.width + x) * 4;
      const blue = base[i], green = base[i + 1], red = base[i + 2];
      if (blue <= red + 8 || blue <= green + 8) continue;
      const u = (x + .5) / size.width, v = (y + .5) / size.height;
      const gx = Math.floor(u * 32), gy = Math.floor(v * 32);
      const grain = ((gx * 17 + gy * 29 + gx * gy * 7) % 31) / 30;
      const radius = Math.hypot(u - .5, v - .5) / .5;
      const angle = (Math.atan2(v - .5, u - .5) + Math.PI) / (2 * Math.PI);
      const boundary = effect === 'quest'
        ? Math.max(0, Math.min(1, 1 - radius * .85 + (Math.floor(angle * 8) / 8 - .5) * .24 + (grain - .5) * .055))
        : Math.max(0, Math.min(1, u + (grain - .5) * .14));
      const next = progress >= 1 || progress > 0 && progress >= boundary;
      const shimmer = effect === 'quest' && progress > 0 && progress < 1 && Math.abs(progress - boundary) < .045 && grain > .48 ? .45 : 0;
      const coverage = Math.max(0, Math.min(1, (blue - 18) / (255 - 18)));
      const target = [18 + (rgb[2] - 18) * coverage, 15 + (rgb[1] - 15) * coverage, 14 + (rgb[0] - 14) * coverage];
      for (let channel = 0; channel < 3; channel++) {
        const value = next ? target[channel] : previous[i + channel];
        output[i + channel] = Math.round(value + (255 - value) * shimmer);
      }
    }
  }
  return output;
}

function createBrandIconAnimator({ nativeImage, getBaseImage, windows, platform = process.platform, now = () => performance.now(), wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  let displayed = null;
  let displayedColor = '';
  let generation = 0;
  let baseImage = null;
  function paint(image) {
    for (const window of windows()) if (window && !window.isDestroyed()) window.setIcon(image);
    displayed = image;
  }
  async function apply({ image, color, effect = 'none', onStart = null, onFrame = null, isCurrent = () => true }) {
    if (!EFFECTS.includes(effect) || !/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Invalid icon transition.');
    const id = ++generation;
    if (platform !== 'win32' || !displayed || displayedColor === color || effect === 'none') {
      if (platform === 'win32') paint(image);
      displayedColor = color;
      return { frames: 0, effect: 'none' };
    }
    baseImage ||= getBaseImage();
    const size = baseImage.getSize(), base = baseImage.toBitmap(), previous = displayed.toBitmap();
    if (baseImage.isEmpty() || previous.length !== base.length) {
      paint(image); displayedColor = color;
      return { frames: 0, effect: 'none' };
    }
    if (onStart) await onStart();
    if (id !== generation || !isCurrent()) return { cancelled: true };
    displayedColor = '';
    const started = now(), count = 66, durationMs = 1100;
    for (let frame = 1; frame <= count; frame++) {
      if (id !== generation || !isCurrent()) return { cancelled: true };
      // Always land on the exact generated/final pixels, including purple variants.
      const progress = frame / count;
      const eased = progress * progress * (3 - 2 * progress);
      paint(frame === count ? image : nativeImage.createFromBitmap(transitionBitmap(base, previous, size, color, eased, effect), size));
      if (frame < count && onFrame) await onFrame(displayed, frame, count);
      if (id !== generation || !isCurrent()) return { cancelled: true };
      if (frame < count) await wait(Math.max(0, started + frame * durationMs / count - now()));
    }
    displayedColor = color;
    return { frames: count, effect };
  }
  return { apply };
}

module.exports = { EFFECTS, transitionBitmap, createBrandIconAnimator };
