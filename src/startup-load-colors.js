// Runs in <head>, before the first paint. The loading screen is static markup
// whose colours come from the stylesheet, which can only know the default
// palette (gold). Without this, every launch painted the default screen first
// and then dissolved into the saved theme's colours. The renderer stores the
// colours the next launch will need (see persistStartupLoadColors in
// renderer.js); this applies them to the very first frame.
(function applyStartupLoadColors() {
  try {
    const raw = window.localStorage.getItem('pixelody.startupLoadColors');
    if (!raw) return;
    const stored = JSON.parse(raw);
    const keys = ['fromBg', 'fromSurface', 'fromAccent', 'fromAccent2', 'toBg', 'toSurface', 'toAccent', 'toAccent2', 'text', 'muted', 'mark'];
    const hex = /^#[0-9a-f]{6}$/i;
    if (!stored || keys.some((key) => !hex.test(String(stored[key] || '')))) return;
    const style = document.createElement('style');
    style.id = 'startup-load-colors';
    style.textContent = `html .theme-load-screen{--theme-load-from-bg:${stored.fromBg};--theme-load-from-surface:${stored.fromSurface};--theme-load-from-accent:${stored.fromAccent};--theme-load-from-accent-2:${stored.fromAccent2};--theme-load-to-bg:${stored.toBg};--theme-load-to-surface:${stored.toSurface};--theme-load-to-accent:${stored.toAccent};--theme-load-to-accent-2:${stored.toAccent2};--theme-load-text:${stored.text};--theme-load-muted:${stored.muted};--brand-mark:${stored.mark}}`;
    document.head.appendChild(style);
  } catch {
    // Storage can be unavailable; the default screen is the safe fallback.
  }
}());
