(function () {
  const USAGE_KEY = 'pixelody.themeUsage';
  const MAX_HELD_IMAGES = 24;
  const ALWAYS_WARM = ['studio'];
  const THEME_FOLDERS = {
    'orbital-retro': ['orbital'],
    'graphite-loadout': ['graphite-loadout'],
    'cartridge-quest': ['cartridge-quest'],
    'cosmic-cinema': ['cosmic-cinema'],
    'frosted-void': ['frosted-void'],
    'dead-signal': ['dead-signal'],
    'meme-machine': ['meme-machine'],
  };
  const FONT_HINTS = [
    { pattern: /Geist Pixel Circle/i, themes: ['studio', 'cartridge-quest'] },
    { pattern: /Kenney Future/i, themes: ['orbital'] },
    { pattern: /Rajdhani/i, themes: ['graphite-loadout'] },
    { pattern: /Quest Pixel/i, themes: ['cartridge-quest'] },
    { pattern: /Space Grotesk Cosmic|IBM Plex Mono Cosmic/i, themes: ['cosmic-cinema'] },
    { pattern: /Space Grotesk Void|IBM Plex Mono Void/i, themes: ['frosted-void'] },
    { pattern: /Dead Signal/i, themes: ['dead-signal'] },
    { pattern: /Meme Grotesk|Meme Mono/i, themes: ['meme-machine'] },
  ];
  const URL_RE = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
  const THEME_RE = /data-theme\s*=\s*["']([^"']+)["']/gi;

  const idle = (callback, timeout = 1200) => {
    if ('requestIdleCallback' in window) return window.requestIdleCallback(callback, { timeout });
    return window.setTimeout(() => callback({ timeRemaining: () => 8, didTimeout: true }), Math.min(timeout, 120));
  };

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function normalizeResource(raw) {
    if (!raw || /^(https?:|data:|blob:)/i.test(raw)) return '';
    const url = new URL(raw, document.baseURI);
    if (url.protocol !== 'file:') return '';
    const href = url.href;
    if (!href.includes('/assets/')) return '';
    const lower = decodeURIComponent(href).toLowerCase();
    if (lower.includes('/user-memes/') || lower.includes('/licensed-memes/')) return '';
    if (/\.(gif)(\?|#|$)/i.test(lower)) return '';
    return href;
  }

  function inferThemes(text) {
    THEME_RE.lastIndex = 0;
    const themes = [];
    let match;
    while ((match = THEME_RE.exec(text))) themes.push(match[1]);
    Object.entries(THEME_FOLDERS).forEach(([folder, keys]) => {
      if (text.includes(`assets/themes/${folder}/`)) themes.push(...keys);
    });
    FONT_HINTS.forEach((hint) => {
      if (hint.pattern.test(text)) themes.push(...hint.themes);
    });
    if (text.includes('assets/fonts/GeistPixel-Circle.woff2')) themes.push('studio', 'cartridge-quest');
    return unique(themes);
  }

  function extractUrls(text) {
    URL_RE.lastIndex = 0;
    const urls = [];
    let match;
    while ((match = URL_RE.exec(text))) {
      const url = normalizeResource(match[1]);
      if (url) urls.push(url);
    }
    return unique(urls);
  }

  function extractFontFamily(text) {
    const match = text.match(/font-family\s*:\s*["']?([^;"'}]+)/i);
    return match ? match[1].trim() : '';
  }

  function createPixelodyThemePreloader() {
    const byTheme = new Map();
    const warmed = new Set();
    const queue = [];
    const heldImages = [];
    let collected = false;
    let pumping = false;
    let playing = false;
    let performanceMode = 'full';
    let lastTheme = '';
    let lastError = '';

    function bucket(theme) {
      if (!byTheme.has(theme)) byTheme.set(theme, { urls: new Set(), fonts: new Set() });
      return byTheme.get(theme);
    }

    function noteResource(theme, url) {
      if (!theme || !url) return;
      bucket(theme).urls.add(url);
    }

    function noteFont(theme, family) {
      if (!theme || !family) return;
      bucket(theme).fonts.add(family);
    }

    function visitRule(rule) {
      if (rule.cssRules) {
        // Keyframes account for a large share of Pixelody's CSS rules and cannot
        // contain preloadable theme assets. Skipping them keeps the first idle
        // collection pass from walking every animation step in every theme.
        if (rule.type === 7) return;
        Array.from(rule.cssRules).forEach(visitRule);
        return;
      }
      const text = rule.cssText || '';
      if (!text) return;
      // Most style rules contain neither an asset nor a font declaration. Bail
      // out before running the theme/url regular expressions over those rules.
      if (!text.includes('url(') && !/^@font-face/i.test(text)) return;
      const themes = inferThemes(text);
      if (!themes.length) return;
      const urls = extractUrls(text);
      urls.forEach((url) => themes.forEach((theme) => noteResource(theme, url)));
      if (/^@font-face/i.test(text)) {
        const family = extractFontFamily(text);
        themes.forEach((theme) => noteFont(theme, family));
      }
    }

    function collect() {
      if (collected) return;
      collected = true;
      Array.from(document.styleSheets).forEach((sheet) => {
        try {
          Array.from(sheet.cssRules || []).forEach(visitRule);
        } catch (error) {
          lastError = error.message || String(error);
        }
      });
    }

    function taskKey(task) {
      return `${task.type}:${task.value}`;
    }

    function themeTasks(theme) {
      collect();
      const resources = byTheme.get(theme);
      if (!resources) return [];
      const fonts = [...resources.fonts].map((value) => ({ type: 'font', value, theme }));
      const urls = [...resources.urls].map((value) => ({ type: 'image', value, theme }));
      return [...fonts, ...urls].filter((task) => !warmed.has(taskKey(task)));
    }

    async function runTask(task) {
      const key = taskKey(task);
      if (warmed.has(key)) return;
      try {
        if (task.type === 'font' && document.fonts?.load) {
          await Promise.race([
            Promise.all([
              document.fonts.load(`400 13px "${task.value}"`),
              document.fonts.load(`700 13px "${task.value}"`),
            ]),
            new Promise((resolve) => setTimeout(resolve, 700)),
          ]);
        } else if (task.type === 'image') {
          await new Promise((resolve) => {
            const image = new Image();
            image.decoding = 'async';
            image.onload = () => resolve();
            image.onerror = () => resolve();
            image.src = task.value;
            if (image.decode) image.decode().then(resolve).catch(resolve);
            heldImages.push(image);
            if (heldImages.length > MAX_HELD_IMAGES) heldImages.shift();
          });
        }
        warmed.add(key);
      } catch (error) {
        lastError = error.message || String(error);
      }
    }

    function pump() {
      if (pumping || !queue.length) return;
      pumping = true;
      const guarded = performanceMode === 'conserve' || performanceMode === 'balanced';
      const wait = playing && performanceMode === 'conserve' ? 2400 : playing || guarded ? 900 : 0;
      window.setTimeout(() => {
        idle(async (deadline) => {
          const allowance = playing || guarded ? 1 : Math.max(1, Math.min(3, queue.length));
          let count = 0;
          while (queue.length && count < allowance && (deadline.didTimeout || deadline.timeRemaining() > 2)) {
            const task = queue.shift();
            if (!warmed.has(taskKey(task))) {
              await runTask(task);
              count += 1;
            }
          }
          pumping = false;
          if (queue.length) pump();
        }, playing ? 2200 : 900);
      }, wait);
    }

    function enqueue(tasks, priority = false) {
      const pending = tasks.filter((task) => !warmed.has(taskKey(task)) && !queue.some((queued) => taskKey(queued) === taskKey(task)));
      if (priority) queue.unshift(...pending.reverse());
      else queue.push(...pending);
      pump();
    }

    async function prepare(theme, options = {}) {
      lastTheme = theme;
      const tasks = themeTasks(theme);
      const critical = tasks.slice(0, options.maxTasks || (playing ? 5 : 9));
      const rest = tasks.slice(critical.length);
      enqueue(rest, false);
      const timeout = new Promise((resolve) => setTimeout(resolve, options.timeout || (playing ? 140 : 220)));
      await Promise.race([Promise.all(critical.map(runTask)), timeout]);
      return status();
    }

    function warmTheme(theme, options = {}) {
      lastTheme = theme || lastTheme;
      if (!theme) return status();
      enqueue(themeTasks(theme), Boolean(options.priority));
      return status();
    }

    function configure(next = {}) {
      if (Object.prototype.hasOwnProperty.call(next, 'playing')) playing = Boolean(next.playing);
      if (next.performanceMode) performanceMode = next.performanceMode;
    }

    function usage() {
      try { return JSON.parse(localStorage.getItem(USAGE_KEY) || '{}'); }
      catch { return {}; }
    }

    function markUsed(theme) {
      if (!theme) return;
      const all = usage();
      const record = all[theme] || { count: 0, lastUsed: 0 };
      all[theme] = { count: Number(record.count || 0) + 1, lastUsed: Date.now() };
      localStorage.setItem(USAGE_KEY, JSON.stringify(all));
    }

    function recentThemes(limit = 2) {
      return Object.entries(usage())
        .sort((a, b) => (b[1].lastUsed || 0) - (a[1].lastUsed || 0) || (b[1].count || 0) - (a[1].count || 0))
        .map(([theme]) => theme)
        .slice(0, limit);
    }

    function warmUsefulThemes(activeTheme) {
      const themes = unique([activeTheme, ...(playing ? [] : recentThemes(2)), ...ALWAYS_WARM]);
      themes.forEach((theme, index) => warmTheme(theme, { priority: index === 0 }));
      return themes;
    }

    function status() {
      collect();
      return {
        lastTheme: lastTheme || null,
        knownThemes: byTheme.size,
        queue: queue.length,
        warmed: warmed.size,
        playing,
        performanceMode,
        error: lastError || null,
      };
    }

    return { configure, prepare, warmTheme, warmUsefulThemes, markUsed, recentThemes, status };
  }

  window.createPixelodyThemePreloader = createPixelodyThemePreloader;
})();
