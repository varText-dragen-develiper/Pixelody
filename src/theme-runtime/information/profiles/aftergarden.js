(function pixelodyAftergardenInformationProfileFactory(root, factory) {
  const registry = (typeof module === 'object' && module.exports) ? require('../registry') : root && root.PixelodyInformationRegistry;
  const api = factory(registry);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyAftergardenInformationProfile = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createAftergardenInformationProfileApi(registry) {
  'use strict';
  if (!registry) throw new Error('Aftergarden information profile requires PixelodyInformationRegistry first.');
  const profile = {
    key: 'aftergarden',
    bundles: ['collection.summary', 'playback.neighborhood', 'playback.technical', 'output.route', 'queue.summary', 'artwork.summary'],
    regions: [
      { slot: 'hero.overlay', markup: `<div class="aftergarden-hero-hud" aria-hidden="true"><span class="aftergarden-mast">AFTER<br>GARDEN<small>AG-01 / LOCAL PASSAGE</small></span><span class="aftergarden-hero-state"><b data-theme-info-field="collectionCount">00 CUTTINGS</b><i></i><b data-theme-info-field="currentPosition">-- / --</b></span><span class="aftergarden-hero-bloom"><i></i><i></i><i></i><i></i><i></i><b></b></span></div>` },
      { slot: 'stage.overlay', markup: `<aside class="aftergarden-datum-rail" aria-hidden="true"><span><small>PLAYBACK</small><b data-theme-info-field="playbackState">IDLE</b></span><span><small>FORMAT</small><b data-theme-info-field="technical">LOCAL</b></span><span><small>ROUTE</small><b data-theme-info-field="route">SYSTEM DEFAULT</b></span><span><small>QUEUE</small><b data-theme-info-field="queue">00</b></span><span><small>ARTWORK</small><b data-theme-info-field="artwork">00 / 00</b></span></aside>` },
      { slot: 'player.overlay', markup: `<div class="aftergarden-player-confirmed" aria-hidden="true"><small>CONFIRMED CUTTING</small><strong data-theme-info-field="current">NOTHING PLAYING</strong><span data-theme-info-field="neighborhood">-- / -- / --</span></div>` },
    ],
    project(bundles) {
      const collection = bundles['collection.summary']; const neighborhood = bundles['playback.neighborhood']; const technical = bundles['playback.technical']; const output = bundles['output.route']; const queue = bundles['queue.summary']; const artwork = bundles['artwork.summary'];
      const track = technical.track;
      return Object.freeze({
        fields: Object.freeze({
          collectionCount: `${String(collection.trackCount).padStart(2, '0')} CUTTINGS`,
          currentPosition: neighborhood.currentIndex >= 0 ? `${String(neighborhood.currentIndex + 1).padStart(2, '0')} / ${String(neighborhood.total).padStart(2, '0')}` : '-- / --',
          playbackState: neighborhood.current ? neighborhood.phase === 'playing' ? 'CONFIRMED PLAYING' : 'CURRENT PAUSED' : neighborhood.total ? 'READY' : 'EMPTY',
          technical: track ? `${track.format}${track.bitDepth ? ` ${track.bitDepth}-BIT` : ''}${track.sampleRate ? ` / ${Math.round(track.sampleRate / 1000)} KHZ` : ''}` : 'LOCAL',
          route: output.label,
          queue: String(queue.count).padStart(2, '0'),
          artwork: `${String(artwork.total - artwork.missing).padStart(2, '0')} / ${String(artwork.total).padStart(2, '0')}`,
          current: neighborhood.current?.title || 'NOTHING PLAYING',
          neighborhood: `${neighborhood.previous?.title || '--'} / ${neighborhood.current?.title || '--'} / ${neighborhood.next?.title || '--'}`,
        }),
        states: Object.freeze({ playbackPhase: neighborhood.phase }),
      });
    },
  };
  if (!registry.hasProfile(profile.key)) registry.registerProfile(profile);
  return Object.freeze({ profile });
}));
