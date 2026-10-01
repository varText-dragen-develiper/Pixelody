'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { MAX_PACKAGE_BYTES, ThemePackageError, descriptorFor, parseThemePackageBytes } = require('./contract');

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function assertOwnedChild(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ThemePackageError('unsafe_target', 'The requested theme-package target is outside Pixelody theme storage.');
  }
}

class ThemePackageStore {
  constructor(options = {}) {
    if (!options.directory || !path.isAbsolute(options.directory)) throw new Error('ThemePackageStore requires an absolute directory.');
    this.directory = path.resolve(options.directory);
    this.appVersion = options.appVersion || '';
    this.fs = options.fs || fs;
  }

  async ensureDirectory() {
    await this.fs.mkdir(this.directory, { recursive: true });
  }

  async readAndValidate(filePath) {
    const stats = await this.fs.lstat(filePath);
    if (!stats.isFile() || stats.isSymbolicLink()) throw new ThemePackageError('invalid_file', 'Theme packages must be regular local files.');
    if (!stats.size || stats.size > MAX_PACKAGE_BYTES) throw new ThemePackageError('package_size', `Theme packages must be no larger than ${MAX_PACKAGE_BYTES} bytes in this milestone.`);
    const bytes = await this.fs.readFile(filePath);
    const normalizedPackage = parseThemePackageBytes(bytes, { appVersion: this.appVersion });
    return { bytes, normalizedPackage, hash: digest(bytes) };
  }

  packageDirectory(id, version, hash) {
    if (!ID.test(id) || !VERSION.test(version) || !HASH.test(hash)) throw new ThemePackageError('invalid_identity', 'The theme-package identity is invalid.');
    const target = path.join(this.directory, id, version, hash);
    assertOwnedChild(this.directory, target);
    return target;
  }

  async installFromPath(filePath) {
    const { bytes, normalizedPackage, hash } = await this.readAndValidate(filePath);
    await this.ensureDirectory();
    const id = normalizedPackage.theme.id;
    const version = normalizedPackage.version;
    const target = this.packageDirectory(id, version, hash);
    const parent = path.dirname(target);
    const temporary = path.join(parent, `.${hash}.pending-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
    assertOwnedChild(this.directory, temporary);
    await this.fs.mkdir(parent, { recursive: true });
    try {
      await this.fs.access(path.join(target, 'package.pixelody-theme'));
      const installedAt = (await this.fs.stat(path.join(target, 'package.pixelody-theme'))).birthtime.toISOString();
      return { ok: true, installed: false, duplicate: true, package: descriptorFor(normalizedPackage, hash, installedAt) };
    } catch {
      // Missing targets continue through the atomic installation path.
    }
    try {
      await this.fs.mkdir(temporary, { recursive: false });
      await this.fs.writeFile(path.join(temporary, 'package.pixelody-theme'), bytes, { flag: 'wx' });
      const receipt = {
        schemaVersion: 1,
        id,
        version,
        hash,
        installedAt: new Date().toISOString(),
        trust: { origin: 'local', reviewed: false, executable: false },
      };
      await this.fs.writeFile(path.join(temporary, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
      try {
        await this.fs.rename(temporary, target);
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
        await this.fs.rm(temporary, { recursive: true, force: true });
      }
      return { ok: true, installed: true, duplicate: false, package: descriptorFor(normalizedPackage, hash, receipt.installedAt) };
    } catch (error) {
      await this.fs.rm(temporary, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  async list() {
    await this.ensureDirectory();
    const packages = [];
    const issues = [];
    const ids = await this.fs.readdir(this.directory, { withFileTypes: true });
    for (const idEntry of ids) {
      if (!idEntry.isDirectory() || !ID.test(idEntry.name)) continue;
      const idDirectory = path.join(this.directory, idEntry.name);
      const versions = await this.fs.readdir(idDirectory, { withFileTypes: true });
      for (const versionEntry of versions) {
        if (!versionEntry.isDirectory() || !VERSION.test(versionEntry.name)) continue;
        const versionDirectory = path.join(idDirectory, versionEntry.name);
        const hashes = await this.fs.readdir(versionDirectory, { withFileTypes: true });
        for (const hashEntry of hashes) {
          if (!hashEntry.isDirectory() || !HASH.test(hashEntry.name)) continue;
          const packageFile = path.join(versionDirectory, hashEntry.name, 'package.pixelody-theme');
          try {
            const { normalizedPackage, hash } = await this.readAndValidate(packageFile);
            if (hash !== hashEntry.name || normalizedPackage.theme.id !== idEntry.name || normalizedPackage.version !== versionEntry.name) {
              throw new ThemePackageError('identity_mismatch', 'Installed package identity does not match its immutable storage location.');
            }
            const stats = await this.fs.stat(packageFile);
            packages.push(descriptorFor(normalizedPackage, hash, stats.birthtime.toISOString()));
          } catch (error) {
            issues.push({ code: error.code || 'invalid_installed_package', id: idEntry.name, version: versionEntry.name, hash: hashEntry.name });
          }
        }
      }
    }
    packages.sort((left, right) => left.name.localeCompare(right.name) || right.version.localeCompare(left.version));
    return { ok: true, packages, issues };
  }

  async delete(identity) {
    const target = this.packageDirectory(identity?.id || '', identity?.version || '', identity?.hash || '');
    assertOwnedChild(this.directory, target);
    let existed = true;
    try {
      const stats = await this.fs.lstat(target);
      if (!stats.isDirectory() || stats.isSymbolicLink()) throw new ThemePackageError('unsafe_target', 'The installed theme target is not an owned package directory.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      existed = false;
    }
    if (existed) await this.fs.rm(target, { recursive: true, force: false });
    await this.fs.rmdir(path.dirname(target)).catch(() => {});
    await this.fs.rmdir(path.dirname(path.dirname(target))).catch(() => {});
    return { ok: true, removed: existed };
  }
}

module.exports = Object.freeze({ ThemePackageStore, assertOwnedChild, digest });
