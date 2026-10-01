const path = require('node:path');
const fs = require('node:fs');
const identity = require('../release/windows-identity.json');
const { PixelodyStateStore } = require('../src/state-store');

const profileArg = process.argv.find((value) => value.startsWith('--profile='))?.slice(10);
if (!profileArg || !path.isAbsolute(profileArg)) throw new Error('An absolute --profile path is required.');
const profile = path.resolve(profileArg);
const expected = path.resolve(process.env.APPDATA || '', identity.userDataDirectoryName);
if (profile.toLowerCase() !== expected.toLowerCase() || process.env.PIXELODY_DISPOSABLE_WINDOWS !== '1') throw new Error('Upgrade fixture verification is restricted to the disposable Pixelody profile.');
const loaded = new PixelodyStateStore({ directory: path.join(profile, 'state') }).loadSync();
if (!loaded.ok || loaded.status === 'unsupported-future-schema') throw new Error(`Fixture state is not readable: ${loaded.status}.`);
const values = loaded.state?.values || {};
const checks = {
  library: values['aurelia.library']?.length === 2,
  playlists: values['aurelia.playlists']?.some((item) => item.id === 'fixture-mix'),
  favorites: values['pixelody.favorites']?.includes('fixture-tone-a'),
  tunings: Boolean(values['aurelia.tunings']?.['fixture-tone-a']),
  queue: values['pixelody.queue']?.length === 2,
  session: values['pixelody.session']?.id === 'fixture-tone-a',
  previousGeneration: Boolean(JSON.parse(fs.readFileSync(path.join(profile, 'state', 'pixelody-state.previous.json'), 'utf8')).values?.['aurelia.library']?.length === 2),
  backupGeneration: fs.readdirSync(path.join(profile, 'state', 'backups')).some((name) => name.endsWith('.json') && JSON.parse(fs.readFileSync(path.join(profile, 'state', 'backups', name), 'utf8')).values?.['aurelia.library']?.length === 2),
};
if (Object.values(checks).some((value) => !value)) throw new Error(`Upgrade fixture state failed: ${JSON.stringify(checks)}`);
console.log(JSON.stringify({ ok: true, checks, schemaVersion: loaded.state.schemaVersion, pathsIncluded: false }));
