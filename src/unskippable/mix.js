(function unskippableMixFactory(root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('../shuffle/universal.js') : root.PixelodyUniversalShuffle);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyUnskippableMix = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createUnskippableMix(core) {
  'use strict';

  // An unskippable mix is a fixed tracklist made once, previewed, then saved.
  // Both styles order songs with the shared shuffle core in Flow mode, so the
  // general mix is the same Flow that shuffle plays and a rigid mix gets the
  // same smooth transitions inside its one genre. Kotlin mirrors this file
  // (UnskippableMix.kt) and both are held to docs/api-contract-fixtures/unskippable-v1.
  const VERSION = 1;
  const STYLES = Object.freeze(['rigid', 'flow']);
  const LENGTHS = Object.freeze([30, 60, 120]);
  const MIN_MINUTES = 10, MAX_MINUTES = 600, DEFAULT_MINUTES = 60;
  const UNKNOWN_DURATION_MS = 210000;
  // Rigid: at most one neighbour-genre song for every nine in the genre.
  const NEIGHBOUR_EVERY = 9;
  const STOP_TOKENS = new Set(['and', 'the', 'music', 'misc', 'other']);
  const ordinal = core.ordinal;

  function genresOf(raw) {
    if (typeof raw !== 'string') return [];
    const seen = new Set(), out = [];
    for (const part of raw.split(/[;,/|]/)) {
      const label = part.replace(/\s+/g, ' ').trim();
      const genreId = core.textIdentity(label);
      if (genreId && !seen.has(genreId)) { seen.add(genreId); out.push({ genreId, label }); }
    }
    return out;
  }
  function tokens(genreId) {
    return [...new Set(genreId.split(/[^a-z0-9]+/).filter((token) => token.length >= 3 && !STOP_TOKENS.has(token)))];
  }
  function minutesOf(value) {
    const minutes = Number.isSafeInteger(value) ? value : DEFAULT_MINUTES;
    return Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, minutes));
  }
  function normalizeRecipe(raw = {}) {
    const style = STYLES.includes(raw.style) ? raw.style : 'flow';
    const genre = style === 'rigid' ? genresOf(raw.genre)[0] || null : null;
    return {
      version: VERSION, style,
      genre: genre ? genre.label : null, genreId: genre ? genre.genreId : null,
      targetMinutes: minutesOf(raw.targetMinutes),
      seed: typeof raw.seed === 'string' && raw.seed ? raw.seed : 'unskippable',
      includedUntaggedIds: style === 'rigid' && Array.isArray(raw.includedUntaggedIds) ? [...new Set(raw.includedUntaggedIds.filter((value) => typeof value === 'string' && value))].sort(ordinal) : [],
    };
  }

  // items: [{ entry: <shuffle core entry>, durationMs }]. Missing songs never
  // enter a mix.
  function prepare(items) {
    const rows = [];
    for (const item of Array.isArray(items) ? items : []) {
      if (!item?.entry || item.entry.available === false) continue;
      const duration = Number.isSafeInteger(item.durationMs) && item.durationMs > 0 ? item.durationMs : UNKNOWN_DURATION_MS;
      rows.push({ entry: item.entry, trackId: item.entry.trackId, durationMs: duration, genres: genresOf(item.entry.genre), artistId: core.textIdentity(item.entry.artist) });
    }
    return rows;
  }

  // Genres to offer for a rigid mix, most songs first, plus how many songs
  // carry no genre tag at all so the screen can say so.
  function genreCatalog(items) {
    const rows = prepare(items);
    const counts = new Map();
    let untagged = 0;
    for (const row of rows) {
      if (!row.genres.length) { untagged += 1; continue; }
      for (const genre of row.genres) {
        const prior = counts.get(genre.genreId);
        if (prior) prior.count += 1; else counts.set(genre.genreId, { genreId: genre.genreId, label: genre.label, count: 1 });
      }
    }
    const genres = [...counts.values()].sort((a, b) => b.count - a.count || ordinal(a.genreId, b.genreId));
    return { genres, untaggedCount: untagged, untaggedTrackIds: rows.filter((row) => !row.genres.length).map((row) => row.trackId) };
  }

  // Orders rows with the shuffle core in Flow mode, one natural end at a time,
  // until stop(row, takenSoFar) says enough or the rows run out.
  function flowOrder(rows, seed, scope, stop) {
    if (!rows.length) return [];
    const byTrack = new Map(rows.map((row) => [row.trackId, row]));
    let state = core.createSession({
      sessionId: `unskippable:${scope}`, scopeId: `unskippable:${scope}`, authorityId: 'unskippable', seed: `${seed}\u0000${scope}`,
      mode: 'flow', repeat: 'off', options: { preset: 'flow' },
      entries: rows.map((row) => ({ ...row.entry, entryId: row.trackId, trackId: row.trackId })),
    });
    const taken = [];
    for (let step = 0; step < rows.length; step += 1) {
      const staged = core.stage(state, { attemptId: `unskippable-${step}`, advanceId: `unskippable-${step}`, naturalEnd: true, personal: false });
      if (!staged.pending) break;
      const row = byTrack.get(staged.pending.trackId);
      if (stop && stop(row, taken)) break;
      taken.push(row);
      state = core.commit(staged, staged.pending);
    }
    return taken;
  }
  const totalMs = (rows) => rows.reduce((sum, row) => sum + row.durationMs, 0);
  const fillTo = (targetMs) => (row, taken) => totalMs(taken) >= targetMs;

  // Songs from genres close to the chosen one: genres the same artists also
  // play, and genres sharing a word ("indie rock" next to "rock").
  function neighbourRows(rows, genreId, coreRows, seed) {
    const coreIds = new Set(coreRows.map((row) => row.trackId));
    const coreArtists = new Set(coreRows.map((row) => row.artistId).filter(Boolean));
    const wanted = tokens(genreId);
    const artistsByGenre = new Map();
    for (const row of rows) for (const genre of row.genres) {
      if (genre.genreId === genreId || !row.artistId || !coreArtists.has(row.artistId)) continue;
      if (!artistsByGenre.has(genre.genreId)) artistsByGenre.set(genre.genreId, new Set());
      artistsByGenre.get(genre.genreId).add(row.artistId);
    }
    const genreScore = (id) => (artistsByGenre.get(id)?.size || 0) * 2 + tokens(id).filter((token) => wanted.includes(token)).length * 3;
    const scored = [];
    for (const row of rows) {
      if (coreIds.has(row.trackId) || !row.genres.length) continue;
      const score = Math.max(...row.genres.map((genre) => genreScore(genre.genreId)));
      if (score > 0) scored.push({ row, score, tie: core.hashSeed(`${seed}\u0000${row.trackId}`) });
    }
    scored.sort((a, b) => b.score - a.score || a.tie - b.tie || ordinal(a.row.trackId, b.row.trackId));
    return scored.map((item) => item.row);
  }

  function coreRowsFor(rows, recipe) {
    const included = new Set(recipe.includedUntaggedIds);
    return rows.filter((row) => row.genres.some((genre) => genre.genreId === recipe.genreId) || (!row.genres.length && included.has(row.trackId)));
  }

  function result(recipe, picked, extras) {
    const targetMs = recipe.targetMinutes * 60000;
    const durationMs = totalMs(picked);
    return { version: VERSION, recipe, trackIds: picked.map((row) => row.trackId), durationMs, shortfallMs: Math.max(0, targetMs - durationMs), ...extras };
  }

  function generate(items, rawRecipe) {
    const recipe = normalizeRecipe(rawRecipe);
    const rows = prepare(items);
    const targetMs = recipe.targetMinutes * 60000;
    const untaggedTrackIds = rows.filter((row) => !row.genres.length).map((row) => row.trackId);
    if (recipe.style === 'flow') {
      const picked = flowOrder(rows, recipe.seed, 'flow', fillTo(targetMs));
      return result(recipe, picked, { neighbourIds: [], poolSize: rows.length, untaggedTrackIds, status: picked.length ? 'ready' : 'empty-library' });
    }
    if (!recipe.genreId) return result(recipe, [], { neighbourIds: [], poolSize: 0, untaggedTrackIds, status: 'needs-genre' });
    const coreRows = coreRowsFor(rows, recipe);
    if (!coreRows.length) return result(recipe, [], { neighbourIds: [], poolSize: 0, untaggedTrackIds, status: 'no-genre-songs' });
    const neighbourBudgetMs = Math.floor(targetMs / 10);
    const chosen = flowOrder(coreRows, recipe.seed, 'core', fillTo(targetMs - neighbourBudgetMs));
    const allowed = Math.floor(chosen.length / NEIGHBOUR_EVERY);
    const neighbours = [];
    let total = totalMs(chosen);
    for (const row of neighbourRows(rows, recipe.genreId, coreRows, recipe.seed)) {
      if (neighbours.length >= allowed || total >= targetMs) break;
      neighbours.push(row); total += row.durationMs;
    }
    // The neighbour cap can leave room; the genre itself fills it first.
    const used = new Set(chosen.map((row) => row.trackId));
    const more = flowOrder(coreRows.filter((row) => !used.has(row.trackId)), recipe.seed, 'core-fill', fillTo(targetMs - total));
    const picked = flowOrder([...chosen, ...more, ...neighbours], recipe.seed, 'order', null);
    return result(recipe, picked, { neighbourIds: neighbours.map((row) => row.trackId), poolSize: coreRows.length, untaggedTrackIds, status: 'ready' });
  }

  // Swaps one song for the best unused one: the same genre for a rigid mix
  // (a neighbour only replaces a neighbour), anything for a general mix.
  function swap(items, preview, trackId) {
    const recipe = normalizeRecipe(preview?.recipe);
    const ids = Array.isArray(preview?.trackIds) ? preview.trackIds : [];
    const index = ids.indexOf(trackId);
    if (index < 0) return null;
    const rows = prepare(items);
    const byTrack = new Map(rows.map((row) => [row.trackId, row]));
    const inMix = new Set(ids);
    let pool;
    let neighbourIds = Array.isArray(preview.neighbourIds) ? preview.neighbourIds : [];
    if (recipe.style === 'rigid') {
      const coreRows = coreRowsFor(rows, recipe);
      pool = neighbourIds.includes(trackId) ? neighbourRows(rows, recipe.genreId, coreRows, recipe.seed) : coreRows;
    } else pool = rows;
    const candidates = pool.filter((row) => !inMix.has(row.trackId));
    const swaps = Number.isSafeInteger(preview.swaps) ? preview.swaps + 1 : 1;
    const [replacement] = flowOrder(candidates, recipe.seed, `swap:${swaps}`, (row, taken) => taken.length >= 1);
    if (!replacement) return null;
    const trackIds = ids.slice();
    trackIds[index] = replacement.trackId;
    if (neighbourIds.includes(trackId)) neighbourIds = neighbourIds.map((value) => value === trackId ? replacement.trackId : value);
    const durationMs = trackIds.reduce((sum, value) => sum + (byTrack.get(value)?.durationMs || UNKNOWN_DURATION_MS), 0);
    return { ...preview, recipe, trackIds, neighbourIds, swaps, durationMs, shortfallMs: Math.max(0, recipe.targetMinutes * 60000 - durationMs) };
  }

  function remove(items, preview, trackId) {
    const ids = Array.isArray(preview?.trackIds) ? preview.trackIds : [];
    if (!ids.includes(trackId)) return null;
    const recipe = normalizeRecipe(preview.recipe);
    const byTrack = new Map(prepare(items).map((row) => [row.trackId, row]));
    const trackIds = ids.filter((value) => value !== trackId);
    const durationMs = trackIds.reduce((sum, value) => sum + (byTrack.get(value)?.durationMs || UNKNOWN_DURATION_MS), 0);
    return { ...preview, recipe, trackIds, neighbourIds: (preview.neighbourIds || []).filter((value) => value !== trackId), durationMs, shortfallMs: Math.max(0, recipe.targetMinutes * 60000 - durationMs) };
  }

  // Where a saved mix picks up: the song and position it was left at. A song
  // that has since gone missing moves on to the next one that is still there.
  function resumePoint(trackIds, progress, available = () => true) {
    const ids = Array.isArray(trackIds) ? trackIds : [];
    let index = progress && typeof progress.trackId === 'string' ? ids.indexOf(progress.trackId) : -1;
    let positionMs = index >= 0 && Number.isSafeInteger(progress.positionMs) && progress.positionMs > 0 ? progress.positionMs : 0;
    if (index < 0) { index = 0; positionMs = 0; }
    while (index < ids.length && !available(ids[index])) { index += 1; positionMs = 0; }
    return index < ids.length ? { index, trackId: ids[index], positionMs } : null;
  }

  return Object.freeze({ VERSION, STYLES, LENGTHS, MIN_MINUTES, MAX_MINUTES, DEFAULT_MINUTES, UNKNOWN_DURATION_MS, NEIGHBOUR_EVERY,
    genresOf, normalizeRecipe, genreCatalog, generate, swap, remove, resumePoint });
}));
