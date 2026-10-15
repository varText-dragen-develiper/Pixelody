const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'dev-lab.css'), 'utf8');

const keys = ['neutral', 'signal-state', 'control-deck', 'progress-rail', 'queue-stack', 'metadata-dossier', 'search-cockpit', 'tuning-console', 'intake-desk', 'output-route', 'repair-bench', 'vault-backup', 'theme-workshop', 'playlist-object', 'session-map', 'transition-language', 'recovery-language'];
keys.forEach((key) => assert.match(html, new RegExp(`data-dev-mechanic="${key}"`), `${key} must be exposed in the Dev Lab settings`));
keys.forEach((key) => assert.match(renderer, new RegExp(`['"]${key}['"]`), `${key} must be recognized by renderer state`));
keys.filter((key) => key !== 'neutral').forEach((key) => assert.match(css, new RegExp(`data-dev-mechanic=\\"${key}\\"`), `${key} must have a scoped Dev Lab treatment`));
assert.match(renderer, /pixelody\.devLabMechanic/);
assert.match(renderer, /applyDevLabMechanic\(\)/);
['devLabMechanicName', 'devLabMechanicKey', 'devLabMechanicDetail'].forEach((id) => assert.match(html, new RegExp(`id="${id}"`), `${id} must be present in the workshop readout`));
assert.match(html, /FOUNDATION \/ STATE \+ CONTROL/);
assert.match(html, /INFORMATION \/ COLLECTION \+ SOUND/);
assert.match(html, /WORKFLOW \/ INPUT \+ RECOVERY/);
assert.match(html, /EXPERIENCE \/ IDENTITY \+ TIME/);
assert.match(css, /background-size:32px 32px/);
assert.match(css, /body\[data-theme="dev-lab"\]\[data-motion="off"\]/);

console.log('Dev Lab mechanics audit passed: all prototype controls, persistence wiring, scoped treatments, and motion-off coverage are present.');
