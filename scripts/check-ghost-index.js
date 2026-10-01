const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const html = read('src/index.html');
const renderer = read('src/renderer.js');
const css = read('src/ghost-index.css');

assert.match(html, /id="ghostReconstruction"[\s\S]*id="ghostReconstructionCode"[\s\S]*id="ghostReconstructionLabel"/);
assert.match(renderer, /function triggerGhostReconstruction\(kind, label\)/);
assert.match(renderer, /if \(appearance\.theme === 'ghost-index'\) \{\s*triggerGhostReconstruction\(kind, label\);\s*return;/);
assert.match(renderer, /appearance\.theme !== 'ghost-index' \|\| previousTrack\?\.id !== track\.id/);
assert.match(renderer, /changed \|\| appearance\.theme !== 'ghost-index'/);
assert.doesNotMatch(css, /ghost-index-ui-reacting \.main-stage/);
assert.doesNotMatch(css, /@keyframes gi-index-lock/);
assert.match(css, /--gi-aperture-x:30%/);
assert.match(css, /body\[data-theme="ghost-index"\]\.is-playing \.hero-content>\.playlist-cover\{position:absolute!important;left:var\(--gi-aperture-x\)!important;top:35px!important/);
assert.match(css, /@media\(max-width:850px\)[\s\S]*--gi-aperture-x:27%[\s\S]*grid-template-columns:54% minmax\(250px,46%\)/);
assert.match(css, /\.ghost-reconstruction\.active[^{]*\{[^}]*gi-rebuild-shell/);
assert.match(css, /ghost-index-reconstructing #trackRows[^{]*\{[^}]*gi-rebuild-surface/);

console.log('Ghost Index audit passed: responsive aperture alignment, bounded reconstruction, and track/playlist-only triggering are present.');
