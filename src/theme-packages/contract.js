'use strict';

const PACKAGE_FORMAT_VERSION = 1;
const MAX_PACKAGE_BYTES = 256 * 1024;
const THEME_ID = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const HEX = /^#[0-9a-f]{6}$/i;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

const TOKEN_KEYS = Object.freeze([
  'accentPrimary', 'accentSecondary', 'accentState', 'heroTone', 'canvas',
  'elevation1', 'elevation2', 'elevation3', 'divider', 'frame',
  'foreground', 'foregroundMuted',
]);
const ASSET_KEYS = Object.freeze(['backgroundTexture', 'heroOverlay', 'panelFrame', 'iconSet']);
const NAVIGATION_MECHANICS = Object.freeze([
  'linear-list', 'carousel', 'cover-flow', 'spectral-field', 'pass-deck',
  'memory-cascade', 'pressure-stack', 'current-weave', 'chorus-fold',
  'graftline', 'shared-strata',
]);
const INFORMATION_PROFILES = Object.freeze(['counterform-choir', 'aftergarden', 'vesperfold']);

class ThemePackageError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ThemePackageError';
    this.code = code;
  }
}

function reject(code, message) {
  throw new ThemePackageError(code, message);
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value, allowed, label) {
  if (!isRecord(value)) reject('invalid_shape', `${label} must be an object.`);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length) reject('unexpected_field', `${label} contains an unsupported field.`);
}

function text(value, label, maximum, options = {}) {
  if (typeof value !== 'string') reject('invalid_text', `${label} must be text.`);
  const normalized = value.trim();
  if ((!normalized && options.required !== false) || normalized.length > maximum || CONTROL_CHARACTERS.test(normalized)) {
    reject('invalid_text', `${label} is missing or outside the supported length.`);
  }
  return normalized;
}

function enumValue(value, allowed, label) {
  if (!allowed.includes(value)) reject('unsupported_value', `${label} is not supported by this Pixelody version.`);
  return value;
}

function color(value, label) {
  if (typeof value !== 'string' || !HEX.test(value)) reject('invalid_color', `${label} must be a six-digit hexadecimal color.`);
  return value.toLowerCase();
}

function semver(value, label) {
  const normalized = text(value, label, 32);
  if (!VERSION.test(normalized)) reject('invalid_version', `${label} must use major.minor.patch format.`);
  return normalized;
}

function compareVersions(left, right) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

