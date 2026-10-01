(function pixelodyCounterformInformationProfileFactory(root, factory) {
  const registry = (typeof module === 'object' && module.exports)
    ? require('../registry')
    : root && root.PixelodyInformationRegistry;
  const api = factory(registry);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyCounterformInformationProfile = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createCounterformInformationProfileApi(registry) {
  'use strict';

  if (!registry) throw new Error('Counterform Choir information profile requires PixelodyInformationRegistry first.');

  const profile = {
    key: 'counterform-choir',
    bundles: ['playback.neighborhood'],
    regions: [
      {
        slot: 'hero.overlay',
        markup: `<div class="counterform-choir-hud" aria-hidden="true">
          <span class="cf-choir-mark">COUNTERFORM<br>CHOIR<small>SC-01 / LIVING SCORE / LOCAL ONLY</small></span>
          <span class="cf-hero-aperture"></span>
          <span class="cf-hero-readout"><span>VOICES<b id="cfHeroCount" data-theme-info-field="voiceCount">00</b></span><span>CURRENT<b id="cfHeroCurrent" data-theme-info-field="currentPosition">-- / --</b></span><span>STATE<b id="cfHeroState" data-theme-info-field="playbackState">READY</b></span></span>
        </div>`,
      },
      {
        slot: 'player.overlay',
        markup: `<div class="counterform-player-hud" aria-hidden="true">
          <span id="cfPlayerPrevious" data-theme-info-field="previous">PREVIOUS / --</span>
          <span class="cf-player-current" id="cfPlayerCurrent" data-theme-info-field="current">CURRENT / NOTHING PLAYING</span>
          <span id="cfPlayerNext" data-theme-info-field="next">NEXT / --</span>
        </div>`,
      },
    ],
    project(bundles) {
      const neighborhood = bundles['playback.neighborhood'];
      return Object.freeze({
        fields: Object.freeze({
          voiceCount: String(neighborhood.total).padStart(2, '0'),
          currentPosition: neighborhood.currentIndex >= 0
            ? `${String(neighborhood.currentIndex + 1).padStart(2, '0')} / ${String(neighborhood.total).padStart(2, '0')}`
            : '-- / --',
          playbackState: neighborhood.current
            ? neighborhood.phase === 'playing' ? 'CONFIRMED PLAYING' : 'CURRENT PAUSED'
            : neighborhood.total ? 'CHOIR READY' : 'EMPTY',
          previous: `PREVIOUS / ${neighborhood.previous?.title || '--'}`,
          current: `CURRENT / ${neighborhood.current?.title || 'NOTHING PLAYING'}`,
          next: `NEXT / ${neighborhood.next?.title || '--'}`,
        }),
        states: Object.freeze({ playbackPhase: neighborhood.phase }),
      });
    },
  };

  if (!registry.hasProfile(profile.key)) registry.registerProfile(profile);
  return Object.freeze({ profile });
}));
