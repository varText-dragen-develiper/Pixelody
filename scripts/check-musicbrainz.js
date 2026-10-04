const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mb = require('../src/musicbrainz');
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

(async () => {
  // Query building: escaped, bounded, and always the one allowed endpoint.
  const url = new URL(mb.buildSearchUrl({ title: 'Say "Yes" \\ No', artist: 'The Band', album: 'Debut', duration: 200 }));
  assert.equal(url.origin + url.pathname, 'https://musicbrainz.org/ws/2/recording');
  assert.equal(url.searchParams.get('fmt'), 'json');
  assert.equal(url.searchParams.get('limit'), '5');
  assert.equal(url.searchParams.get('query'), 'recording:"Say \\"Yes\\" \\\\ No" AND artist:"The Band" AND release:"Debut"', 'quotes and backslashes are escaped inside phrases');
  assert.equal(new URL(mb.buildSearchUrl({ title: 'Song', artist: 'Unknown artist' })).searchParams.get('query'), 'recording:"Song"', 'an unknown artist is not searched for');
  assert.equal(mb.buildSearchUrl({ title: '   ' }), '', 'a track with no title cannot be looked up');
  assert.ok(mb.buildSearchUrl({ title: 'x'.repeat(5000) }).length < 1200, 'the query is bounded');
  assert.ok(!/[\u0000-\u001f]/.test(decodeURIComponent(mb.buildSearchUrl({ title: 'A\nB\u0000C' }))), 'control characters are stripped');

  for (const allowed of [mb.buildSearchUrl({ title: 'x' })]) assert.equal(mb.isAllowedSearchUrl(allowed), true);
  for (const hostile of ['http://musicbrainz.org/ws/2/recording?query=x', 'https://musicbrainz.org.evil.invalid/ws/2/recording', 'https://evil.invalid/ws/2/recording', 'https://user:pw@musicbrainz.org/ws/2/recording', 'https://musicbrainz.org/ws/2/artist?query=x', 'https://musicbrainz.org/', 'file:///etc/passwd', '', 'not a url', null, undefined]) {
    assert.equal(mb.isAllowedSearchUrl(hostile), false, `refused: ${hostile}`);
  }

  assert.equal(mb.userAgent('0.1.1'), 'Pixelody/0.1.1 ( https://github.com/varText-dragen-develiper/pixelody )', 'User-Agent names the app, its version and the public project page');
  assert.equal(mb.userAgent('1.0\r\nX-Evil: 1'), 'Pixelody/0.0.0 ( https://github.com/varText-dragen-develiper/pixelody )', 'a hostile version string cannot inject headers');
  assert.ok(!/@/.test(mb.userAgent('1.0.0')), 'the User-Agent carries no personal address');

  // Rate limiter: serial, spaced, survives failures.
  let clock = 10_000;
  const sleeps = [];
  const limiter = mb.createRateLimiter({ minIntervalMs: 1000, now: () => clock, sleep: async (ms) => { sleeps.push(ms); clock += ms; } });
  const started = [];
  const results = await Promise.allSettled([1, 2, 3].map((n) => limiter.schedule(async () => { started.push(clock); if (n === 2) throw new Error('boom'); return n; })));
  assert.deepEqual(results.map((result) => result.status), ['fulfilled', 'rejected', 'fulfilled'], 'a failed request does not block the next');
  assert.ok(started[1] - started[0] >= 1000 && started[2] - started[1] >= 1000, 'requests start at least one interval apart');
  assert.equal(mb.MIN_REQUEST_INTERVAL_MS >= 1000, true, 'the shipped interval respects the one-per-second policy');
  let active = 0;
  let overlap = false;
  const slow = mb.createRateLimiter({ minIntervalMs: 0, sleep: async () => {} });
  await Promise.all([1, 2, 3].map(() => slow.schedule(async () => { active += 1; if (active > 1) overlap = true; await new Promise((resolve) => setTimeout(resolve, 5)); active -= 1; })));
  assert.equal(overlap, false, 'lookups never overlap');

  // Parsing and scoring against a recorded-shape response.
  const payload = {
    recordings: [
      { id: 'r-wrong', score: 100, title: 'Midnight City (Live)', length: 330000, 'artist-credit': [{ name: 'Someone Else' }], releases: [{ title: 'Live 2011', date: '2011-11-01', status: 'Official', 'artist-credit': [{ name: 'Someone Else' }] }] },
      { id: 'r-right', score: 98, title: 'Midnight City', length: 243000, isrcs: ['FR6V81109950'], 'artist-credit': [{ name: 'M83' }], releases: [
        { title: 'Hurry Up, We\'re Dreaming', date: '2011-10-18', status: 'Official', 'artist-credit': [{ name: 'M83' }], media: [{ track: [{ number: '2' }] }] },
        { title: 'Midnight City', date: '2011-08-17', status: 'Promotion', 'artist-credit': [{ name: 'M83' }] },
        { title: 'Hurry Up, We\'re Dreaming (Deluxe)', date: '2012-01-01', status: 'Official', 'artist-credit': [{ name: 'M83' }] },
      ] },
      { id: 5, title: 'bad id' },
      null,
    ],
  };
  const parsed = mb.parseSearchResponse(payload);
  assert.equal(parsed.length, 2, 'malformed entries are dropped');
  assert.equal(mb.parseSearchResponse({}).length, 0);
  assert.equal(mb.parseSearchResponse(null).length, 0);
  const local = { title: 'Midnight City', artist: 'M83', album: '', duration: 243.4 };
  const ranked = mb.rankCandidates(local, parsed);
  assert.equal(ranked[0].mbid, 'r-right', 'the matching recording outranks a live version with a higher raw score');
  assert.ok(ranked[0].confidence >= mb.CONFIDENCE_HIGH && ranked[0].level === 'high', `exact match is high confidence (${ranked[0].confidence})`);
  assert.ok(ranked[1].level !== 'high', 'a different artist and title is never high confidence');
  assert.ok(mb.confidenceFor({ title: 'Totally Different', artist: 'Nobody', duration: 30 }, parsed[1]) < mb.CONFIDENCE_MEDIUM, 'an unrelated track scores low');
  assert.ok(mb.similarity('Beyoncé', 'Beyonce') === 1, 'accents do not matter');
  assert.ok(mb.similarity('Song (Remastered 2011)', 'Song') === 1, 'bracketed suffixes do not matter');
  assert.ok(mb.similarity('', 'x') === 0);

  // Preview: fills are ticked, overwrites are not.
  const proposal = mb.buildProposal({ title: 'Midnight City', artist: 'M83', album: '', year: null, trackNumber: null, isrc: '', albumArtist: '' }, ranked[0]);
  const byKey = Object.fromEntries(proposal.fields.map((field) => [field.key, field]));
  assert.deepEqual(Object.keys(byKey).sort(), ['album', 'albumArtist', 'isrc', 'trackNumber', 'year'], 'only fields that would change are listed');
  assert.equal(byKey.album.proposed, 'Hurry Up, We\'re Dreaming', 'the earliest official release is chosen when no album is known');
  assert.equal(byKey.year.proposed, 2011);
  assert.equal(byKey.trackNumber.proposed, 2);
  assert.equal(byKey.isrc.proposed, 'FR6V81109950');
  assert.ok(proposal.fields.every((field) => field.kind === 'fill' && field.checked), 'filling blanks is pre-ticked');
  const overwrite = mb.buildProposal({ title: 'midnight city', artist: 'M83', album: 'Wrong Album', year: 1999 }, ranked[0]);
  const overwriteByKey = Object.fromEntries(overwrite.fields.map((field) => [field.key, field]));
  assert.equal(overwriteByKey.title.kind, 'change', 'a case-only difference is a change');
  assert.equal(overwriteByKey.album.kind, 'change');
  assert.equal(overwriteByKey.year.kind, 'change');
  assert.ok(overwrite.fields.filter((field) => field.kind === 'change').every((field) => !field.checked), 'replacing existing values is never pre-ticked');
  assert.equal(overwriteByKey.album.current, 'Wrong Album', 'the preview shows what would be replaced');
  const unknownArtist = mb.buildProposal({ title: 'Midnight City', artist: 'Unknown artist' }, ranked[0]);
  assert.equal(unknownArtist.fields.find((field) => field.key === 'artist').kind, 'fill', 'an unknown artist counts as blank');
  const albumKnown = mb.buildProposal({ title: 'Midnight City', artist: 'M83', album: 'Hurry Up, We\'re Dreaming (Deluxe)' }, ranked[0]);
  assert.ok(!albumKnown.fields.some((field) => field.key === 'album'), 'a matching local album picks that release and proposes no album change');
  assert.equal(albumKnown.fields.find((field) => field.key === 'year').proposed, 2012, 'year follows the matched release');

  // Applying touches only ticked fields.
  const track = { title: 'Midnight City', artist: 'M83', album: '', year: null };
  const applied = mb.applyProposal(track, proposal, ['year', 'album']);
  assert.deepEqual(applied.sort(), ['album', 'year']);
  assert.equal(track.year, 2011);
  assert.equal(track.isrc, undefined, 'unticked fields are untouched');
  assert.equal(track.localMetadataOverride, true, 'repaired tracks are marked as locally overridden so rescans keep them');
  assert.equal(track.musicBrainzRecordingId, 'r-right');
  const idle = { title: 'x' };
  assert.deepEqual(mb.applyProposal(idle, proposal, []), []);
  assert.equal(idle.localMetadataOverride, undefined, 'applying nothing marks nothing');

  // The privacy and etiquette surface must stay wired the way the docs say.
  const main = read('src/main.js');
  assert.match(main, /registerHandle\('metadata:musicbrainz-search'/, 'main must own the only MusicBrainz request');
  assert.match(main, /musicBrainzLimiter\.schedule/, 'lookups must go through the rate limiter');
  assert.match(main, /musicBrainz\.isAllowedSearchUrl\(url\)/, 'main must verify the URL it built');
  assert.match(main, /redirect: 'error'/, 'lookups must not follow redirects');
  assert.match(main, /'User-Agent': musicBrainz\.userAgent\(app\.getVersion\(\)\)/, 'lookups must identify Pixelody');
  assert.ok(!/musicbrainz\.org/i.test(read('src/renderer-domains/library-workflow.js')), 'the renderer never names an endpoint');
  assert.match(read('src/index.html'), /connect-src 'self' http:\/\/127\.0\.0\.1:\* http:\/\/localhost:\*;/, 'the renderer CSP must stay closed to the network');
  // A malformed server payload must degrade to fewer candidates, never throw
  // (a throw would be reported to the person as a network failure).
  const hostile = mb.parseSearchResponse({ recordings: [
    { id: 'a', title: 'Song', releases: [null, 7, 'x', { title: 'Real', media: { track: [{ number: '3' }] } }, { title: 'Also', media: [{ track: { number: 2 } }] }] },
    { id: 'b', title: 'Other', releases: { title: 'not an array' } },
  ] });
  assert.equal(hostile.length, 2, 'odd release lists must not drop the recording');
  assert.deepEqual(hostile[0].releases.map((release) => release.title), ['Real', 'Also'], 'only object releases are kept');
  assert.equal(hostile[0].releases[0].trackNumber, null, 'non-array media is ignored');

  console.log('MusicBrainz audit passed: query building, endpoint allowlist, rate limiting, scoring, preview-before-apply, and the privacy surface hold.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
