(function pixelodyVesperfoldInformationProfileFactory(root, factory) {
  const registry = (typeof module === 'object' && module.exports) ? require('../registry') : root && root.PixelodyInformationRegistry;
  const api = factory(registry);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyVesperfoldInformationProfile = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createVesperfoldInformationProfileApi(registry) {
  'use strict';
  if (!registry) throw new Error('Vesperfold information profile requires PixelodyInformationRegistry first.');

  const profile = {
    key: 'vesperfold',
    bundles: ['collection.summary', 'playback.neighborhood', 'playback.technical', 'output.route', 'queue.summary', 'artwork.summary'],
    regions: [
      { slot: 'hero.overlay', markup: `<div class="vesperfold-hero-hud" aria-hidden="true"><span class="vesperfold-identity-code">STRATA RELAY <b data-theme-info-field="collectionCount">00 TRACKS</b></span><i class="vesperfold-title-transit"></i><span class="vesperfold-hero-truth"><small>CONFIRMED OUTPUT</small><b data-theme-info-field="playbackState">IDLE</b><strong data-theme-info-field="currentTitle">NOTHING PLAYING</strong></span></div>` },
      { slot: 'stage.overlay', markup: `<aside class="vesperfold-work-index" aria-hidden="true"><span><small>QUEUE</small><b data-theme-info-field="queue">00</b></span><span><small>OUTPUT</small><b data-theme-info-field="route">SYSTEM DEFAULT</b></span><span><small>FORMAT</small><b data-theme-info-field="technical">LOCAL</b></span><span><small>ART</small><b data-theme-info-field="artwork">00 / 00</b></span></aside>` },
      { slot: 'player.overlay', markup: `<div class="vesperfold-player-receipt" aria-hidden="true"><small>CONFIRMED SUTURE</small><strong data-theme-info-field="currentTitle">NOTHING PLAYING</strong><span data-theme-info-field="neighborhood">-- / -- / --</span></div>` },
    ],
    project(bundles) {
      const collection = bundles['collection.summary'];
      const neighborhood = bundles['playback.neighborhood'];
      const technical = bundles['playback.technical'];
      const output = bundles['output.route'];
      const queue = bundles['queue.summary'];
      const artwork = bundles['artwork.summary'];
      const track = technical.track;
      const playbackState = neighborhood.current
        ? neighborhood.phase === 'playing' ? 'PLAYING / SUTURE LIVE' : 'PAUSED / SUTURE HELD'
        : neighborhood.total ? 'READY / NO CONFIRMED OUTPUT' : 'EMPTY';
      return Object.freeze({
        fields: Object.freeze({
          collectionCount: `${String(collection.trackCount).padStart(2, '0')} TRACKS`,
          playbackState,
          currentTitle: neighborhood.current?.title || 'NOTHING PLAYING',
          queue: String(queue.count).padStart(2, '0'),
          route: output.label,
          technical: track ? `${track.format}${track.bitDepth ? ` · ${track.bitDepth}-BIT` : ''}${track.sampleRate ? ` / ${Math.round(track.sampleRate / 1000)} KHZ` : ''}` : 'LOCAL',
          artwork: `${String(artwork.total - artwork.missing).padStart(2, '0')} / ${String(artwork.total).padStart(2, '0')}`,
          neighborhood: `${neighborhood.previous?.title || '--'} / ${neighborhood.current?.title || '--'} / ${neighborhood.next?.title || '--'}`,
        }),
        states: Object.freeze({ playbackPhase: neighborhood.phase }),
      });
    },
  };

  if (!registry.hasProfile(profile.key)) registry.registerProfile(profile);
  return Object.freeze({ profile });
}));
