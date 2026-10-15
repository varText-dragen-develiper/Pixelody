'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn: defaultSpawn } = require('node:child_process');

// This private bridge accepts BrowserWindows, never renderer-provided handles.
// No shortcut is changed during native animation. Final publication keeps using
// the established shortcut/identity path and commits the temporary lease.
function createWindowsLiveIconController({ app, appId, platform = process.platform, spawn = defaultSpawn, timeoutMs = 8000, systemRoot = process.env.SystemRoot || 'C:\\Windows' }) {
  if (typeof appId !== 'string' || !/^[a-z0-9._-]{1,100}$/i.test(appId)) throw new Error('Invalid live icon identity.');
  let child = null, output = '', nextId = 0, stopped = false;
  const pending = new Map();
  function rejectPending(error) {
    for (const job of pending.values()) { clearTimeout(job.timer); job.reject(error); }
    pending.clear();
  }
  function fail(error) {
    rejectPending(error);
    // Do not restart a worker holding original window properties. EOF gives it
    // a chance to roll back before it exits; normal app shutdown closes windows.
    stopped = true;
    try { child?.stdin.end(); } catch {}
  }
  function start() {
    if (stopped) throw new Error('Live icon controller is stopped.');
    if (child) return;
    const source = fs.readFileSync(path.join(__dirname, 'windows-live-icon.ps1'));
    const hash = crypto.createHash('sha256').update(source).digest('hex').slice(0, 20);
    const directory = path.join(app.getPath('userData'), 'brand-icons');
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, `windows-live-icon-${hash}.ps1`);
    if (!fs.existsSync(file) || !fs.readFileSync(file).equals(source)) fs.writeFileSync(file, source);
    child = spawn(path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file, '-TaskProcessId', String(process.pid), '-AppId', appId], { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    let stderr = '';
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-2048); });
    child.stdout.on('data', data => {
      output += data;
      if (output.length > 65536) return fail(new Error('Live icon response exceeded its limit.'));
      let newline;
      while ((newline = output.indexOf('\n')) >= 0) {
        const line = output.slice(0, newline).trim(); output = output.slice(newline + 1);
        if (!line) continue;
        let result;
        try { result = JSON.parse(line); } catch { return fail(new Error('Invalid live icon response.')); }
        if (result.id === null && result.ok === false) return fail(new Error(`Live icon worker failed: ${String(result.error).slice(0, 500)}`));
        const job = pending.get(result.id);
        if (!job || typeof result.ok !== 'boolean') return fail(new Error('Unexpected live icon response.'));
        pending.delete(result.id); clearTimeout(job.timer);
        if (result.ok) job.resolve(result);
        else job.reject(new Error(typeof result.error === 'string' ? result.error : 'Native icon operation failed.'));
      }
    });
    child.once('error', error => fail(error));
    child.once('exit', () => fail(new Error(`Live icon worker exited.${stderr ? ` ${stderr.trim()}` : ''}`)));
    child.stdin.on('error', error => fail(error));
  }
  async function send(action, windows = []) {
    if (!['prepare', 'begin', 'commit', 'rollback'].includes(action) || !Array.isArray(windows) || windows.length > 2) throw new Error('Invalid live icon operation.');
    if (platform !== 'win32') return { ok: true, skipped: true };
    const handles = windows.filter(win => win && !win.isDestroyed()).map(win => {
      const bytes = win.getNativeWindowHandle();
      if (!Buffer.isBuffer(bytes) || ![4, 8].includes(bytes.length)) throw new Error('Invalid native window handle.');
      const value = bytes.length === 8 ? bytes.readBigUInt64LE() : BigInt(bytes.readUInt32LE());
      if (!value) throw new Error('Invalid native window handle.');
      return value.toString(16);
    });
    start();
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => fail(new Error('Live icon operation timed out.')), timeoutMs);
      pending.set(id, { resolve, reject, timer });
      try { child.stdin.write(`${JSON.stringify({ id, action, handles })}\n`); } catch (error) { fail(error); }
    });
  }
  return {
    prepare: () => send('prepare'),
    begin: windows => send('begin', windows),
    commit: () => send('commit'),
    rollback: () => send('rollback'),
    shutdown() { stopped = true; rejectPending(new Error('Live icon controller shut down.')); try { child?.stdin.end(); } catch {} },
  };
}

module.exports = { createWindowsLiveIconController };
