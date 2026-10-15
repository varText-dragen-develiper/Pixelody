const { ipcRenderer } = require('electron');

async function invoke(channel, ...args) {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch (error) {
    return { ok: false, code: 'invoke_rejected', message: String(error?.message || error).slice(0, 160) };
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  const violations = [];
  document.addEventListener('securitypolicyviolation', (event) => {
    violations.push({ directive: event.effectiveDirective, blocked: String(event.blockedURI || '').slice(0, 120) });
  });

  const results = {
    runtime: await invoke('app:runtime-info'),
    miniOpen: await invoke('mini:open'),
    chooseFiles: await invoke('music:choose-files'),
    stateCommit: await invoke('state:commit', {}, { reason: 'hostile-test' }),
    sharingStart: await invoke('sharing:start', {}, { mode: 'localhost' }),
    external: await invoke('app:open-external', 'https://musicbrainz.org/'),
    testConfig: await invoke('test:config'),
    rendererSecurity: {
      sandboxed: process.sandboxed === true,
      contextIsolated: process.contextIsolated === true,
      mainFrame: process.isMainFrame !== false,
    },
  };

  ipcRenderer.send('mini:command', 'toggle');
  ipcRenderer.send('player:state', { title: 'Hostile state', paused: false });
  ipcRenderer.send('mini:close');

  let popupReturnedNull = false;
  try { popupReturnedNull = window.open('https://example.com/', '_blank') === null; } catch { popupReturnedNull = true; }
  try {
    const frame = document.createElement('iframe');
    frame.src = 'https://example.com/';
    document.body.appendChild(frame);
  } catch {}
  try { window.location.href = 'https://example.com/'; } catch {}

  setTimeout(() => {
    ipcRenderer.send('test:hostile-result', {
      ...results,
      popupReturnedNull,
      cspViolations: violations.slice(0, 16),
    });
  }, 350);
});
