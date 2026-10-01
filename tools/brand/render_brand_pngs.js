// Rasterizes the SVGs written by generate_brand_assets.py into the PNGs that
// Electron and electron-builder need. Development-only: uses Playwright's
// Chromium, which is not a runtime dependency of Pixelody.
//
//   node tools/brand/render_brand_pngs.js
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function loadPlaywright() {
  for (const candidate of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(candidate); } catch { /* try the next location */ }
  }
  throw new Error('Playwright is required to rasterize brand icons (npm i -g playwright).');
}

const root = path.resolve(__dirname, '..', '..');
const colors = JSON.parse(fs.readFileSync(path.join(__dirname, 'logo-colors.json'), 'utf8'));
const jobs = [
  ['build/icon.svg', 'build/icon.png', 512],
  ['docs/brand/pixelody-app-icon.svg', 'docs/brand/pixelody-app-icon-512.png', 512],
  ...colors.map(({ key }) => [`docs/brand/colors/pixelody-app-icon-${key}.svg`, `src/assets/brand/window-icon-${key}.png`, 256]),
];

(async () => {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  try {
    for (const [source, target, size] of jobs) {
      const page = await browser.newPage({ viewport: { width: size, height: size } });
      const svg = fs.readFileSync(path.join(root, source), 'utf8');
      await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`)}</body></html>`);
      fs.mkdirSync(path.dirname(path.join(root, target)), { recursive: true });
      await page.screenshot({ path: path.join(root, target), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
      await page.close();
      console.log(`${target} (${size}px)`);
    }
  } finally {
    await browser.close();
  }
})();
