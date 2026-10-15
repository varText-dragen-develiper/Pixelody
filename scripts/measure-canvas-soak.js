// Opt-in Canvas soak and scaling probe (not part of npm run check). Launches an isolated
// generated profile, cycles every Canvas theme port, and reports console errors, leaks,
// switch time and the style cost of a full invalidation. Flags: --tracks=N --cycles=N
// --split (style vs layout per heavy port) --mech (window/keyboard probe on the five
// windowed mechanics) --studio (no Canvas) --queue/--bigqueue/--bigprofile (queue cost).
// Uses loopback CDP only; no owner data, telemetry or audible output.
// usage: node canvas-soak.js [--tracks=500] [--cycles=2]
const path = require('path'), fs = require('fs/promises'), { spawn } = require('child_process');
const repo = require('path').resolve(__dirname, '..');
const arg = (n, d) => process.argv.find((v) => v.startsWith(`--${n}=`))?.slice(n.length + 3) || d;
const count = Number(arg('tracks', '500')), cycles = Number(arg('cycles', '2'));
const { createOwnedProfile } = require('./check-windows-integration');
const { PixelodyStateStore } = require(repo + '/src/state-store');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
async function connect(url) {
  const ws = new WebSocket(url); const pend = new Map(); let id = 0;
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.method === 'Runtime.exceptionThrown') problems.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push('ERR ' + m.params.args.map((a) => a.value || a.description).join(' ').slice(0, 300));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') problems.push('LOG ' + m.params.entry.text.slice(0, 200) + ' ' + (m.params.entry.url || '').split('/').pop());
    const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
  };
  await new Promise((r) => ws.onopen = r);
  const call = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  return { call, ev: async (e) => { const r = await call('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true, userGesture: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value; }, close: () => ws.close() };
}
const metrics = async (cdp) => { const m = (await cdp.call('Performance.getMetrics')).metrics; const g = (n) => m.find((x) => x.name === n)?.value; return { nodes: g('Nodes'), listeners: g('JSEventListeners'), heapMB: +(g('JSHeapUsedSize') / 1048576).toFixed(1), docs: g('Documents') }; };
(async () => {
  const owned = await createOwnedProfile('canvas-soak');
  const store = new PixelodyStateStore({ directory: path.join(owned.profile, 'state'), backupIntervalMs: 0 });
  const values = store.loadSync().state.values;
  const base = values['aurelia.library'][0];
  values['aurelia.library'] = Array.from({ length: count }, (_, i) => ({ ...base, id: 'perf-' + i, title: 'Synthetic ' + i, artist: 'Artist ' + i % 40, album: 'Album ' + i % 100, dateAdded: count - i }));
  values['aurelia.playlists'][0].trackIds = values['aurelia.library'].map((t) => t.id);
  values['pixelody.session'] = { id: 'perf-0', time: 0, volume: 0 }; values['pixelody.volume'] = 0;
  if (!store.commitSync(values, { reason: 'fixture' }).ok) throw new Error('seed');
  const env = { ...process.env, PIXELODY_DEVELOPMENT_WINDOW_WIDTH: '1440', PIXELODY_DEVELOPMENT_WINDOW_HEIGHT: '920', PIXELODY_DEVELOPMENT_MAXIMIZED: '0' };
  for (const k of ['ELECTRON_RUN_AS_NODE', 'PIXELODY_TEST_MODE', 'PIXELODY_TEST_LAUNCH', 'PIXELODY_THEME_TEST_USER_DATA', 'PIXELODY_CANVAS_PROFILE']) delete env[k];
  const child = spawn(require(repo + '/node_modules/electron'), ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--mute-audio', repo, ...(process.argv.includes('--studio') ? [] : ['--pixelody-canvas']), `--pixelody-dev-user-data=${owned.profile}`], { cwd: repo, env, windowsHide: true, stdio: 'ignore' });
  let port; for (let i = 0; i < 100 && !port; i++) { try { port = (await fs.readFile(path.join(owned.profile, 'DevToolsActivePort'), 'utf8')).trim().split('\n')[0]; } catch { await sleep(200); } }
  let page; for (let i = 0; i < 100 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((p) => p.type === 'page' && p.url.includes('index.html')); } catch {} if (!page) await sleep(200); }
  const cdp = await connect(page.webSocketDebuggerUrl);
  for (const d of ['Runtime', 'Page', 'Log', 'Performance']) await cdp.call(d + '.enable');
  await cdp.call('Page.bringToFront');
  await cdp.call('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__lt=[];new PerformanceObserver(l=>{for(const e of l.getEntries())window.__lt.push([Math.round(e.startTime),Math.round(e.duration)])}).observe({type:"longtask",buffered:true});' });
  await cdp.call('Page.reload');
  for (let i = 0; i < 200; i++) { await sleep(150); try { if (await cdp.ev("Boolean(document.body?.dataset.startupReveal==='normal'&&!document.body.classList.contains('theme-loading'))")) break; } catch {} }
  await sleep(1500);
  const info = await cdp.ev("({theme:document.body.dataset.theme,canvas:typeof canvasStageActive==='function'?canvasStageActive():null,selects:[...document.querySelectorAll('select')].filter(s=>[...s.options].some(o=>o.textContent==='Canvas Base')).length,ports:typeof canvasThemePortDomain!=='undefined'?canvasThemePortDomain.PORTS.length:0})");
  console.log('start', JSON.stringify(info), JSON.stringify(await metrics(cdp)));
  if (!info.canvas) console.log('canvas not active; problems:', problems.slice(0, 5));
  const keys = process.argv.includes('--studio') ? [] : await cdp.ev('canvasThemePortDomain.PORTS.map(p=>p.key)');
  if (process.argv.includes('--queue')) {
    const inval = () => cdp.ev("(async()=>{const l=[];for(let k=0;k<5;k++){document.documentElement.style.setProperty('--soak',String(Math.random()));const t=performance.now();void document.body.offsetWidth;l.push(performance.now()-t);await new Promise(r=>requestAnimationFrame(r))}l.sort((a,b)=>a-b);return {nodes:document.getElementsByTagName('*').length,styleMs:Math.round(l[2])}})()");
    if (process.argv.includes('--bigqueue')) { console.log('bigqueue', JSON.stringify(await cdp.ev("(()=>{const t0=performance.now();buildQueue(visibleTracks(),'perf-5');const build=performance.now()-t0;const t1=performance.now();renderQueue();const again=performance.now()-t1;const t2=performance.now();document.documentElement.style.setProperty('--soak','x'+Math.random());void document.body.offsetWidth;const inval=performance.now()-t2;return {queue:state.queue.length,buildQueueMs:Math.round(build),renderQueueAgainMs:Math.round(again),nodes:document.getElementsByTagName('*').length,invalMs:Math.round(inval)}})()"))); }
    if (process.argv.includes('--bigprofile')) { await cdp.call('Profiler.enable'); await cdp.call('Profiler.setSamplingInterval',{interval:200}); await cdp.call('Profiler.start'); await cdp.ev("(()=>{for(let i=0;i<3;i++)renderQueue()})()"); const {profile}=await cdp.call('Profiler.stop'); const byId=new Map(profile.nodes.map(n=>[n.id,n])); const self=new Map(); profile.samples.forEach((id,i)=>{const n=byId.get(id);const k=(n.callFrame.functionName||'(anon)')+' '+(n.callFrame.url||'').split('/').pop()+':'+(n.callFrame.lineNumber+1);self.set(k,(self.get(k)||0)+(profile.timeDeltas[i]||0)/1000)}); console.log('bigprofile', [...self].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,v])=>k+'='+Math.round(v)).join(' | ')); }
    if (process.argv.includes('--playprofile')) {
      await cdp.call('Profiler.enable'); await cdp.call('Profiler.setSamplingInterval', { interval: 100 });
      await cdp.ev("buildQueue(visibleTracks(),'perf-1')");
      await cdp.call('Profiler.start');
      const frame = await cdp.ev("(async()=>{const t0=performance.now();const p=playTrack('perf-7');const sync=performance.now()-t0;await p;const done=performance.now()-t0;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return {syncMs:Math.round(sync),resolvedMs:Math.round(done),toNextFramesMs:Math.round(performance.now()-t0)}})()");
      const { profile } = await cdp.call('Profiler.stop');
      const byId = new Map(profile.nodes.map((n) => [n.id, n])); const self = new Map();
      profile.samples.forEach((id, i) => { const n = byId.get(id); const k = (n.callFrame.functionName || '(anon)') + ' ' + (n.callFrame.url || '').split('/').pop() + ':' + (n.callFrame.lineNumber + 1); self.set(k, (self.get(k) || 0) + (profile.timeDeltas[i] || 0) / 1000); });
      console.log('playprofile', JSON.stringify(frame), [...self].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => k + '=' + Math.round(v)).join(' | '));
    }
    console.log('queue before play', JSON.stringify(await inval()));
    await cdp.ev("document.querySelector('#trackRows .track-row').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))"); await sleep(1500);
    console.log('queue after play ', JSON.stringify(await inval()), JSON.stringify(await cdp.ev("({queue:typeof state!=='undefined'?state.queue?.length:null,drawerRows:document.querySelectorAll('#queueList > *, .queue-item, [data-queue-id]').length})")));
  }
  const rows = [];
  const switchExpr = (key) => `(async()=>{const sel=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.textContent==='Canvas Base'));if(!sel)return {err:'no select'};
     sel.disabled=false;sel.value=${JSON.stringify(key)};sel.dispatchEvent(new Event('change',{bubbles:true}));
     for(let i=0;i<80&&sel.disabled;i++)await new Promise(r=>setTimeout(r,50));
     await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
     const de=document.documentElement;
     const lay=[];for(let k=0;k<5;k++){document.documentElement.style.setProperty('--soak',String(Math.random()));const t=performance.now();void document.body.offsetWidth;lay.push(performance.now()-t);await new Promise(r=>requestAnimationFrame(r));}lay.sort((a,b)=>a-b);
     return {layoutMs:Math.round(lay[2]),stuck:sel.disabled,port:document.body.dataset.canvasThemePort||'',overflowX:de.scrollWidth>innerWidth+1,rows:document.querySelectorAll('#trackRows .track-row').length}})()`;
  for (let c = 0; c < cycles; c++) {
    for (const key of ['', ...keys]) {
      const t0 = Date.now();
      const r = await cdp.ev(switchExpr(key));
      const m = await metrics(cdp);
      rows.push({ c, key, ms: Date.now() - t0, ...r, ...m });
      if (r.err || r.stuck || r.port !== key || r.overflowX || !r.rows) console.log('  ISSUE', JSON.stringify({ c, key, ...r }));
    }
  }
  if (process.argv.includes('--split')) {
    const get = async () => Object.fromEntries((await cdp.call('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
    for (const key of ['', 'violet-violent', 'abyssal-press', 'ghost-index', 'cartridge-quest']) {
      await cdp.ev(switchExpr(key));
      const a = await get();
      for (let k = 0; k < 5; k++) { await cdp.ev("document.documentElement.style.setProperty('--soak',String(Math.random()));void document.body.offsetWidth;new Promise(r=>requestAnimationFrame(r))"); }
      const b = await get();
      const d = (n) => +(((b[n] - a[n]) / 5) * (n.endsWith('Duration') ? 1000 : 1)).toFixed(1);
      const dom = await cdp.ev("({all:document.getElementsByTagName('*').length,visible:[...document.querySelectorAll('body *')].filter(e=>e.offsetParent!==null).length,hiddenSubtrees:document.querySelectorAll('[hidden],.hidden').length})");
      console.log('split', key || 'base', 'styleMs/inval', d('RecalcStyleDuration'), 'layoutMs/inval', d('LayoutDuration'), 'styleCount', d('RecalcStyleCount'), 'layoutCount', d('LayoutCount'), JSON.stringify(dom));
    }
  }
  if (process.argv.includes('--mech')) {
    const cases = [['violet-violent', '.memory-cascade-card'], ['abyssal-press', '.pressure-stack-card'], ['ghost-index', '.spectral-field-card'], ['cartridge-quest', '.carousel-card'], ['crystal', '.cover-flow-card']];
    for (const [key, sel] of cases) {
      await cdp.ev(switchExpr(key));
      const probe = (label) => cdp.ev("(()=>{const cards=[...document.querySelectorAll('" + sel + "')];const idx=cards.map(c=>Number(c.dataset.index));const centered=document.querySelector('" + sel + ".is-centered, " + sel + "[aria-selected=\"true\"]');return {label:" + JSON.stringify('') + ",count:cards.length,min:Math.min(...idx),max:Math.max(...idx),centered:centered?Number(centered.dataset.index):null,nodes:document.getElementsByTagName('*').length}})()");
      const a = await probe();
      // activate a card two to the right of the current one, then jump to the end and the start
      const steps = [];
      for (const target of ['next', 'far', 'end', 'home']) {
        await cdp.ev("(async()=>{const cards=[...document.querySelectorAll('" + sel + "')];const c=document.querySelector('" + sel + ".is-centered, " + sel + "[aria-selected=\"true\"]')||cards[0];const ci=Number(c.dataset.index);const total=Number(document.querySelectorAll('#trackRows')[0]?.dataset.total||0)||" + count + ";let t;" +
          "if('" + target + "'==='next')t=cards.find(x=>Number(x.dataset.index)===ci+2);else if('" + target + "'==='far'){t=cards.find(x=>Number(x.dataset.index)===ci+10)}" +
          "else{c.focus();c.dispatchEvent(new KeyboardEvent('keydown',{key:'" + target + "'==='end'?'End':'Home',bubbles:true}));await new Promise(r=>setTimeout(r,400));return}" +
          "if(t){t.dispatchEvent(new MouseEvent('click',{bubbles:true}))}await new Promise(r=>setTimeout(r,400))})()");
        steps.push([target, await probe()]);
      }
      console.log('mech', key, 'initial', JSON.stringify(a), '|', steps.map(([n, r]) => n + ':' + JSON.stringify({ n: r.count, lo: r.min, hi: r.max, c: r.centered })).join(' '));
    }
  }
  if (process.argv.includes('--hist')) { await cdp.ev(switchExpr('abyssal-press')); console.log('hist', JSON.stringify(await cdp.ev("(()=>{const m={};for(const e of document.getElementsByTagName('*')){const k=e.tagName+'.'+(typeof e.className==='string'?e.className.split(' ')[0]:'');m[k]=(m[k]||0)+1}return Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,8)})()"))); }
  if (process.argv.includes('--loadprobe')) {
    await cdp.ev("window.__loads=[];new MutationObserver(()=>{const e=document.querySelector('#themeLoadScreen');if(e&&e.classList.contains('active')){const k=e.dataset.loadTheme+'|'+e.dataset.loadSpeed;const l=window.__loads;if(!l.length||l[l.length-1].k!==k||performance.now()-l[l.length-1].t>300)l.push({k,t:performance.now(),mark:e.style.getPropertyValue('--brand-mark')})}}).observe(document.querySelector('#themeLoadScreen'),{attributes:true,attributeFilter:['class','data-load-theme','data-load-speed']});");
    const order = ['crystal', 'monument', 'obsession', 'orbital', 'dev-lab', 'sakura-bloom'];
    for (const key of order) { const t0 = Date.now(); await cdp.ev(switchExpr(key)); console.log('loadprobe', key, Date.now() - t0, 'ms'); }
    console.log('loadprobe shown', JSON.stringify(await cdp.ev('window.__loads.map(l=>l.k+" "+l.mark)')));
    await sleep(5000);
    const t1 = Date.now(); await cdp.ev(switchExpr('crystal')); console.log('loadprobe after pause crystal', Date.now() - t1, 'ms');
    console.log('loadprobe shown total', JSON.stringify(await cdp.ev('window.__loads.map(l=>l.k)')));
  }
  if (process.argv.includes('--stucktest')) {
    const state = () => cdp.ev("({hidden:document.querySelector('#themeLoadScreen').classList.contains('hidden')||!document.querySelector('#themeLoadScreen').classList.contains('active'),bodyLoading:document.body.classList.contains('theme-loading'),switching:document.body.classList.contains('theme-switching'),selectDisabled:[...document.querySelectorAll('select')].find(x=>[...x.options].some(o=>o.textContent==='Canvas Base')).disabled})");
    await cdp.ev("window.__orig=applyAppearance;applyAppearance=()=>{throw new Error('injected failure')}");
    await cdp.ev("(()=>{const sel=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.textContent==='Canvas Base'));sel.disabled=false;sel.value='crystal';sel.dispatchEvent(new Event('change',{bubbles:true}))})()");
    await sleep(2500);
    console.log('stucktest after injected failure', JSON.stringify(await state()));
    await cdp.ev("applyAppearance=window.__orig");
    await cdp.ev("showThemeLoadScreen('crystal', 300)"); await sleep(1000);
    console.log('stucktest cover shown by nothing, at 1s', JSON.stringify(await state()));
    await sleep(8500);
    console.log('stucktest after watchdog window', JSON.stringify(await state()));
  }
  if (process.argv.includes('--tucktest')) {
    const mouse = (type, x, y, extra = {}) => cdp.call('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra });
    const center = async (sel) => cdp.ev("(()=>{const r=document.querySelector('" + sel + "').getBoundingClientRect();return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)]})()");
    const rail = () => cdp.ev("(()=>{const r=document.querySelector('.library-rail').getBoundingClientRect();return {right:Math.round(r.right),left:Math.round(r.left),untucked:document.querySelector('.library-rail').classList.contains('is-untucked'),bodyUntucked:document.body.classList.contains('library-untucked'),collapsed:document.body.classList.contains('library-collapsed'),focusIn:document.querySelector('.library-rail').matches(':focus-within'),active:document.activeElement&&document.activeElement.id||document.activeElement&&document.activeElement.tagName}})()");
    await cdp.ev("document.querySelector('#toggleLibrary').click()"); await sleep(600);
    await mouse('mouseMoved', 900, 400); await sleep(500);
    console.log('tucktest collapsed, pointer away', JSON.stringify(await rail()));
    const [hx, hy] = await center('#toggleLibrary');
    await mouse('mouseMoved', hx, hy); await sleep(500);
    console.log('tucktest hovering handle      ', JSON.stringify(await rail()));
    const [bx, by] = await center('.library-rail [data-library-mode="albums"]');
    await mouse('mouseMoved', bx, by); await sleep(300); await mouse('mousePressed', bx, by); await mouse('mouseReleased', bx, by); await sleep(300);
    console.log('tucktest after clicking albums', JSON.stringify(await rail()));
    await mouse('mouseMoved', 900, 400); await sleep(900);
    console.log('tucktest pointer moved away   ', JSON.stringify(await rail()));
    // Keyboard: focusing a control inside the collapsed panel brings it out and keeps it out.
    await cdp.ev("document.querySelector('.library-rail [data-library-mode=\"albums\"]').blur();document.body.focus()");
    await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }); await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    for (let i = 0; i < 12; i++) { if ((await cdp.ev("document.activeElement.closest('.library-rail')?1:0")) === 1) break; await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }); await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }); await sleep(60); }
    await sleep(500);
    console.log('tucktest keyboard focus inside', JSON.stringify(await rail()));
    await mouse('mouseMoved', 900, 400); await sleep(700);
    console.log('tucktest keyboard, pointer away', JSON.stringify(await rail()));
    await cdp.ev("document.activeElement.blur()"); await sleep(600);
    console.log('tucktest after blur           ', JSON.stringify(await rail()));
  }
  if (process.argv.includes('--startuptest')) {
    await cdp.ev(switchExpr('crystal')); await sleep(800);
    console.log('startuptest saved', await cdp.ev("localStorage.getItem('pixelody.startupLoadColors')"));
    await cdp.call('Page.addScriptToEvaluateOnNewDocument', { source: "window.__first=null;new MutationObserver((_,obs)=>{const e=document.querySelector('#themeLoadScreen');if(!e)return;obs.disconnect();const c=getComputedStyle(e);window.__first={fromAccent:c.getPropertyValue('--theme-load-from-accent').trim(),toAccent:c.getPropertyValue('--theme-load-to-accent').trim(),fromBg:c.getPropertyValue('--theme-load-from-bg').trim(),mark:c.getPropertyValue('--brand-mark').trim(),inlineStyle:e.getAttribute('style')||'',scriptsRun:typeof PixelodyBrandMark}}).observe(document,{childList:true,subtree:true});" });
    await cdp.call('Page.reload'); await sleep(3000);
    console.log('startuptest first-frame vars', JSON.stringify(await cdp.ev('window.__first')));
    await cdp.ev("localStorage.removeItem('pixelody.startupLoadColors')"); await cdp.call('Page.reload'); await sleep(3000);
    console.log('startuptest without saved colours (fallback)', JSON.stringify(await cdp.ev('window.__first')));
  }
  const first = rows.filter((r) => r.c === 0), last = rows.filter((r) => r.c === cycles - 1);
  console.log('switch ms: max', Math.max(...rows.map((r) => r.ms)), 'avg', Math.round(rows.reduce((a, r) => a + r.ms, 0) / rows.length));
  console.log('layout cost per full invalidation (median of 5), worst:', JSON.stringify(rows.filter((r) => r.c === cycles - 1).sort((a, b) => b.layoutMs - a.layoutMs).slice(0, 8).map((r) => [r.key || 'base', r.layoutMs])), 'best', JSON.stringify(rows.filter((r) => r.c === cycles - 1).sort((a, b) => a.layoutMs - b.layoutMs).slice(0, 3).map((r) => [r.key || 'base', r.layoutMs])));
  console.log('slowest', JSON.stringify(rows.slice().sort((a, b) => b.ms - a.ms).slice(0, 4).map((r) => [r.key || 'base', r.ms])));
  if (process.argv.includes('--profile')) {
    await cdp.call('Profiler.enable'); await cdp.call('Profiler.setSamplingInterval', { interval: 200 });
    for (const key of ['dev-lab', 'cartridge-quest', 'monument']) {
      await cdp.ev(switchExpr(key === '' ? 'monument' : 'harmonic-registry')); // neutral baseline state
      await cdp.call('Profiler.start');
      const t0 = Date.now();
      await cdp.ev(switchExpr(key));
      const { profile } = await cdp.call('Profiler.stop');
      const byId = new Map(profile.nodes.map((n) => [n.id, n]));
      const self = new Map();
      profile.samples.forEach((id, i) => { const n = byId.get(id); const k = n.callFrame.functionName + ' ' + (n.callFrame.url || '').split('/').pop() + ':' + n.callFrame.lineNumber; self.set(k, (self.get(k) || 0) + (profile.timeDeltas[i] || 0) / 1000); });
      {
        const parent = new Map(); profile.nodes.forEach((n) => (n.children || []).forEach((c) => parent.set(c, n.id)));
        const times = new Map(); profile.samples.forEach((id, i) => times.set(id, (times.get(id) || 0) + (profile.timeDeltas[i] || 0) / 1000));
        const callers = new Map();
        for (const [id, t] of times) {
          const n = byId.get(id);
          if (!/getBoundingClientRect|clientWidth|clientHeight|offsetWidth|offsetHeight|getComputedStyle|scrollWidth|scrollHeight/.test(n.callFrame.functionName) && n.callFrame.functionName !== '') continue;
          let chain = [], cur = parent.get(id), depth = 0;
          while (cur && depth < 4) { const c = byId.get(cur).callFrame; chain.push((c.functionName || '(anon)') + '@' + (c.url || '').split('/').pop() + ':' + (c.lineNumber + 1)); cur = parent.get(cur); depth++; }
          const k = (n.callFrame.functionName || '(anon-self)') + ' <- ' + chain.join(' < ');
          callers.set(k, (callers.get(k) || 0) + t);
        }
        console.log('  callers', key || 'base', [...callers].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => Math.round(v) + 'ms ' + k).join(' || '));
      }
      console.log('profile', key || 'base', Date.now() - t0, 'ms:', [...self].sort((a, b) => b[1] - a[1]).slice(0, 7).map(([k, v]) => k + '=' + Math.round(v)).join(' | '));
    }
  }
  console.log('growth first cycle end -> last cycle end: nodes', first.at(-1).nodes, '->', last.at(-1).nodes, 'listeners', first.at(-1).listeners, '->', last.at(-1).listeners, 'heapMB', first.at(-1).heapMB, '->', last.at(-1).heapMB, 'docs', last.at(-1).docs);
  console.log('long tasks:', await cdp.ev('window.__lt.filter(x=>x[1]>=120).length+" tasks >=120ms; max "+Math.max(0,...window.__lt.map(x=>x[1]))'));
  console.log('problems', problems.length); [...new Set(problems)].slice(0, 15).forEach((p) => console.log('  -', p));
  cdp.close(); spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
})().catch((e) => { console.error(e); process.exit(1); });
