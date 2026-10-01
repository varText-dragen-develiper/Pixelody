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
    output: process.env.PIXELODY_RELEASE_OUTPUT || path.join('.artifacts', 'mac-release'),
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
  mac: {
    target: [
      { target: 'dmg', arch: ['x64', 'arm64'] },
      { target: 'zip', arch: ['x64', 'arm64'] },
    ],
    category: 'public.app-category.music',
    icon: 'build/icon.png',
    hardenedRuntime: true,
    gatekeeperAssess: false,
    darkModeSupport: true,
    minimumSystemVersion: '11.0.0',
    artifactName: '${productName}-${version}-mac-${arch}.${ext}',
  },
  dmg: {
    artifactName: '${productName}-${version}-mac-${arch}.${ext}',
    window: {
      width: 540,
      height: 380,
    },
  },
};
