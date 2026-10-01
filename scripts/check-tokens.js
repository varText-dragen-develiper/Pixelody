const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { LEGACY_TO_SEMANTIC, SEMANTIC_TO_LEGACY, toSemanticTokens, toLegacyPalette } = require('../src/theme-runtime/tokens');

async function run() {
  const legacyKeys = Object.keys(LEGACY_TO_SEMANTIC);
  assert.equal(legacyKeys.length, 12, 'all 12 legacy palette keys must be mapped');

  // Every mapping must round-trip both directions.
  legacyKeys.forEach((legacyKey) => {
    const semanticKey = LEGACY_TO_SEMANTIC[legacyKey];
    assert.equal(SEMANTIC_TO_LEGACY[semanticKey], legacyKey, `${legacyKey} <-> ${semanticKey} must be a bijection`);
  });
  assert.equal(Object.keys(SEMANTIC_TO_LEGACY).length, 12, 'reverse map must not collapse two legacy keys onto one semantic key');

  // A realistic legacy palette (shape used by paletteDefinitions entries in
  // renderer.js) converts to fully semantic keys and back losslessly.
  const legacyPalette = {
    gold: '#d8b66a', gold2: '#e8d19a', green: '#65d6a1', hero: '#403117',
    bg: '#050607', surface: '#101112', surface2: '#181a1d', surface3: '#22252a',
    line: '#2b2e33', edge: '#3a3935', text: '#f4f4ef', muted: '#9ca7b5',
  };
  const semantic = toSemanticTokens(legacyPalette);
  assert.deepEqual(Object.keys(semantic).sort(), Object.values(LEGACY_TO_SEMANTIC).sort());
  assert.equal(semantic.accentPrimary, '#d8b66a');
  assert.equal(semantic.canvas, '#050607');
  assert.equal(semantic.foregroundMuted, '#9ca7b5');
  assert.deepEqual(toLegacyPalette(semantic), legacyPalette, 'legacy -> semantic -> legacy must be lossless');

  // Unknown/passthrough keys are preserved rather than dropped, in both
  // directions -- a manifest with a key this shim doesn't know about yet
  // shouldn't silently lose data.
  assert.equal(toSemanticTokens({ mystery: '#ffffff' }).mystery, '#ffffff');
  assert.equal(toLegacyPalette({ mystery: '#ffffff' }).mystery, '#ffffff');

  // Empty/missing input must not throw.
  assert.deepEqual(toSemanticTokens(null), {});
  assert.deepEqual(toLegacyPalette(undefined), {});

  // The schema's optional `tokens` block (theme.schema.json) must expose
  // exactly the semantic keys this shim produces -- otherwise a manifest
  // author could write a token name the shim doesn't understand, or the
  // schema could accept names this module would silently pass through
  // instead of converting.
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'themes', 'theme.schema.json'), 'utf8'));
  assert.ok(schema.properties.tokens, 'theme.schema.json must declare an optional tokens block');
  assert.ok(!(schema.required || []).includes('tokens'), 'tokens must stay optional so all 20 existing manifests keep validating unchanged');
  const schemaTokenKeys = Object.keys(schema.properties.tokens.properties || {}).sort();
  const shimSemanticKeys = Object.values(LEGACY_TO_SEMANTIC).sort();
  assert.deepEqual(schemaTokenKeys, shimSemanticKeys, 'schema tokens block and tokens.js LEGACY_TO_SEMANTIC must declare the same key set');

  console.log('Tokens shim audit passed: legacy <-> semantic mapping is a lossless bijection and matches the schema.');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
