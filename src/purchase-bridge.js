(function initPurchaseBridge(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PixelodyPurchaseBridge = api;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  'use strict';

  const SCHEMA_VERSION = 2;
  const PROVIDERS = Object.freeze({
    bandcamp: Object.freeze({
      key: 'bandcamp',
      name: 'Bandcamp',
      checkoutOwner: 'Bandcamp',
      searchOrigin: 'https://bandcamp.com',
      searchPath: '/search',
    }),
  });

  function cleanText(value, limit = 180) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
  }

  function cleanBpm(value) {
    const bpm = Number(value);
    return Number.isFinite(bpm) && bpm >= 20 && bpm <= 400 ? Math.round(bpm) : null;
  }

  function releaseFromTrack(track = {}) {
    const title = cleanText(track.title, 240);
    const album = cleanText(track.album, 240);
    const artist = cleanText(track.artist, 180);
    const kind = title ? 'track' : album ? 'album' : 'unknown';
    return Object.freeze({
      kind,
      title: title || album || 'Unknown recording',
      trackTitle: title,
      album,
      artist: artist || 'Unknown artist',
    });
  }

  function joinTerms(...values) {
    return values
      .map((value) => cleanText(value, 240))
      .filter((value) => value && value !== 'Unknown artist' && value !== 'Unknown recording')
      .join(' ')
      .trim();
  }

  function buildSearchTerms(release) {
    return joinTerms(release.artist, release.trackTitle || release.title);
  }

  function buildBandcampSearchUrl(queryOrRelease) {
    const provider = PROVIDERS.bandcamp;
    const terms = typeof queryOrRelease === 'string'
      ? cleanText(queryOrRelease, 240)
      : buildSearchTerms(queryOrRelease || {});
    if (!terms) return '';
    const query = encodeURIComponent(terms);
    return `${provider.searchOrigin}${provider.searchPath}?q=${query}`;
  }

  function buildSearchCandidates(track = {}) {
    const release = releaseFromTrack(track);
    const artist = release.artist === 'Unknown artist' ? '' : release.artist;
    const candidates = [];
    const seen = new Set();
    const add = (key, label, query, basis) => {
      const cleaned = cleanText(query, 240);
      const normalized = cleaned.toLocaleLowerCase();
      if (!cleaned || seen.has(normalized)) return;
      seen.add(normalized);
      candidates.push(Object.freeze({
        key,
        label,
        query: cleaned,
        url: buildBandcampSearchUrl(cleaned),
        basis: Object.freeze([...basis]),
      }));
    };
    if (artist && release.trackTitle) add('track', 'Track', joinTerms(artist, release.trackTitle), ['artist', 'title']);
    if (artist && release.album) add('album', 'Album', joinTerms(artist, release.album), ['artist', 'album']);
    add('artist', 'Artist', artist, ['artist']);
    if (!artist) add('title', 'Title only', release.trackTitle || release.album, ['title']);
    return Object.freeze(candidates);
  }

  function identityFromTrack(track = {}) {
    const clues = [];
    const add = (key, label, value) => {
      const cleaned = cleanText(value, 180);
      if (cleaned) clues.push(Object.freeze({ key, label, value: cleaned }));
    };
    add('album', 'Album', track.album);
    add('isrc', 'ISRC', track.isrc);
    const bpm = cleanBpm(track.bpm);
    if (bpm) add('bpm', 'BPM', String(bpm));
    add('year', 'Year', track.year);
    add('label', 'Label', track.label);
    return Object.freeze({
      clues: Object.freeze(clues),
      identification: 'local-metadata-clues-not-proof',
    });
  }

  function isAllowedOfferUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return url.protocol === 'https:'
        && url.hostname === 'bandcamp.com'
        && url.pathname === '/search'
        && Boolean(url.searchParams.get('q')?.trim());
    } catch {
      return false;
    }
  }

  function createPlan(track = {}) {
    const release = releaseFromTrack(track);
    const provider = PROVIDERS.bandcamp;
    const searches = buildSearchCandidates(track);
    const primary = searches[0] || null;
    if (primary && !isAllowedOfferUrl(primary.url)) throw new Error('Purchase bridge produced an unsafe offer URL.');
    return Object.freeze({
      schemaVersion: SCHEMA_VERSION,
      release,
      identity: identityFromTrack(track),
      searches,
      offer: Object.freeze({
        providerKey: provider.key,
        providerName: provider.name,
        checkoutOwner: provider.checkoutOwner,
        query: primary?.query || '',
        url: primary?.url || '',
        actionLabel: `Search ${provider.name}`,
      }),
      truth: Object.freeze({
        checkout: 'external',
        purchaseVerification: 'not-verified-by-pixelody',
        localOwnership: 'requires-local-import',
        searchMatch: 'candidate-not-verified-match',
      }),
    });
  }

  return Object.freeze({
    SCHEMA_VERSION,
    PROVIDERS,
    cleanText,
    cleanBpm,
    releaseFromTrack,
    joinTerms,
    buildSearchTerms,
    buildBandcampSearchUrl,
    buildSearchCandidates,
    identityFromTrack,
    isAllowedOfferUrl,
    createPlan,
  });
});
