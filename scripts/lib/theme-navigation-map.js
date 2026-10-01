// Shared by scripts/check-themes.js and its own test
// (scripts/check-theme-navigation-map.js). Pulled out of check-themes.js so
// the regex-based extraction (renderer.js is a browser script and can't be
// require()'d/parsed as a real module in Node) has real test coverage
// instead of just a hand-traced comment.
function extractThemeNavigationMechanics(source) {
  const blockMatch = source.match(/const themeNavigationMechanics = \{([\s\S]*?)\};/);
  if (!blockMatch) return null;
  const entries = {};
  const entryPattern = /(['"]?)([a-z0-9-]+)\1\s*:\s*(['"])([a-z0-9-]+)\3/g;
  let match;
  while ((match = entryPattern.exec(blockMatch[1]))) entries[match[2]] = match[4];
  return entries;
}

module.exports = { extractThemeNavigationMechanics };
