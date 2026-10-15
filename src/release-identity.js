const identity = require('../release/windows-identity.json');

function validateReleaseIdentity(value = identity) {
  const required = ['appId', 'productName', 'executableName', 'appUserModelId', 'installerGuid', 'userDataDirectoryName'];
  for (const key of required) {
    if (typeof value[key] !== 'string' || !value[key].trim()) throw new Error(`Release identity is missing ${key}.`);
  }
  if (value.installScope !== 'perUser') throw new Error('Pixelody Windows installs must remain per-user.');
  if (JSON.stringify(value.architecture) !== JSON.stringify(['x64'])) throw new Error('Pixelody release architecture policy must remain x64 until a migration is designed.');
  return Object.freeze({ ...value, architecture: Object.freeze([...value.architecture]) });
}

module.exports = validateReleaseIdentity();
