const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function readStoredHostId(filePath) {
  if (!filePath) return '';
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return typeof value?.hostId === 'string' ? value.hostId.trim() : '';
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

function persistHostIdentity(filePath, hostId) {
  if (!filePath) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({
    version: 1,
    hostId,
    createdAt: new Date().toISOString(),
  }, null, 2));
}

function loadOrCreateHostIdentity(options = {}) {
  const identityStorePath = options.identityStorePath || '';
  const legacyDeviceStorePath = options.legacyDeviceStorePath || '';
  let error = '';
  let source = 'generated';
  let hostId = String(options.hostId || '').trim();

  try {
    if (hostId) {
      source = 'explicit';
    } else {
      hostId = readStoredHostId(identityStorePath);
      if (hostId) source = 'identity-store';
    }
    if (!hostId) {
      hostId = readStoredHostId(legacyDeviceStorePath);
      if (hostId) source = 'legacy-device-store';
    }
  } catch (readError) {
    error = readError.message || String(readError);
  }

  if (!hostId) hostId = crypto.randomUUID();

  if (identityStorePath && source !== 'identity-store') {
    try {
      persistHostIdentity(identityStorePath, hostId);
    } catch (writeError) {
      error = writeError.message || String(writeError);
    }
  }

  return {
    hostId,
    source,
    persisted: Boolean(identityStorePath && !error),
    error,
  };
}

module.exports = { loadOrCreateHostIdentity };
