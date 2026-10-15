'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { parsePackage } = require('./contract');
class ModuleStore {
  constructor(directory) { this.directory = directory; this.file = path.join(directory, 'listening-notes.json'); }
  read() {
    if (!fs.existsSync(this.file)) return { installed: null, text: '' };
    if (fs.statSync(this.file).size > 150000) throw new Error('Notebook storage is too large. Existing data was preserved.');
    const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (typeof data.text !== 'string' || data.text.length > 20000) throw new Error('Notebook storage is invalid. Existing data was preserved.');
    if (data.installed !== null && parsePackage(Buffer.from(JSON.stringify(data.installed)), 'desktop').kind !== 'listening-notes') throw new Error('Invalid notebook module. Existing data was preserved.');
    return data;
  }
  write(value) {
    fs.mkdirSync(this.directory, { recursive: true });
    const temp = this.file + '.tmp';
    const fd = fs.openSync(temp, 'w', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, this.file);
    return value;
  }
  install(bytes) { const pkg = parsePackage(bytes, 'desktop'); if (pkg.kind !== 'listening-notes') throw new Error('Use the web module registry.'); const state = this.read(); return this.write({ ...state, installed: pkg }); }
  remove() { return this.write({ ...this.read(), installed: null }); }
  save(text) { if (typeof text !== 'string' || text.length > 20000) throw new Error('Note is too long.'); const state = this.read(); if (!state.installed) throw new Error('Install Listening Notes first.'); return this.write({ ...state, text }); }
}
class WebModuleStore {
  constructor(directory) { this.file = path.join(directory, 'web-shop.json'); this.directory = directory; }
  read() {
    if (!fs.existsSync(this.file)) return null;
    if (fs.statSync(this.file).size > 8192) throw new Error('Web module storage is too large. Existing data was preserved.');
    const bytes = fs.readFileSync(this.file);
    const pkg = parsePackage(bytes, 'desktop');
    if (pkg.kind !== 'web-shop') throw new Error('Invalid web module storage.');
    return pkg;
  }
  install(bytes) {
    const pkg = parsePackage(bytes, 'desktop');
    if (pkg.kind !== 'web-shop') throw new Error('Not a web module.');
    this.read(); // Preserve corrupt existing state rather than overwrite silently.
    fs.mkdirSync(this.directory, { recursive: true });
    const fd = fs.openSync(this.file + '.tmp', 'w', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(pkg)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(this.file + '.tmp', this.file);
    return pkg;
  }
  remove() { if (fs.existsSync(this.file)) fs.unlinkSync(this.file); }
}
class EditionStore {
  constructor(directory) { this.directory = directory; this.file = path.join(directory, 'theme-editions.json'); }
  read() {
    if (!fs.existsSync(this.file)) return [];
    if (fs.statSync(this.file).size > 16384) throw new Error('Theme edition storage is too large. Existing data was preserved.');
    const value = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (!Array.isArray(value) || value.length > 2) throw new Error('Invalid theme edition storage.');
    const parsed = value.map(pkg => parsePackage(Buffer.from(JSON.stringify(pkg)), 'desktop'));
    if (parsed.some(pkg => pkg.kind !== 'theme-edition') || new Set(parsed.map(pkg => pkg.recipe)).size !== parsed.length) throw new Error('Invalid theme edition registry.');
    return parsed;
  }
  write(value) {
    fs.mkdirSync(this.directory, { recursive: true });
    const fd = fs.openSync(this.file + '.tmp', 'w', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(this.file + '.tmp', this.file);
    return value;
  }
  install(bytes) {
    const pkg = parsePackage(bytes, 'desktop');
    if (pkg.kind !== 'theme-edition') throw new Error('Not a theme edition.');
    return this.write([...this.read().filter(item => item.recipe !== pkg.recipe), pkg]);
  }
  remove(recipe) { return this.write(this.read().filter(item => item.recipe !== recipe)); }
}
module.exports = { ModuleStore, WebModuleStore, EditionStore };
