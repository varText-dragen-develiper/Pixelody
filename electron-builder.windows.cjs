const path = require('node:path');
const identity = require('./release/windows-identity.json');
const { builderFiles } = require('./scripts/windows-package-policy');
const { publicNoticePath, preparePublicAssetNotice } = require('./scripts/windows-public-notices');

const signed = process.env.PIXELODY_RELEASE_SIGNING === 'required';
const instrumented = process.env.PIXELODY_RELEASE_TEST_INSTRUMENTATION === '1';
const versionOverride = process.env.PIXELODY_RELEASE_VERSION_OVERRIDE || undefined;
const outputSuffix = instrumented ? 'instrumented' : (signed ? 'signed' : 'unsigned');

module.exports = {
  appId: identity.appId,
  productName: identity.productName,
  copyright: `Copyright ${new Date().getUTCFullYear()} ${identity.publisherDisplayName}`,
  asar: true,
  compression: 'normal',
  forceCodeSigning: signed,
  directories: {
    output: process.env.PIXELODY_RELEASE_OUTPUT || path.join('.artifacts', 'windows-release', outputSuffix),
    buildResources: 'build',
  },
  extraMetadata: {
    name: identity.installerDirectoryName,
    productName: identity.productName,
    ...(versionOverride ? { version: versionOverride } : {}),
  },
  files: builderFiles(instrumented),
  beforePack: () => preparePublicAssetNotice(__dirname),
  extraResources: [
    { from: 'licenses', to: 'licenses', filter: ['**/*'] },
    { from: publicNoticePath(__dirname), to: 'THIRD_PARTY_ASSETS.md' },
  ],
  win: {
    target: [{ target: 'nsis', arch: identity.architecture }],
    icon: 'build/icon.png',
    executableName: identity.executableName,
    requestedExecutionLevel: 'asInvoker',
    signAndEditExecutable: true,
    signExecutable: signed,
    legalTrademarks: '',
    artifactName: identity.artifactName,
    signtoolOptions: {
      signingHashAlgorithms: ['sha256'],
      rfc3161TimeStampServer: 'http://timestamp.digicert.com',
    },
  },
  nsis: {
    guid: identity.installerGuid,
    oneClick: true,
    perMachine: false,
    allowElevation: false,
    packElevateHelper: false,
    deleteAppDataOnUninstall: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: identity.productName,
    uninstallDisplayName: `${identity.productName} ${versionOverride || '${version}'}`,
    runAfterFinish: false,
    warningsAsErrors: true,
  },
};
