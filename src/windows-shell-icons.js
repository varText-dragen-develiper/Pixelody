'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn: defaultSpawn } = require('node:child_process');

const MAX_SHORTCUTS = 64;
const MAX_OUTPUT = 65536;
const DEFAULT_TIMEOUT_MS = 10000;

function allowedShortcutRoots(app) {
  return [
    app.getPath('desktop'),
    path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(app.getPath('appData'), 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned'),
  ].map(root => {
    if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('Shell shortcut root must be absolute.');
    return path.resolve(root);
  });
}

function validateShortcuts(shortcuts, roots) {
  if (!Array.isArray(shortcuts) || shortcuts.length > MAX_SHORTCUTS) throw new Error('Invalid Shell shortcut list.');
  const unique = new Map();
  for (const shortcut of shortcuts) {
    if (typeof shortcut !== 'string' || shortcut.length > 259 || shortcut.includes('\0') || !path.isAbsolute(shortcut)) throw new Error('Invalid Shell shortcut path.');
    const resolved = path.resolve(shortcut);
    if (path.extname(resolved).toLowerCase() !== '.lnk') throw new Error('Shell shortcut path must end in .lnk.');
    const inside = roots.some(root => {
      const relative = path.relative(root, resolved);
      return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    });
    if (!inside) throw new Error('Shell shortcut is outside allowed locations.');
    unique.set(resolved.toLowerCase(), resolved);
  }
  return [...unique.values()];
}

function transportError(message) {
  const error = new Error(message);
  error.retryable = true;
  return error;
}

function createWindowsShellIconRefresher({
  spawn = defaultSpawn,
  platform = process.platform,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  systemRoot = process.env.SystemRoot || 'C:\\Windows',
  workerSourcePath = path.join(__dirname, 'windows-shell-icons.ps1'),
} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new Error('Invalid Shell icon worker timeout.');
  const workers = new Map();
  let closed = false;

  function failWorker(worker, error) {
    if (worker.dead) return;
    worker.dead = true;
    if (workers.get(worker.key) === worker) workers.delete(worker.key);
    for (const request of worker.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    worker.pending.clear();
    try { worker.child.stdin.end(); } catch {}
    try { worker.child.kill(); } catch {}
  }

  function getWorker(app, roots) {
    const profile = app.getPath('userData');
    if (typeof profile !== 'string' || !path.isAbsolute(profile)) throw new Error('Shell icon profile path must be absolute.');
    const key = path.resolve(profile).toLowerCase();
    const signature = roots.map(root => root.toLowerCase()).join('\0');
    const existing = workers.get(key);
    if (existing && !existing.dead && existing.signature === signature) return existing;
    if (existing) failWorker(existing, transportError('Shell shortcut locations changed.'));

    // Windows cannot execute a script inside an ASAR. Materialize only this
    // bundled helper, using a content hash to replace stale application copies.
    const source = fs.readFileSync(workerSourcePath);
    const digest = crypto.createHash('sha256').update(source).digest('hex').slice(0, 20);
    const directory = path.join(profile, 'brand-icons');
    fs.mkdirSync(directory, { recursive: true });
    const script = path.join(directory, `windows-shell-icons-${digest}.ps1`);
    if (!fs.existsSync(script) || !fs.readFileSync(script).equals(source)) fs.writeFileSync(script, source);
    const executable = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
      '-DesktopRoot', roots[0], '-StartMenuRoot', roots[1], '-PinnedRoot', roots[2]];
    let child;
    try { child = spawn(executable, args, { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (error) { throw transportError(`Cannot launch Shell icon worker: ${error.message}`); }
    const worker = { child, key, signature, dead: false, pending: new Map(), nextId: 0, output: '', stderr: '' };
    workers.set(key, worker);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (worker.dead) return;
      worker.output += chunk;
      if (worker.output.length > MAX_OUTPUT) return failWorker(worker, transportError('Shell icon worker output exceeded its limit.'));
      let newline;
      while ((newline = worker.output.indexOf('\n')) !== -1) {
        const line = worker.output.slice(0, newline).trim();
        worker.output = worker.output.slice(newline + 1);
        if (!line) continue;
        let response;
        try { response = JSON.parse(line); }
        catch { return failWorker(worker, transportError('Shell icon worker returned invalid JSON.')); }
        if (response?.id === null && response.ok === false && typeof response.error === 'string') return failWorker(worker, transportError(`Shell icon worker failed: ${response.error}`));
        const request = response && Number.isInteger(response.id) ? worker.pending.get(response.id) : undefined;
        if (!request || typeof response.ok !== 'boolean') return failWorker(worker, transportError('Shell icon worker returned an invalid response.'));
        if (response.ok && response.refreshedShortcuts !== request.shortcutCount) return failWorker(worker, transportError('Shell icon worker acknowledged the wrong shortcut count.'));
        worker.pending.delete(response.id);
        clearTimeout(request.timer);
        if (response.ok) request.resolve(response);
        else request.reject(new Error(typeof response.error === 'string' ? response.error : 'Windows Shell icon refresh failed.'));
      }
    });
    child.stderr.on('data', chunk => { worker.stderr = (worker.stderr + chunk).slice(-8192); });
    child.once('error', error => failWorker(worker, transportError(`Cannot launch Shell icon worker: ${error.message}`)));
    child.once('exit', (code, signal) => failWorker(worker, transportError(`Shell icon worker exited (${code ?? signal ?? 'unknown'}).${worker.stderr ? ` ${worker.stderr.trim()}` : ''}`)));
    child.stdin.on('error', error => failWorker(worker, transportError(`Cannot write to Shell icon worker: ${error.message}`)));
    return worker;
  }

  function send(worker, shortcuts, animationFrame, notifyAssociations) {
    return new Promise((resolve, reject) => {
      if (worker.dead) return reject(transportError('Shell icon worker is unavailable.'));
      const id = ++worker.nextId;
      if (id > 2147483647) {
        failWorker(worker, transportError('Shell icon worker request limit reached.'));
        return reject(transportError('Shell icon worker request limit reached.'));
      }
      const timer = setTimeout(() => failWorker(worker, transportError('Windows Shell icon refresh timed out.')), timeoutMs);
      worker.pending.set(id, { resolve, reject, timer, shortcutCount: shortcuts.length });
      try { worker.child.stdin.write(`${JSON.stringify({ id, shortcuts, animationFrame, notifyAssociations })}\n`, 'utf8'); }
      catch (error) { failWorker(worker, transportError(`Cannot write to Shell icon worker: ${error.message}`)); }
    });
  }

  async function refresh({ app, shortcuts = [], animationFrame = false, notifyAssociations = true }) {
    if (closed) throw new Error('Shell icon refresher is shut down.');
    if (typeof animationFrame !== 'boolean') throw new Error('Invalid animation notification mode.');
    if (typeof notifyAssociations !== 'boolean') throw new Error('Invalid association notification mode.');
    if (platform !== 'win32') return { ok: true, skipped: true, refreshedShortcuts: 0 };
    const roots = allowedShortcutRoots(app);
    const validated = validateShortcuts(shortcuts, roots);
    for (let attempt = 0; attempt < 2; attempt++) {
      try { return await send(getWorker(app, roots), validated, animationFrame, notifyAssociations); }
      catch (error) { if (closed || !error.retryable || attempt === 1) throw error; }
    }
  }

  function shutdown() {
    closed = true;
    for (const worker of [...workers.values()]) failWorker(worker, new Error('Shell icon refresher is shut down.'));
  }

  return { refresh, shutdown };
}

const defaultRefresher = createWindowsShellIconRefresher();
module.exports = {
  createWindowsShellIconRefresher,
  refreshWindowsShellIcons: options => defaultRefresher.refresh(options),
  shutdownWindowsShellIcons: () => defaultRefresher.shutdown(),
};
