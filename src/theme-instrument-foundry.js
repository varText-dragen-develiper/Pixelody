(function themeInstrumentFoundry() {
  'use strict';

  const registryApi = window.PixelodyThemeInstrumentRegistry;
  const fixtures = window.PixelodyThemeInstrumentFixtures;
  const instrumentSet = window.PixelodyThemeInstruments;
  if (!registryApi || !fixtures || !instrumentSet) throw new Error('Theme Instrument Foundry dependencies are unavailable.');

  const registry = registryApi.createRegistry();
  instrumentSet.registerAll(registry);
  let snapshot = fixtures.createFixtureState();
  const instances = [];
  const status = document.querySelector('#foundry-status');
  const grid = document.querySelector('#instrument-grid');

  function context() {
    return {
      palette: document.body.dataset.palette,
      motion: document.body.dataset.motion,
      detail: document.body.dataset.detail,
      performance: document.body.dataset.performance,
    };
  }

  function announce(message) { status.textContent = message; }
  function updateAll() { instances.forEach(({ instance }) => instance.update(snapshot)); }
  function dispatch(action) {
    snapshot = fixtures.reduceFixture(snapshot, action);
    updateAll();
    announce(`Fixture updated: ${action.type.toLowerCase().replaceAll('_', ' ')}.`);
  }

  const host = Object.freeze({ dispatch, getContext: context, announce });

  function tag(text) {
    const node = document.createElement('span');
    node.textContent = text;
    return node;
  }

  registryApi.CATEGORY_DEFINITIONS.forEach((category, categoryIndex) => {
    const section = document.createElement('section');
    section.className = 'instrument-family';
    section.dataset.category = category.id;
    section.setAttribute('aria-labelledby', `family-${category.id}`);

    const heading = document.createElement('header');
    heading.className = 'family-heading';
    heading.innerHTML = `<span>0${categoryIndex + 1}</span><div><p>${category.shortLabel} family</p><h2 id="family-${category.id}">${category.label}</h2></div><b>02 instruments</b>`;
    section.append(heading);

    const cards = document.createElement('div');
    cards.className = 'family-cards';
    registry.listByCategory(category.id).forEach((descriptor, instrumentIndex) => {
      const article = document.createElement('article');
      article.className = 'instrument-card';
      article.dataset.instrument = descriptor.id;

      const cardHeader = document.createElement('header');
      cardHeader.className = 'instrument-card-heading';
      cardHeader.innerHTML = `<span>${String(instrumentIndex + 1).padStart(2, '0')} / ${category.shortLabel}</span><h3>${descriptor.name}</h3><p>${descriptor.summary}</p>`;

      const stage = document.createElement('div');
      stage.className = 'ti-demo-stage';
      stage.dataset.renderer = descriptor.renderer;
      stage.setAttribute('aria-label', `${descriptor.name} interactive demonstration`);

      const metadata = document.createElement('footer');
      metadata.className = 'instrument-meta';
      const facts = document.createElement('div');
      facts.className = 'instrument-tags';
      facts.append(tag(descriptor.role), tag(descriptor.renderer), tag(`${descriptor.cost} cost`));
      const placements = document.createElement('p');
      placements.innerHTML = '<strong>Fits</strong> ';
      placements.append(document.createTextNode(descriptor.placements.join(' · ')));
      const fallback = document.createElement('p');
      fallback.innerHTML = '<strong>Fallback</strong> ';
      fallback.append(document.createTextNode(descriptor.fallback));
      metadata.append(facts, placements, fallback);
      article.append(cardHeader, stage, metadata);
      cards.append(article);

      const instance = registry.create(descriptor.id);
      instance.mount(stage, host);
      instance.update(snapshot);
      instances.push({ descriptor, instance });
    });
    section.append(cards);
    grid.append(section);
  });

  const controlMap = {
    'palette-control': 'palette',
    'motion-control': 'motion',
    'detail-control': 'detail',
    'performance-control': 'performance',
  };
  Object.entries(controlMap).forEach(([id, key]) => {
    document.querySelector(`#${id}`).addEventListener('change', (event) => {
      document.body.dataset[key] = event.target.value;
      updateAll();
      announce(`${key[0].toUpperCase() + key.slice(1)} set to ${event.target.selectedOptions[0].textContent}.`);
    });
  });

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.querySelector('#motion-control').value = 'reduced';
    document.body.dataset.motion = 'reduced';
  }

  document.querySelector('#reset-fixture').addEventListener('click', () => {
    snapshot = fixtures.createFixtureState();
    updateAll();
    announce('Fixture truth reset. Instrument-local visual choices were preserved.');
  });
  window.addEventListener('beforeunload', () => instances.forEach(({ instance }) => instance.destroy()), { once: true });
}());
