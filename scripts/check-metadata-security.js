'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

async function child(file) {
  const metadata = await import(pathToFileURL(require.resolve('music-metadata')));
  try {
    const result = await metadata.parseFile(file, { duration: true });
    console.log(JSON.stringify({ outcome: 'resolved', duration: result.format.duration }));
  } catch (error) {
    console.log(JSON.stringify({ outcome: 'rejected', message: error.message }));
  }
  // A detached rejection used to kill the process after the parse promise settled.
  await new Promise(resolve => setTimeout(resolve, 100));
  console.log('PROCESS_SURVIVED');
}

function check() {
  const temp = path.resolve(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(temp, 'pixelody-metadata-security-'));
  try {
    const dsf = Buffer.alloc(40);
    dsf.write('DSD '); dsf.writeBigUInt64LE(28n, 4);
    dsf.writeBigUInt64LE(40n, 12); dsf.writeBigUInt64LE(40n, 20);
    dsf.write('JUNK', 28); dsf.writeBigUInt64LE(1n, 32);
    // Valid WebM doctype followed by a string length exceeding its parent/file.
    // The declared leaf is only 128 KiB; no giant-allocation exploit is executed.
    const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x8e, 0x42, 0x82, 0x84,
      0x77, 0x65, 0x62, 0x6d, 0x42, 0x82, 0x10, 0x02, 0x00, 0x00, 0x01]);
    const u32 = value => { const result = Buffer.alloc(4); result.writeUInt32BE(value); return result; };
    const atom = (type, bytes) => Buffer.concat([u32(bytes.length + 8), Buffer.from(type), bytes]);
    const mp4 = Buffer.concat([
      atom('ftyp', Buffer.concat([Buffer.from('M4A '), u32(0)])),
      atom('stsd', Buffer.concat([Buffer.alloc(4), u32(0xffffffff), u32(0),
        Buffer.from('mp4a'), Buffer.alloc(6), Buffer.from([0, 1])])),
    ]);
    const wav = Buffer.alloc(44 + 8820);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(88200, 28);
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
    for (const [name, bytes, expected] of [
      ['short-chunk.dsf', dsf, /Invalid JUNK chunk size/],
      ['oversized-leaf.webm', webm, /Invalid element length/],
      ['zero-entry-size.m4a', mp4, null],
      ['valid.wav', wav, null],
    ]) {
      const file = path.join(directory, name);
      fs.writeFileSync(file, bytes);
      const run = spawnSync(process.execPath, ['--max-old-space-size=128', __filename, '--child', file],
        { timeout: 4000, maxBuffer: 1024 * 1024, windowsHide: true });
      assert.equal(run.status, 0, `${name} crashed or timed out: ${run.stderr}`);
      const output = run.stdout.toString();
      assert.ok(output.includes('PROCESS_SURVIVED'), `${name} did not survive deferred outcomes`);
      const result = JSON.parse(output.split(/\r?\n/).find(line => line.startsWith('{')));
      assert.equal(result.outcome, name === 'valid.wav' ? 'resolved' : 'rejected', name);
      if (expected) assert.match(result.message, expected, `${name} must reach its length validator`);
      if (name === 'valid.wav') assert.ok(Math.abs(result.duration - 0.1) < 0.001);
      console.log(`PASS metadata security: ${name}`);
    }
  } finally {
    assert.equal(path.dirname(directory), temp);
    assert.ok(path.basename(directory).startsWith('pixelody-metadata-security-'));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[2] === '--child') child(process.argv[3]).catch(error => { console.error(error); process.exitCode = 1; });
else check();
