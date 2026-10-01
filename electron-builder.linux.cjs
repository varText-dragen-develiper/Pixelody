const path = require('node:path');
const identity = require('./release/windows-identity.json');

const instrumented = process.env.PIXELODY_RELEASE_TEST_INSTRUMENTATION === '1';
const versionOverride = process.env.PIXELODY_RELEASE_VERSION_OVERRIDE || undefined;

module.exports = {
  appId: identity.appId,
  productName: identity.productName,
  copyright: `Copyright ${new Date().getUTCFullYear()} Pixelody`,
  asar: true,
  compression: 'normal',
  directories: {
    output: process.env.PIXELODY_RELEASE_OUTPUT || path.join('.artifacts', 'linux-release'),
    buildResources: 'build',
  },
  extraMetadata: {
    name: identity.installerDirectoryName,
    productName: identity.productName,
    ...(versionOverride ? { version: versionOverride } : {}),
  },
  files: [
    'package.json',
    'release/windows-identity.json',
    'src/**/*',
    '!src/**/user-memes{,/**/*}',
    ...(instrumented ? [] : [
      '!src/integration-test-runner.js',
      '!src/security-probe.html',
      '!src/security-probe-preload.js',
    ]),
  ],
  extraResources: [
    { from: 'licenses', to: 'licenses', filter: ['**/*'] },
    { from: 'THIRD_PARTY_ASSETS.md', to: 'THIRD_PARTY_ASSETS.md' },
  ],
  linux: {
    target: [
      { target: 'AppImage', arch: ['x64', 'arm64'] },
      { target: 'deb', arch: ['x64', 'arm64'] },
    ],
    category: 'Audio;Music;',
    icon: 'build/icon.png',
    executableName: 'pixelody',
    synopsis: 'Lossless desktop music workstation',
    description: 'High-resolution desktop music player with per-track and per-system tuning.',
    mimeTypes: [
      'audio/flac',
      'audio/x-wav',
      'audio/wav',
      'audio/mpeg',
      'audio/mp4',
      'audio/aac',
      'audio/ogg',
      'audio/opus',
    ],
    artifactName: '${productName}-${version}-linux-${arch}.${ext}',
  },
  appImage: {
    artifactName: '${productName}-${version}-linux-${arch}.${ext}',
  },
  deb: {
    packageCategory: 'sound',
    priority: 'optional',
    artifactName: '${productName}-${version}-linux-${arch}.${ext}',
  },
};
