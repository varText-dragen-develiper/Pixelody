const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const contract = require('../src/theme-runtime/navigation/contract');
const registry = require('../src/theme-runtime/navigation/registry');

function makeValidMechanic(overrides = {}) {
  return { mount() {}, update() {}, destroy() {}, ...overrides };
}

async function run() {
  // contract.js: structural validation
  assert.equal(contract.MECHANIC_CONTRACT_VERSION, 1);
  assert.deepEqual(contract.REQUIRED_METHODS, ['mount', 'update', 'destroy']);
  assert.ok(contract.COMMON_THREAD_REQUIREMENTS.length >= 6, 'common thread checklist must not be trimmed silently');

  assert.equal(contract.validateMechanic(makeValidMechanic()).valid, true);
  assert.equal(contract.validateMechanic(null).valid, false);
  assert.equal(contract.validateMechanic({}).errors.length, 3, 'missing all three methods must report three errors');
  assert.deepEqual(
    contract.validateMechanic({ mount() {}, update() {} }).errors,
    ['Mechanic module is missing a "destroy" function.'],
  );
  assert.equal(contract.validateMechanic(makeValidMechanic({ meta: 'nope' })).valid, false);

  // registry.js: register/get/has/list, using an isolated instance per test
  // run via __resetForTests() so this script can run repeatedly (e.g. via
  // watch mode) without "already registered" false failures.
  registry.__resetForTests();
  assert.equal(registry.hasMechanic('linear-list'), false);
  assert.equal(registry.getMechanic('linear-list'), undefined);
  assert.deepEqual(registry.listMechanics(), []);

  const fakeMechanic = makeValidMechanic();
  registry.registerMechanic('linear-list', fakeMechanic, { label: 'Linear List' });
  assert.equal(registry.hasMechanic('linear-list'), true);
  assert.equal(registry.getMechanic('linear-list'), fakeMechanic);
  assert.deepEqual(registry.listMechanics(), [{ key: 'linear-list', meta: { label: 'Linear List' } }]);

  assert.throws(() => registry.registerMechanic('linear-list', makeValidMechanic()), /already registered/);
  assert.throws(() => registry.registerMechanic('Bad_Key', makeValidMechanic()), /kebab-case/);
  assert.throws(() => registry.registerMechanic('carousel', {}), /does not satisfy the contract/);

  registry.__resetForTests();

  // Schema: navigation block must be optional (existing manifests carry no
  // navigation key at all and must keep validating) and mechanicKey pattern
  // must reject non-kebab-case values.
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'themes', 'theme.schema.json'), 'utf8'));
  assert.ok(!((schema.required || []).includes('navigation')), 'navigation must stay optional so all 20 existing manifests keep validating unchanged');
  assert.ok(new RegExp(schema.$defs.mechanicKey.pattern).test('carousel'));
  assert.ok(!new RegExp(schema.$defs.mechanicKey.pattern).test('Carousel'));

  // Wiring: contract.js/registry.js/linear-list.js must load, in that
  // order, before renderer.js (registry.js reads
  // window.PixelodyNavigationContract at load time; renderer.js reads all
  // three globals), and renderer.js must actually reference every global
  // -- mirrors the same check scripts/check-renderer-domains.js does for
  // src/renderer-domains/*.
  const indexSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const scriptOrder = ['theme-runtime/navigation/contract.js', 'theme-runtime/navigation/registry.js', 'theme-runtime/navigation/linear-list.js', 'theme-runtime/navigation/carousel.js', 'theme-runtime/navigation/cover-flow.js', 'theme-runtime/navigation/pass-deck.js', 'theme-runtime/navigation/memory-cascade.js', 'theme-runtime/navigation/spectral-field.js', 'theme-runtime/navigation/pressure-stack.js', 'theme-runtime/navigation/current-weave.js', 'theme-runtime/navigation/chorus-fold.js', 'theme-runtime/navigation/graftline.js', 'theme-runtime/navigation/shared-strata.js', 'theme-runtime/navigation/dispatcher.js', 'renderer.js'];
  const positions = scriptOrder.map((name) => indexSource.indexOf(`src="${name}"`));
  positions.forEach((position, index) => assert.ok(position !== -1, `${scriptOrder[index]} must be linked in index.html`));
  for (let index = 1; index < positions.length; index += 1) {
    assert.ok(positions[index - 1] < positions[index], `${scriptOrder[index - 1]} must load before ${scriptOrder[index]}`);
  }
  ['PixelodyNavigationContract', 'PixelodyNavigationRegistry', 'PixelodyLinearListMechanic', 'PixelodyCarouselMechanic', 'PixelodyCoverFlowMechanic', 'PixelodyPassDeckMechanic', 'PixelodyMemoryCascadeMechanic', 'PixelodySpectralFieldMechanic', 'PixelodyPressureStackMechanic', 'PixelodyCurrentWeaveMechanic', 'PixelodyChorusFoldMechanic', 'PixelodyGraftlineMechanic', 'PixelodySharedStrataMechanic', 'PixelodyNavigationDispatcher'].forEach((globalName) => {
    assert.ok(rendererSource.includes(globalName), `${globalName} is not wired into renderer composition`);
  });
  assert.ok(rendererSource.includes("registerMechanic('linear-list'"), 'renderer.js must register the linear-list mechanic at startup');
  assert.ok(rendererSource.includes("registerMechanic('carousel'"), 'renderer.js must register the carousel mechanic at startup');
  assert.ok(rendererSource.includes("registerMechanic('cover-flow'"), 'renderer.js must register the cover-flow mechanic at startup');
  assert.ok(rendererSource.includes("registerMechanic('pass-deck'"), 'renderer.js must register the pass-deck mechanic at startup');
  assert.ok(rendererSource.includes("registerMechanic('memory-cascade'"), 'renderer.js must register the memory-cascade mechanic at startup');
  assert.ok(rendererSource.includes("registerMechanic('spectral-field'"), 'renderer.js must register the spectral-field mechanic at startup');
  assert.ok(rendererSource.includes("registerMechanic('pressure-stack'"), 'renderer.js must register the pressure-stack mechanic at startup');
  assert.ok(rendererSource.includes("registerMechanic('current-weave'"), 'renderer.js must register the current-weave mechanic at startup');
  assert.ok(rendererSource.includes("registerMechanic('chorus-fold'"), 'renderer.js must register the chorus-fold mechanic at startup');
  assert.ok(rendererSource.includes("registerMechanic('graftline'"), 'renderer.js must register the graftline mechanic at startup');
  assert.ok(rendererSource.includes("registerMechanic('shared-strata'"), 'renderer.js must register the shared-strata mechanic at startup');
  assert.ok(rendererSource.includes('createNavigationDispatcher('), 'renderer.js must construct a navigation dispatcher instead of using a mechanic directly');

  console.log('Navigation platform audit passed: contract, registry, schema, and renderer wiring are sound.');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
