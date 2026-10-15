const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const scaffoldRoot = path.join(root, 'native', 'windows-virtual-audio');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const requiredFiles = [
  'native/windows-virtual-audio/DRIVER_SCAFFOLD.md',
  'native/windows-virtual-audio/PixelodyVirtualAudio.scaffold.json',
  'native/windows-virtual-audio/source/PixelodyVirtualAudio/README.md',
  'native/windows-virtual-audio/source/PixelodyVirtualAudio/PixelodyVirtualAudio.contract.h',
  'native/windows-virtual-audio/package/README.md',
  'native/windows-virtual-audio/package/PixelodyVirtualAudio.inf.placeholder',
  'native/windows-virtual-audio/package/PixelodyVirtualAudio.cat.placeholder',
  'native/windows-virtual-audio/build/README.md',
  'native/windows-virtual-audio/upstream/SYSVAD_PROVENANCE.md'
];
const errors = [];

for (const relativePath of requiredFiles) {
  if (!fs.existsSync(path.join(root, relativePath))) errors.push(`missing required scaffold file: ${relativePath}`);
}

let contract;
try {
  contract = JSON.parse(read('native/windows-virtual-audio/PixelodyVirtualAudio.scaffold.json'));
} catch (error) {
  errors.push(`invalid scaffold JSON: ${error.message}`);
}

if (contract) {
  if (contract.status !== 'source-scaffold-only') errors.push('scaffold status must be source-scaffold-only');
  if (contract.buildable !== false) errors.push('scaffold must not be buildable');
  if (contract.installable !== false) errors.push('scaffold must not be installable');
  if (contract.driverBinaryName !== 'PixelodyVirtualAudio.sys') errors.push('driver binary name drifted');
  if (contract.endpoints?.render !== 'Pixelody Virtual Output') errors.push('render endpoint name drifted');
  if (contract.endpoints?.capture !== 'Pixelody Virtual Monitor') errors.push('capture endpoint name drifted');
  if (contract.firstDriver?.channels !== 2 || contract.firstDriver?.sampleRateHz !== 48000 || contract.firstDriver?.mode !== 'shared-mode-pcm') {
    errors.push('first-driver PCM capability drifted');
  }

  const requiredExclusions = ['apo', 'kernel-eq', 'offload', 'bluetooth', 'keyword-detector', 'sample-extras', 'automatic-default-device-change'];
  for (const exclusion of requiredExclusions) {
    if (!contract.excluded?.includes(exclusion)) errors.push(`missing first-driver exclusion: ${exclusion}`);
  }
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

for (const filePath of walk(scaffoldRoot)) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.sys') || lower.endsWith('.inf') || lower.endsWith('.cat')) {
    errors.push(`installable driver artifact is forbidden in scaffold: ${path.relative(root, filePath)}`);
  }
}

const contractHeader = read('native/windows-virtual-audio/source/PixelodyVirtualAudio/PixelodyVirtualAudio.contract.h');
for (const endpoint of ['Pixelody Virtual Output', 'Pixelody Virtual Monitor']) {
  if (!contractHeader.includes(endpoint)) errors.push(`contract header missing endpoint: ${endpoint}`);
}

const provenance = read('native/windows-virtual-audio/upstream/SYSVAD_PROVENANCE.md');
for (const marker of ['microsoft/Windows-driver-samples', 'Microsoft Public License (MS-PL)', 'No SysVAD source files']) {
  if (!provenance.includes(marker)) errors.push(`SysVAD provenance missing: ${marker}`);
}

if (errors.length) {
  console.error(`Virtual-audio scaffold audit failed with ${errors.length} issue(s):`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log('Virtual-audio scaffold audit passed: names, limits, provenance, and non-installable package boundary are intact.');