function mixHex(first, second, amount) {
  const channels = (value) => [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
  const left = channels(first);
  const right = channels(second);
  return `#${left.map((channel, index) => Math.round(channel + ((right[index] - channel) * amount)).toString(16).padStart(2, '0')).join('')}`;
}

function lightColor(value) {
  const [red, green, blue] = [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
  return ((red * 299) + (green * 587) + (blue * 114)) / 1000 > 150;
}

function relativeLuminance(value) {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255)
    .map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return (channels[0] * 0.2126) + (channels[1] * 0.7152) + (channels[2] * 0.0722);
}

function contrastRatio(first, second) {
  const light = Math.max(relativeLuminance(first), relativeLuminance(second));
  const dark = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (light + 0.05) / (dark + 0.05);
}

function requireContrast(tokens, foreground, background, minimum, label) {
  if (contrastRatio(tokens[foreground], tokens[background]) < minimum) {
    reject('insufficient_contrast', `${label} does not meet the current local-theme contrast floor.`);
  }
}

function normalizeTokens(theme) {
  const base = theme.palette.base;
  const foreground = lightColor(base) ? '#111317' : '#f5f3ef';
  const toneTarget = lightColor(base) ? '#000000' : '#ffffff';
  const defaults = {
    accentPrimary: theme.palette.primary,
    accentSecondary: theme.palette.secondary,
    accentState: theme.palette.secondary,
    heroTone: mixHex(base, theme.palette.primary, 0.28),
    canvas: base,
    elevation1: mixHex(base, toneTarget, 0.045),
    elevation2: mixHex(base, toneTarget, 0.09),
    elevation3: mixHex(base, toneTarget, 0.15),
    divider: mixHex(base, toneTarget, 0.2),
    frame: mixHex(base, theme.palette.primary, 0.42),
    foreground,
    foregroundMuted: mixHex(foreground, base, 0.38),
  };
  const supplied = theme.tokens || {};
  hasOnlyKeys(supplied, new Set(TOKEN_KEYS), 'theme.tokens');
  for (const [key, value] of Object.entries(supplied)) defaults[key] = color(value, `theme.tokens.${key}`);
  return defaults;
}

function normalizeTheme(value) {
  hasOnlyKeys(value, new Set([
    'schemaVersion', 'id', 'name', 'author', 'description', 'palette', 'tokens',
    'assets', 'hud', 'typography', 'motion', 'navigation', 'information',
  ]), 'theme');
  if (value.schemaVersion !== 1) reject('unsupported_theme_schema', 'theme.schemaVersion must be 1.');

  hasOnlyKeys(value.palette, new Set(['primary', 'secondary', 'base']), 'theme.palette');
  const palette = {
    primary: color(value.palette.primary, 'theme.palette.primary'),
    secondary: color(value.palette.secondary, 'theme.palette.secondary'),
    base: color(value.palette.base, 'theme.palette.base'),
  };

  hasOnlyKeys(value.assets, new Set(ASSET_KEYS), 'theme.assets');
  for (const key of ASSET_KEYS) {
    if (value.assets[key] !== null && value.assets[key] !== undefined) {
      reject('assets_not_supported', 'Local theme assets are reserved for the bounded asset-package milestone and cannot be installed yet.');
    }
  }

  hasOnlyKeys(value.hud, new Set(['layout', 'controls', 'corners']), 'theme.hud');
  const hud = {
    layout: enumValue(value.hud.layout, ['studio', 'compact', 'cinematic', 'arcade'], 'theme.hud.layout'),
    controls: enumValue(value.hud.controls, ['pixel', 'technical', 'minimal', 'ornamental'], 'theme.hud.controls'),
    corners: enumValue(value.hud.corners, ['pixel-cut', 'square', 'soft', 'framed'], 'theme.hud.corners'),
  };

  hasOnlyKeys(value.typography, new Set(['profile', 'font']), 'theme.typography');
  if (value.typography.font !== null && value.typography.font !== undefined) {
    reject('fonts_not_supported', 'Bundled fonts are reserved for the bounded asset-package milestone and cannot be installed yet.');
  }
  const typography = {
    profile: enumValue(value.typography.profile, ['pixel', 'technical', 'editorial', 'display'], 'theme.typography.profile'),
    font: null,
  };

  hasOnlyKeys(value.motion, new Set(['profile', 'intensity']), 'theme.motion');
  const motion = {
    profile: enumValue(value.motion.profile, ['signal', 'drift', 'pulse', 'mechanical', 'none'], 'theme.motion.profile'),
    intensity: enumValue(value.motion.intensity, ['off', 'calm', 'expressive'], 'theme.motion.intensity'),
  };

  let navigation = { trackBrowser: 'linear-list' };
  if (value.navigation !== undefined) {
    hasOnlyKeys(value.navigation, new Set(['trackBrowser']), 'theme.navigation');
    navigation = {
      trackBrowser: enumValue(value.navigation.trackBrowser || 'linear-list', NAVIGATION_MECHANICS, 'theme.navigation.trackBrowser'),
    };
  }

  let information = null;
  if (value.information !== undefined) {
    hasOnlyKeys(value.information, new Set(['profile']), 'theme.information');
    information = { profile: enumValue(value.information.profile, INFORMATION_PROFILES, 'theme.information.profile') };
  }

  const normalized = {
    schemaVersion: 1,
    id: text(value.id, 'theme.id', 64),
    name: text(value.name, 'theme.name', 80),
    author: text(value.author, 'theme.author', 80),
    description: text(value.description || '', 'theme.description', 300, { required: false }),
    palette,
    assets: Object.fromEntries(ASSET_KEYS.map((key) => [key, null])),
    hud,
    typography,
    motion,
    navigation,
    information,
  };
  if (!THEME_ID.test(normalized.id)) reject('invalid_theme_id', 'theme.id must be a lowercase, portable identifier between 3 and 64 characters.');
  normalized.tokens = normalizeTokens({ ...value, palette });
  for (const surface of ['canvas', 'elevation1', 'elevation2']) {
    requireContrast(normalized.tokens, 'foreground', surface, 4.5, `theme.tokens.foreground against ${surface}`);
  }
  requireContrast(normalized.tokens, 'foregroundMuted', 'canvas', 3, 'theme.tokens.foregroundMuted against canvas');
  requireContrast(normalized.tokens, 'accentPrimary', 'canvas', 4.5, 'theme.tokens.accentPrimary against canvas');
  requireContrast(normalized.tokens, 'accentState', 'canvas', 3, 'theme.tokens.accentState against canvas');
  return normalized;
}

function normalizeCompatibility(value, appVersion) {
  hasOnlyKeys(value, new Set(['minAppVersion', 'maxAppVersion']), 'compatibility');
  const minimum = value.minAppVersion ? semver(value.minAppVersion, 'compatibility.minAppVersion') : '0.1.1';
  const maximum = value.maxAppVersion ? semver(value.maxAppVersion, 'compatibility.maxAppVersion') : '';
  if (maximum && compareVersions(minimum, maximum) > 0) reject('invalid_compatibility', 'The compatibility range is reversed.');
  if (appVersion && VERSION.test(appVersion)) {
    if (compareVersions(appVersion, minimum) < 0 || (maximum && compareVersions(appVersion, maximum) > 0)) {
      reject('incompatible_app_version', `This theme supports Pixelody ${minimum}${maximum ? ` through ${maximum}` : ' or newer'}.`);
    }
  }
  return { minAppVersion: minimum, maxAppVersion: maximum };
}

function normalizeProvenance(value) {
  hasOnlyKeys(value, new Set(['origin', 'license', 'notes']), 'provenance');
  return {
    origin: enumValue(value.origin, ['original', 'licensed', 'mixed'], 'provenance.origin'),
    license: text(value.license, 'provenance.license', 120),
    notes: text(value.notes || '', 'provenance.notes', 500, { required: false }),
  };
}

function parseThemePackageBytes(bytes, options = {}) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes || '');
  if (!bytes.length || bytes.length > MAX_PACKAGE_BYTES) reject('package_size', `Theme packages must be between 1 byte and ${MAX_PACKAGE_BYTES} bytes.`);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    reject('invalid_json', 'The selected file is not a valid Pixelody theme package.');
  }
  hasOnlyKeys(value, new Set(['packageFormatVersion', 'type', 'version', 'compatibility', 'theme', 'provenance']), 'package');
  if (value.packageFormatVersion !== PACKAGE_FORMAT_VERSION) reject('unsupported_package_format', 'This theme package format is not supported by this Pixelody version.');
  if (value.type !== 'theme') reject('unsupported_package_type', 'Only declarative theme packages can be installed in this milestone.');
  return {
    packageFormatVersion: PACKAGE_FORMAT_VERSION,
    type: 'theme',
    version: semver(value.version, 'version'),
    compatibility: normalizeCompatibility(value.compatibility || {}, options.appVersion || ''),
    theme: normalizeTheme(value.theme),
    provenance: normalizeProvenance(value.provenance),
  };
}

function descriptorFor(normalizedPackage, hash, installedAt = '') {
  if (!/^[a-f0-9]{64}$/.test(hash)) reject('invalid_hash', 'The installed package identity is invalid.');
  const { theme } = normalizedPackage;
  return {
    runtimeKey: `community:${theme.id}@${normalizedPackage.version}:${hash}`,
    id: theme.id,
    name: theme.name,
    author: theme.author,
    description: theme.description,
    version: normalizedPackage.version,
    hash,
    installedAt,
    compatibility: normalizedPackage.compatibility,
    tokens: theme.tokens,
    hud: theme.hud,
    typography: theme.typography,
    motion: theme.motion,
    navigation: theme.navigation,
    information: theme.information,
    provenance: normalizedPackage.provenance,
    trust: { origin: 'local', reviewed: false, executable: false },
  };
}

module.exports = Object.freeze({
  ASSET_KEYS,
  INFORMATION_PROFILES,
  MAX_PACKAGE_BYTES,
  NAVIGATION_MECHANICS,
  PACKAGE_FORMAT_VERSION,
  TOKEN_KEYS,
  ThemePackageError,
  compareVersions,
  contrastRatio,
  descriptorFor,
  parseThemePackageBytes,
});
