const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const errors = [];
const checkedExtensions = new Set(['.css', '.html', '.js', '.json', '.svg']);
const checkedDirs = ['src'];

const allowlist = new Set([
  path.normalize('src/theme-prewarm.js'),
]);

const rules = [
  {
    label: 'remote decorative media URL',
    pattern: /https:\/\/upload\.wikimedia\.org\//i,
    help: 'Bundle licensed media locally or replace it with original Pixelody art.',
  },
  {
    label: 'private user-provided meme asset reference',
    pattern: /assets\/themes\/meme-machine\/user-memes/i,
    help: 'Private user assets must not be referenced by release runtime files.',
  },
  {
    label: 'Spotify metadata or product reference',
    pattern: /\bspotify\b/i,
    help: 'Avoid competitor brand references in runtime assets and public UI.',
  },
];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      walk(absolute);
      continue;
    }
    const relative = path.relative(root, absolute);
    if (allowlist.has(path.normalize(relative))) continue;
    if (!checkedExtensions.has(path.extname(entry.name).toLowerCase())) continue;
    const text = fs.readFileSync(absolute, 'utf8');
    for (const rule of rules) {
      if (rule.pattern.test(text)) errors.push(`${relative}: ${rule.label}. ${rule.help}`);
    }
  }
}

for (const dir of checkedDirs) walk(path.join(root, dir));

const privateMemeRuntimePath = path.join(root, 'src', 'assets', 'themes', 'meme-machine', 'user-memes');
if (fs.existsSync(privateMemeRuntimePath)) {
  errors.push('src/assets/themes/meme-machine/user-memes exists. Keep unverified user media outside src so public packages do not include it by accident.');
}

if (errors.length) {
  console.error(`Legal release check failed with ${errors.length} issue(s):`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log('Legal release check passed: no blocked runtime media or brand references found.');
