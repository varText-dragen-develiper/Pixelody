// Mirrors scripts/lib/theme-navigation-map.js's approach: renderer.js is a
// browser script (references window/document at load time) and cannot be
// require()'d in Node, so this is a lightweight textual extraction of the
// `themeStylesheets` map literal, not a real JS parse. Used by
// scripts/check-themes.js to cross-check the runtime map against
// built-in-themes.json's authoritative mainStyles lists.
function extractThemeStylesheetMap(source) {
  const mapMatch = source.match(/const themeStylesheets = \{([\s\S]*?)\};/);
  if (!mapMatch) return null;

  const body = mapMatch[1];
  const entryPattern = /(['"]?)([a-z0-9-]+)\1\s*:\s*\[([^\]]*)\]/g;
  const map = {};
  let match;
  while ((match = entryPattern.exec(body))) {
    const [, , key, arrayBody] = match;
    const files = [];
    const stringPattern = /['"]([^'"]+)['"]/g;
    let stringMatch;
    while ((stringMatch = stringPattern.exec(arrayBody))) files.push(stringMatch[1]);
    map[key] = files;
  }
  return map;
}

module.exports = { extractThemeStylesheetMap };
