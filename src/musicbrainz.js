(function pixelodyMusicBrainzFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyMusicBrainz = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createMusicBrainzModule() {
  'use strict';

  // MusicBrainz metadata repair, pure parts. The main process performs the one
  // network request (src/main.js, channel metadata:musicbrainz-search) using
  // buildSearchUrl() and the rate limiter below; the renderer ranks the results
  // and builds a field-by-field preview. Nothing is written to a track until
  // the person ticks fields and applies them.
  //
  // API etiquette (https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting):
  // at most one request per second, and an identifying User-Agent with a
  // contact. The contact is the public project page, not a personal address.

  const API_ORIGIN = 'https://musicbrainz.org';
  const API_PATH = '/ws/2/recording';
  const CONTACT_URL = 'https://github.com/varText-dragen-develiper/pixelody';
  const MIN_REQUEST_INTERVAL_MS = 1100;
  const RESULT_LIMIT = 5;
  const CONFIDENCE_HIGH = 85;
  const CONFIDENCE_MEDIUM = 65;

  function userAgent(version) {
    const safe = /^[0-9A-Za-z.+-]{1,32}$/.test(String(version || '')) ? version : '0.0.0';
    return `Pixelody/${safe} ( ${CONTACT_URL} )`;
  }

  function clean(value, max = 300) {
    return String(value ?? '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  // Lucene phrase escaping: inside a quoted phrase only backslash and the
  // quote itself are special.
  function phrase(value) {
    return `"${clean(value).replace(/[\\"]/g, '\\$&')}"`;
  }

  function buildSearchUrl(track = {}) {
    const title = clean(track.title);
    if (!title) return '';
    const clauses = [`recording:${phrase(title)}`];
    const artist = clean(track.artist);
    if (artist && artist.toLowerCase() !== 'unknown artist') clauses.push(`artist:${phrase(artist)}`);
    const album = clean(track.album);
    if (album) clauses.push(`release:${phrase(album)}`);
    const params = new URLSearchParams({ query: clauses.join(' AND '), fmt: 'json', limit: String(RESULT_LIMIT) });
    return `${API_ORIGIN}${API_PATH}?${params.toString()}`;
  }

  // Exact origin and path, https only, no credentials: the main process refuses
  // to fetch anything else.
  function isAllowedSearchUrl(value) {
    try {
      const url = new URL(String(value));
      return url.protocol === 'https:' && url.origin === API_ORIGIN && url.pathname === API_PATH && !url.username && !url.password;
    } catch {
      return false;
    }
  }

  function createRateLimiter({ minIntervalMs = MIN_REQUEST_INTERVAL_MS, now = () => Date.now(), sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
    let last = 0;
    let tail = Promise.resolve();
    // Runs tasks one at a time, each starting at least minIntervalMs after the
    // previous one started, whether or not the previous one failed.
    function schedule(task) {
      const run = tail.then(async () => {
        const wait = last + minIntervalMs - now();
        if (wait > 0) await sleep(wait);
        last = now();
        return task();
      });
      tail = run.catch(() => {});
      return run;
    }
    return Object.freeze({ schedule });
  }

  function normalize(value) {
    return clean(value, 500).toLowerCase()
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/\(.*?\)|\[.*?\]/g, ' ')
      .replace(/\b(feat|ft|featuring)\b.*$/g, ' ')
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function bigrams(text) {
    const compact = text.replace(/\s+/g, ' ');
    if (compact.length < 2) return compact ? [compact] : [];
    const out = [];
    for (let i = 0; i < compact.length - 1; i += 1) out.push(compact.slice(i, i + 2));
    return out;
  }

  // Dice coefficient on character bigrams: 1 for equal text, forgiving of a
  // dropped word or a typo.
  function similarity(left, right) {
    const a = normalize(left);
    const b = normalize(right);
    if (!a || !b) return 0;
    if (a === b) return 1;
    const first = bigrams(a);
    const second = bigrams(b);
    if (!first.length || !second.length) return 0;
    const counts = new Map();
    first.forEach((pair) => counts.set(pair, (counts.get(pair) || 0) + 1));
    let overlap = 0;
    second.forEach((pair) => {
      const count = counts.get(pair) || 0;
      if (count > 0) { overlap += 1; counts.set(pair, count - 1); }
    });
    return (2 * overlap) / (first.length + second.length);
  }

  function durationScore(localSeconds, remoteMs) {
    const local = Number(localSeconds);
    const remote = Number(remoteMs) / 1000;
    if (!(local > 0) || !(remote > 0)) return 0.5;
    const difference = Math.abs(local - remote);
    if (difference <= 2) return 1;
    if (difference <= 5) return 0.7;
    if (difference <= 10) return 0.3;
    return 0;
  }

  function creditText(credit) {
    if (!Array.isArray(credit)) return '';
    return credit.map((part) => `${part?.name || part?.artist?.name || ''}${part?.joinphrase || ''}`).join('').trim();
  }

  function yearOf(date) {
    const match = /^(\d{4})/.exec(String(date || ''));
    const year = match ? Number(match[1]) : 0;
    return year >= 1000 && year <= 9999 ? year : null;
  }

  function trackNumberOf(release) {
    for (const medium of release?.media || []) {
      for (const entry of medium?.track || []) {
        const number = Number(entry?.number);
        if (Number.isInteger(number) && number > 0) return number;
      }
    }
    return null;
  }

  function parseSearchResponse(payload) {
    const recordings = Array.isArray(payload?.recordings) ? payload.recordings : [];
    return recordings.filter((recording) => recording && typeof recording.id === 'string' && clean(recording.title)).map((recording) => ({
        mbid: recording.id,
        mbScore: Math.max(0, Math.min(100, Number(recording.score) || 0)),
        title: clean(recording.title),
        artist: creditText(recording['artist-credit']),
        lengthMs: Number(recording.length) || 0,
        isrc: Array.isArray(recording.isrcs) && recording.isrcs[0] ? clean(recording.isrcs[0], 20) : '',
        releases: (Array.isArray(recording.releases) ? recording.releases : []).slice(0, 12).map((item) => ({
          title: clean(item.title),
          date: clean(item.date, 12),
          status: clean(item.status, 40),
          albumArtist: creditText(item['artist-credit']),
          trackNumber: trackNumberOf(item),
        })),
    }));
  }

  function candidateRelease(candidate, localAlbum) {
    const releases = candidate.releases || [];
    if (!releases.length) return null;
    if (clean(localAlbum)) {
      // An exact title (a Deluxe edition the person has) beats a near one.
      const exact = (title) => (clean(title).toLowerCase() === clean(localAlbum).toLowerCase() ? 2 : 0);
      const ranked = releases.map((release) => ({ release, score: exact(release.title) + similarity(localAlbum, release.title) })).sort((a, b) => b.score - a.score);
      if (ranked[0].score >= 0.8) return ranked[0].release;
    }
    const official = releases.filter((release) => !release.status || release.status === 'Official');
    const pool = official.length ? official : releases;
    const dated = pool.filter((release) => yearOf(release.date)).sort((a, b) => a.date.localeCompare(b.date));
    return dated[0] || pool[0];
  }

  function confidenceFor(track, candidate) {
    const title = similarity(track.title, candidate.title);
    const artistKnown = clean(track.artist) && clean(track.artist).toLowerCase() !== 'unknown artist';
    const artist = artistKnown ? similarity(track.artist, candidate.artist) : 0.5;
    const album = clean(track.album) ? Math.max(0, ...(candidate.releases || []).map((release) => similarity(track.album, release.title))) : 0.6;
    const duration = durationScore(track.duration, candidate.lengthMs);
    const value = 0.35 * title + 0.25 * artist + 0.15 * album + 0.1 * duration + 0.15 * (candidate.mbScore / 100);
    return Math.round(Math.max(0, Math.min(1, value)) * 100);
  }

  function confidenceLevel(confidence) {
    if (confidence >= CONFIDENCE_HIGH) return 'high';
    if (confidence >= CONFIDENCE_MEDIUM) return 'medium';
    return 'low';
  }

  function rankCandidates(track, candidates) {
    return (candidates || []).map((candidate) => {
      const confidence = confidenceFor(track, candidate);
      return { ...candidate, confidence, level: confidenceLevel(confidence) };
    }).sort((a, b) => b.confidence - a.confidence);
  }

  const PROPOSAL_FIELDS = Object.freeze([
    { key: 'title', label: 'Title' },
    { key: 'artist', label: 'Artist' },
    { key: 'album', label: 'Album' },
    { key: 'albumArtist', label: 'Album artist' },
    { key: 'year', label: 'Year' },
    { key: 'trackNumber', label: 'Track #' },
    { key: 'isrc', label: 'ISRC' },
  ]);

  function isBlank(key, value) {
    if (key === 'artist') return !clean(value) || clean(value).toLowerCase() === 'unknown artist';
    return value === null || value === undefined || clean(value) === '';
  }

  // The preview: each field that would change, tagged "fill" (the track has
  // nothing there) or "change" (it would replace something). Fills are
  // pre-ticked; overwrites are not.
  function buildProposal(track, candidate) {
    const release = candidateRelease(candidate, track.album);
    const proposed = {
      title: candidate.title,
      artist: candidate.artist,
      album: release?.title || '',
      albumArtist: release?.albumArtist || '',
      year: release ? yearOf(release.date) : null,
      trackNumber: release?.trackNumber || null,
      isrc: candidate.isrc || '',
    };
    const fields = [];
    for (const field of PROPOSAL_FIELDS) {
      const next = proposed[field.key];
      if (isBlank(field.key, next)) continue;
      const current = track[field.key];
      const same = typeof next === 'number' ? Number(current) === next : clean(current) === clean(next);
      if (same) continue;
      const fill = isBlank(field.key, current);
      fields.push({ key: field.key, label: field.label, current: fill ? '' : current, proposed: next, kind: fill ? 'fill' : 'change', checked: fill });
    }
    return { mbid: candidate.mbid, confidence: candidate.confidence, level: candidate.level, fields };
  }

  // Applies the ticked fields of a proposal to a track, reporting what changed.
  function applyProposal(track, proposal, selectedKeys) {
    const keys = new Set(selectedKeys);
    const applied = [];
    for (const field of proposal.fields) {
      if (!keys.has(field.key)) continue;
      track[field.key] = field.proposed;
      applied.push(field.key);
    }
    if (applied.length) {
      track.localMetadataOverride = true;
      track.musicBrainzRecordingId = proposal.mbid;
    }
    return applied;
  }

  return Object.freeze({
    API_ORIGIN,
    API_PATH,
    CONFIDENCE_HIGH,
    CONFIDENCE_MEDIUM,
    CONTACT_URL,
    MIN_REQUEST_INTERVAL_MS,
    RESULT_LIMIT,
    applyProposal,
    buildProposal,
    buildSearchUrl,
    confidenceFor,
    confidenceLevel,
    createRateLimiter,
    isAllowedSearchUrl,
    parseSearchResponse,
    rankCandidates,
    similarity,
    userAgent,
  });
}));
