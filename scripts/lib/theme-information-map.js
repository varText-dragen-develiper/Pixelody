// renderer.js cannot be required in Node, so checks use this deliberately
// narrow extractor for its static runtime theme -> information profile map.
function extractThemeInformationProfiles(source) {
  const blockMatch = source.match(/const themeInformationProfiles = \{([\s\S]*?)\};/);
  if (!blockMatch) return null;
  const entries = {};
  const entryPattern = /(['"]?)([a-z0-9-]+)\1\s*:\s*(['"])([a-z0-9-]+)\3/g;
  let match;
  while ((match = entryPattern.exec(blockMatch[1]))) entries[match[2]] = match[4];
  return entries;
}

module.exports = { extractThemeInformationProfiles };
