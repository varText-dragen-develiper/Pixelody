const fs = require('fs/promises');
const path = require('path');

// Read-only integrity check for library audio files. It answers one question
// honestly -- "is this still the file Pixelody imported, and does it look like
// the format its name claims?" -- without decoding audio. A header that matches
// is NOT a guarantee of clean audio; the UI says "looks intact", never "verified
// bit-perfect".

const HEADER_BYTES = 4096;
const MAX_BATCH = 5000;
const CONCURRENCY = 8;

const STATUS = Object.freeze({
  ok: 'ok',
  missing: 'missing',
  unreadable: 'unreadable',
  empty: 'empty',
  changed: 'changed',
  mismatch: 'header-mismatch',
  truncated: 'truncated',
});

function startsWith(buffer, text, offset = 0) {
  return buffer.length >= offset + text.length && buffer.toString('latin1', offset, offset + text.length) === text;
}

function looksLikeMp3(buffer) {
  if (startsWith(buffer, 'ID3')) return true;
  // Frame sync (11 set bits) within the first few KB, after any junk padding.
  const limit = Math.min(buffer.length - 1, 4095);
  for (let i = 0; i < limit; i += 1) if (buffer[i] === 0xff && (buffer[i + 1] & 0xe0) === 0xe0) return true;
  return false;
}

// Returns a recognised container name when the header is plausible for the
// extension, or '' when it is not. Unknown extensions are never rejected.
function headerMatchesExtension(buffer, extension) {
  switch (extension) {
    case '.flac': return startsWith(buffer, 'fLaC') || startsWith(buffer, 'ID3');
    case '.wav': case '.wave': return startsWith(buffer, 'RIFF') && startsWith(buffer, 'WAVE', 8) || startsWith(buffer, 'RF64') || startsWith(buffer, 'BW64');
    case '.aiff': case '.aif': return startsWith(buffer, 'FORM') && (startsWith(buffer, 'AIFF', 8) || startsWith(buffer, 'AIFC', 8));
    case '.mp3': return looksLikeMp3(buffer);
    case '.m4a': return startsWith(buffer, 'ftyp', 4);
    case '.aac': return startsWith(buffer, 'ADIF') || startsWith(buffer, 'ID3') || (buffer.length > 1 && buffer[0] === 0xff && (buffer[1] & 0xf0) === 0xf0);
    case '.ogg': case '.opus': return startsWith(buffer, 'OggS');
    default: return true;
  }
}

// RIFF/WAVE declares its own length; a file shorter than that was cut off.
function wavIsTruncated(buffer, size) {
  if (!startsWith(buffer, 'RIFF') || !startsWith(buffer, 'WAVE', 8) || buffer.length < 8) return false;
  const declared = buffer.readUInt32LE(4) + 8;
  return declared !== 0xffffffff + 8 && size < declared;
}

async function verifyFile(filePath, baseline = null, { fsImpl = fs } = {}) {
  const extension = path.extname(String(filePath)).toLowerCase();
  let stats;
  try { stats = await fsImpl.stat(filePath); } catch (error) {
    return { status: error && error.code === 'ENOENT' ? STATUS.missing : STATUS.unreadable, size: 0, mtimeMs: 0 };
  }
  const fingerprint = { size: stats.size, mtimeMs: Math.round(stats.mtimeMs) };
  if (!stats.isFile()) return { status: STATUS.unreadable, ...fingerprint };
  if (stats.size === 0) return { status: STATUS.empty, ...fingerprint };
  let handle;
  let header;
  try {
    handle = await fsImpl.open(filePath, 'r');
    const buffer = Buffer.alloc(Math.min(HEADER_BYTES, stats.size));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    header = buffer.subarray(0, bytesRead);
  } catch {
    return { status: STATUS.unreadable, ...fingerprint };
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
  if (!headerMatchesExtension(header, extension)) return { status: STATUS.mismatch, ...fingerprint };
  if ((extension === '.wav' || extension === '.wave') && wavIsTruncated(header, stats.size)) return { status: STATUS.truncated, ...fingerprint };
  const known = baseline && Number.isFinite(baseline.size) && Number.isFinite(baseline.mtimeMs);
  if (known && (baseline.size !== fingerprint.size || baseline.mtimeMs !== fingerprint.mtimeMs)) return { status: STATUS.changed, ...fingerprint };
  return { status: STATUS.ok, ...fingerprint };
}

// entries: [{ path, size?, mtimeMs? }]. Returns results in the same order.
async function verifyFiles(entries, options = {}) {
  const list = Array.isArray(entries) ? entries.slice(0, MAX_BATCH) : [];
  const results = new Array(list.length);
  let cursor = 0;
  async function worker() {
    while (cursor < list.length) {
      const index = cursor++;
      const entry = list[index];
      results[index] = await verifyFile(entry.path, entry, options);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker));
  return results;
}

function summarize(results) {
  const counts = {};
  for (const result of results) counts[result.status] = (counts[result.status] || 0) + 1;
  const problems = results.length - (counts.ok || 0);
  return { checked: results.length, problems, counts };
}

module.exports = { HEADER_BYTES, MAX_BATCH, STATUS, headerMatchesExtension, summarize, verifyFile, verifyFiles };
