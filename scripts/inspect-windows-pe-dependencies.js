const fs = require('node:fs');
const path = require('node:path');

const targetArgument = process.argv.find((value) => value.startsWith('--target='))?.slice(9);
if (process.platform !== 'win32') throw new Error('PE dependency inspection is Windows-only.');
if (!targetArgument) throw new Error('Usage: node scripts/inspect-windows-pe-dependencies.js --target=<absolute-or-project-relative-exe>');
const target = path.resolve(targetArgument);
if (!fs.existsSync(target)) throw new Error(`Target does not exist: ${target}`);
const system32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');

function parsePe(file) {
  const data = fs.readFileSync(file);
  if (data.readUInt16LE(0) !== 0x5a4d) throw new Error(`${path.basename(file)} is not an MZ image.`);
  const pe = data.readUInt32LE(0x3c);
  if (data.readUInt32LE(pe) !== 0x00004550) throw new Error(`${path.basename(file)} is not a PE image.`);
  const coff = pe + 4;
  const sectionCount = data.readUInt16LE(coff + 2);
  const optionalSize = data.readUInt16LE(coff + 16);
  const optional = coff + 20;
  const magic = data.readUInt16LE(optional);
  const dataDirectories = optional + (magic === 0x20b ? 112 : magic === 0x10b ? 96 : (() => { throw new Error('Unsupported PE optional header.'); })());
  const sectionTable = optional + optionalSize;
  const sections = [];
  for (let index = 0; index < sectionCount; index += 1) {
    const offset = sectionTable + index * 40;
    sections.push({ virtualSize: data.readUInt32LE(offset + 8), virtualAddress: data.readUInt32LE(offset + 12), rawSize: data.readUInt32LE(offset + 16), rawOffset: data.readUInt32LE(offset + 20) });
  }
  function rvaOffset(rva) {
    const section = sections.find((item) => rva >= item.virtualAddress && rva < item.virtualAddress + Math.max(item.virtualSize, item.rawSize));
    if (!section) return -1;
    return section.rawOffset + rva - section.virtualAddress;
  }
  function textAtRva(rva) {
    const offset = rvaOffset(rva);
    if (offset < 0 || offset >= data.length) return '';
    let end = offset;
    while (end < data.length && data[end] !== 0 && end - offset < 512) end += 1;
    return data.toString('ascii', offset, end);
  }
  function directory(index) {
    return { rva: data.readUInt32LE(dataDirectories + index * 8), size: data.readUInt32LE(dataDirectories + index * 8 + 4) };
  }
  const imports = new Set();
  const regular = directory(1);
  let cursor = rvaOffset(regular.rva);
  if (regular.rva && cursor >= 0) {
    const limit = Math.min(data.length, cursor + regular.size);
    while (cursor + 20 <= limit) {
      const nameRva = data.readUInt32LE(cursor + 12);
      if (!nameRva) break;
      const name = textAtRva(nameRva);
      if (name) imports.add(name.toLowerCase());
      cursor += 20;
    }
  }
  const delayed = directory(13);
  cursor = rvaOffset(delayed.rva);
  if (delayed.rva && cursor >= 0) {
    const limit = Math.min(data.length, cursor + delayed.size);
    while (cursor + 32 <= limit) {
      const attributes = data.readUInt32LE(cursor);
      const nameValue = data.readUInt32LE(cursor + 4);
      if (!nameValue) break;
      const nameRva = (attributes & 1) === 1 ? nameValue : nameValue - (magic === 0x20b ? Number(data.readBigUInt64LE(optional + 24)) : data.readUInt32LE(optional + 28));
      const name = textAtRva(nameRva);
      if (name) imports.add(name.toLowerCase());
      cursor += 32;
    }
  }
  return [...imports].sort();
}

const rootDirectory = path.dirname(target);
const visited = new Set();
const records = [];
function visit(file) {
  const key = file.toLowerCase();
  if (visited.has(key)) return;
  visited.add(key);
  const imports = parsePe(file);
  for (const name of imports) {
    const local = path.join(rootDirectory, name);
    const system = path.join(system32, name);
    const virtual = /^(api-ms-win-|ext-ms-win-)/.test(name);
    const resolved = fs.existsSync(local) ? local : fs.existsSync(system) ? system : '';
    records.push({ parent: path.basename(file), dependency: name, resolution: resolved ? (resolved === local ? 'application' : 'system32') : virtual ? 'api-set' : 'missing' });
    if (resolved === local) visit(local);
  }
}
visit(target);
const missing = records.filter((item) => item.resolution === 'missing');
console.log(JSON.stringify({ target: path.basename(target), filesInspected: visited.size, dependencies: records, missing }, null, 2));
if (missing.length) process.exitCode = 2;
