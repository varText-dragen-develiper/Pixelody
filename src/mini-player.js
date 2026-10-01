const $ = (selector) => document.querySelector(selector);
const time = (seconds) => Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : '0:00';
const score = (value) => Number(value || 0).toLocaleString();
const comboLabel = (tier, label) => label || (Number(tier || 0) >= 4 ? 'MAX' : `x${Math.max(1, Number(tier || 0) + 1)}`);
const miniThemeGlyph = window.PixelodyThemeGlyph;
if (!miniThemeGlyph) throw new Error('Theme glyph foundation failed to load.');
const miniUiSounds = window.createPixelodyUiSounds?.({ settings: { mode: 'off', volume: 0.28 }, theme: 'studio' });
const miniThemePreloader = window.createPixelodyThemePreloader?.();
miniUiSounds?.install(document);
let lastQuestRewardSerial = 0;
let integrationMiniCommandSent = false;
let lastCounterformMiniReceipt = '';
let lastCommunityThemeMiniReceipt = '';
let lastSingularityMiniReceipt = '';
let lastMiniStaticSignature = '';
let lastMiniTrackSignature = '';

function setMiniText(selector, value) {
  const element = $(selector);
  if (element && element.textContent !== value) element.textContent = value;
}

function setMiniDataset(element, key, value) {
  const next = String(value);
  if (element?.dataset[key] !== next) element.dataset[key] = next;
}

function setMiniStyle(element, property, value) {
  if (element?.style[property] !== value) element.style[property] = value;
}
const integrationMiniConfig = window.desktop.integrationTest?.enabled
  ? window.desktop.integrationTest.getConfig().catch(() => ({ enabled: false }))
  : Promise.resolve({ enabled: false });

document.addEventListener('visibilitychange', () => {
  document.body.dataset.visibility = document.hidden ? 'hidden' : 'visible';
});

function miniCartridgeQuestExperienceActive() {
  return document.body.dataset.theme === 'cartridge-quest'
    || (document.body.dataset.theme === 'foreground' && document.body.dataset.canvasThemePort === 'cartridge-quest');
}

function triggerMiniQuestReward(amount) {
  if (!miniCartridgeQuestExperienceActive() || document.body.dataset.motion === 'off' || document.body.dataset.performance === 'conserve' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const xp = $('#miniQuestXp');
  xp.dataset.reward = `+${amount || 10}`;
  xp.classList.remove('mini-quest-rewarding');
  void xp.offsetWidth;
  xp.classList.add('mini-quest-rewarding');
  setTimeout(() => xp.classList.remove('mini-quest-rewarding'), 980);
}

window.desktop.onPlayerState((state) => {
  const communityTheme = state.theme === 'community' ? state.communityTheme : null;
  const canvasThemePort = state.theme === 'foreground' ? state.canvasThemePort : null;
  const communityTokens = communityTheme?.tokens || {};
  const canvasPortColors = canvasThemePort?.colors || {};
  const creatorLayer = state.creatorLayer || {};
  const staticSignature = [
    state.theme || 'studio', state.accent || '', state.performanceMode || 'balanced',
    state.motion || 'calm', state.outputId || '', Number(Boolean(state.paused)),
    state.interfaceSounds?.mode || '', state.interfaceSounds?.volume || 0,
    Number(state.effects?.glow !== false), Number(state.effects?.artwork !== false),
    creatorLayer.accent || '', creatorLayer.mood || '', creatorLayer.density || '',
    creatorLayer.avatar || '', creatorLayer.rows || '', creatorLayer.decor || '',
    communityTheme?.id || '', canvasThemePort?.key || '', state.compositionProfile || '', state.singularityProbe || '', ...Object.values(communityTokens), ...Object.values(canvasPortColors),
  ].join('|');
  if (staticSignature !== lastMiniStaticSignature) {
    const communityVariables = {
      '--community-primary': communityTokens.accentPrimary,
      '--community-secondary': communityTokens.accentSecondary,
      '--community-state': communityTokens.accentState,
      '--community-canvas': communityTokens.canvas,
      '--community-elevation1': communityTokens.elevation1,
      '--community-elevation2': communityTokens.elevation2,
      '--community-divider': communityTokens.divider,
      '--community-frame': communityTokens.frame,
      '--community-foreground': communityTokens.foreground,
      '--community-muted': communityTokens.foregroundMuted,
    };
    Object.entries(communityVariables).forEach(([name, value]) => {
      if (value && document.documentElement.style.getPropertyValue(name) !== value) document.documentElement.style.setProperty(name, value);
      else if (!value) document.documentElement.style.removeProperty(name);
    });
    const canvasPortVariables = {
      '--nb-halftone': state.canvasTempo?.halftone,
      '--cafe-lamp': state.cafeLamp,
      '--canvas-port-gold': canvasPortColors.gold,
      '--canvas-port-gold2': canvasPortColors.gold2,
      '--canvas-port-green': canvasPortColors.green,
      '--canvas-port-hero': canvasPortColors.hero,
      '--canvas-port-bg': canvasPortColors.bg,
      '--canvas-port-surface': canvasPortColors.surface,
      '--canvas-port-surface2': canvasPortColors.surface2,
      '--canvas-port-surface3': canvasPortColors.surface3,
      '--canvas-port-line': canvasPortColors.line,
      '--canvas-port-edge': canvasPortColors.edge,
      '--canvas-port-text': canvasPortColors.text,
      '--canvas-port-muted': canvasPortColors.muted,
    };
    Object.entries(canvasPortVariables).forEach(([name, value]) => {
      if (value && document.documentElement.style.getPropertyValue(name) !== value) document.documentElement.style.setProperty(name, value);
      else if (!value) document.documentElement.style.removeProperty(name);
    });
    const accent = state.accent || '#d8b66a';
    if (document.documentElement.style.getPropertyValue('--mini-accent') !== accent) document.documentElement.style.setProperty('--mini-accent', accent);
    setMiniDataset(document.body, 'theme', state.theme || 'studio');
    // Absent, not empty, when off: the probe and profile sheets select on the
    // attribute being present, so an empty one switched Studio's mini player to
    // the Singularity probe's dark ink on Studio's dark shell and the title
    // disappeared.
    if (state.compositionProfile) setMiniDataset(document.body, 'compositionProfile', state.compositionProfile);
    else delete document.body.dataset.compositionProfile;
    if (state.singularityProbe) setMiniDataset(document.body, 'singularityProbe', state.singularityProbe);
    else delete document.body.dataset.singularityProbe;
    const canvasPortDatasets = {
      nbTempo: state.canvasTempo?.state,
      canvasThemePort: canvasThemePort?.key,
      canvasPortLayout: canvasThemePort?.hud?.layout,
      canvasPortControls: canvasThemePort?.hud?.controls,
      canvasPortCorners: canvasThemePort?.hud?.corners,
      canvasPortType: canvasThemePort?.typography?.profile,
      canvasPortMotion: canvasThemePort?.motion?.profile,
      canvasPortIntensity: canvasThemePort?.motion?.intensity,
    };
    Object.entries(canvasPortDatasets).forEach(([key, value]) => {
      if (value) setMiniDataset(document.body, key, value);
      else delete document.body.dataset[key];
    });
    setMiniDataset($('.mini-shell'), 'canvasPortLabel', canvasThemePort?.name || 'FOREGROUND');
    document.querySelectorAll('link[rel="stylesheet"][href="mini-foreground.css"]').forEach((link) => { link.disabled = (state.theme || 'studio') !== 'foreground'; });
    document.querySelectorAll('link[rel="stylesheet"][href="mini-canvas-theme-ports.css"]').forEach((link) => { link.disabled = (state.theme || 'studio') !== 'foreground' || !canvasThemePort; });
    document.querySelectorAll('link[rel="stylesheet"][href="mini-canvas-cartridge-quest.css"]').forEach((link) => { link.disabled = (state.theme || 'studio') !== 'foreground' || canvasThemePort?.experience?.miniStylesheet !== 'mini-canvas-cartridge-quest.css'; });
    document.querySelectorAll('link[rel="stylesheet"][href="mini-canvas-obsession.css"]').forEach((link) => { link.disabled = (state.theme || 'studio') !== 'foreground' || canvasThemePort?.experience?.miniStylesheet !== 'mini-canvas-obsession.css'; });
    document.querySelectorAll('link[rel="stylesheet"][href="mini-canvas-neon-burst.css"]').forEach((link) => { link.disabled = (state.theme || 'studio') !== 'foreground' || canvasThemePort?.experience?.miniStylesheet !== 'mini-canvas-neon-burst.css'; });
    document.querySelectorAll('link[rel="stylesheet"][href="mini-canvas-lo-fi-cafe.css"]').forEach((link) => { link.disabled = (state.theme || 'studio') !== 'foreground' || canvasThemePort?.experience?.miniStylesheet !== 'mini-canvas-lo-fi-cafe.css'; });
    if (communityTheme) {
      setMiniDataset(document.body, 'communityThemeId', communityTheme.id || '');
      setMiniDataset(document.body, 'communityLayout', communityTheme.hud?.layout || 'studio');
      setMiniDataset(document.body, 'communityControls', communityTheme.hud?.controls || 'technical');
      setMiniDataset(document.body, 'communityCorners', communityTheme.hud?.corners || 'framed');
      setMiniDataset(document.body, 'communityType', communityTheme.typography?.profile || 'technical');
      setMiniDataset(document.body, 'communityMotion', communityTheme.motion?.profile || 'signal');
    } else {
      ['communityThemeId', 'communityLayout', 'communityControls', 'communityCorners', 'communityType', 'communityMotion'].forEach((key) => { delete document.body.dataset[key]; });
    }
    setMiniDataset(document.body, 'creatorAccent', creatorLayer.accent || 'blurple');
    setMiniDataset(document.body, 'creatorMood', creatorLayer.mood || 'midnight');
    setMiniDataset(document.body, 'creatorDensity', creatorLayer.density || 'cozy');
    setMiniDataset(document.body, 'creatorAvatar', creatorLayer.avatar || 'squircle');
    setMiniDataset(document.body, 'creatorRows', creatorLayer.rows || 'message');
    setMiniDataset(document.body, 'creatorDecor', creatorLayer.decor || 'status');
    setMiniDataset(document.body, 'glow', state.effects?.glow !== false);
    setMiniDataset(document.body, 'artwork', state.effects?.artwork !== false);
    setMiniDataset(document.body, 'performance', state.performanceMode || 'balanced');
    setMiniDataset(document.body, 'motion', state.motion || 'calm');
    miniUiSounds?.configure({ settings: state.interfaceSounds || { mode: 'off', volume: 0.28 }, theme: canvasThemePort?.key || state.theme || 'studio', performanceMode: state.performanceMode || 'balanced', outputId: state.outputId || '', playing: !state.paused });
    miniThemePreloader?.configure({ playing: !state.paused, performanceMode: state.performanceMode || 'balanced' });
    miniThemePreloader?.warmTheme(state.theme || 'studio', { priority: true });
    lastMiniStaticSignature = staticSignature;
  }
  setMiniText('#miniTitle', state.title || 'Nothing playing');
  const chorus = state.chorus || {};
  setMiniText('#cfMiniPrevious', `PREVIOUS / ${chorus.previous?.title || '--'}`);
  setMiniText('#cfMiniCurrent', `CURRENT / ${chorus.current?.title || state.title || 'NOTHING PLAYING'}`);
  setMiniText('#cfMiniNext', `NEXT / ${chorus.next?.title || '--'}`);
  setMiniText('#miniArtist', [state.artist, state.album].filter(Boolean).join(' · ') || 'Open a track in Pixelody');
  setMiniText('#miniQuality', state.quality || 'PIXELODY');
  setMiniText('#miniElapsed', time(state.currentTime));
  setMiniText('#miniDuration', time(state.duration));
  setMiniStyle($('#miniProgress'), 'width', `${state.duration ? Math.min(100, state.currentTime / state.duration * 100) : 0}%`);
  setMiniText('#miniQuestXp', `XP ${score(state.questStats?.xp)}`);
  setMiniText('#miniQuestRun', `RUN ${time(state.questStats?.streakSeconds)}`);
  setMiniText('#miniQuestHi', `HI ${time(state.questStats?.highScoreSeconds)}`);
  setMiniText('#miniQuestCombo', `COMBO ${comboLabel(state.questStats?.comboTier, state.questStats?.comboLabel)}`);
  setMiniDataset($('#miniQuestCombo'), 'comboTier', state.questStats?.comboTier || 0);
  const rewardSerial = Number(state.questStats?.rewardSerial || 0);
  if (rewardSerial && rewardSerial !== lastQuestRewardSerial) triggerMiniQuestReward(state.questStats?.rewardAmount);
  lastQuestRewardSerial = rewardSerial;
  $('#miniPlayIcon').classList.toggle('mini-play-icon', state.paused);
  $('#miniPlayIcon').classList.toggle('mini-pause-icon', !state.paused);
  $('#miniPlay').title = state.paused ? 'Play' : 'Pause';
  document.body.classList.toggle('playing', !state.paused);
  const trackSignature = `${state.title || ''}|${state.artist || ''}|${state.album || ''}|${state.artworkUrl || ''}`;
  if (trackSignature !== lastMiniTrackSignature) {
    const art = $('#miniArt');
    setMiniStyle(art, 'backgroundImage', state.artworkUrl ? `url("${state.artworkUrl}")` : '');
    art.classList.toggle('has-image', Boolean(state.artworkUrl));
    const glyph = miniThemeGlyph.describe(`${state.title || ''}|${state.artist || ''}|${state.album || ''}`);
    setMiniDataset(art, 'themeGlyph', glyph.variant);
    setMiniDataset(art, 'themeRotation', glyph.rotation);
    setMiniDataset(art, 'themeEdition', glyph.edition);
    lastMiniTrackSignature = trackSignature;
  }
  if (state.theme === 'counterform-choir' && window.desktop.integrationTest?.enabled) {
    const receiptKey = `${state.title || ''}|${state.paused}|${chorus.previous?.title || ''}|${chorus.next?.title || ''}|${Math.floor(Number(state.currentTime) || 0)}|${innerWidth}x${innerHeight}`;
    if (receiptKey !== lastCounterformMiniReceipt) {
      lastCounterformMiniReceipt = receiptKey;
      integrationMiniConfig.then((config) => {
        if (config?.enabled && config.scenario === 'counterform-choir') {
          const rect = (selector) => {
            const bounds = $(selector)?.getBoundingClientRect();
            return bounds ? { x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) } : null;
          };
          return window.desktop.integrationTest.report('counterform-mini-state', {
            theme: document.body.dataset.theme,
            title: $('#miniTitle').textContent,
            previous: $('#cfMiniPrevious').textContent,
            current: $('#cfMiniCurrent').textContent,
            next: $('#cfMiniNext').textContent,
            paused: document.body.classList.contains('playing') === false,
            progress: $('#miniProgress').style.width,
            viewport: { width: innerWidth, height: innerHeight },
            layout: { art: rect('.mini-art'), copy: rect('.mini-copy'), controls: rect('.mini-controls'), windowActions: rect('.window-actions') },
            runtimeSecurity: window.desktop.runtimeSecurity,
          });
        }
        return false;
      }).catch(() => {});
    }
  }
  if (communityTheme && window.desktop.integrationTest?.enabled) {
    const receiptKey = `${communityTheme.runtimeKey || ''}|${communityTheme.id || ''}|${communityTokens.accentPrimary || ''}`;
    if (receiptKey !== lastCommunityThemeMiniReceipt) {
      lastCommunityThemeMiniReceipt = receiptKey;
      integrationMiniConfig.then((config) => {
        if (config?.enabled && config.scenario.startsWith('theme-package')) {
          return window.desktop.integrationTest.report('community-theme-mini-state', {
            theme: document.body.dataset.theme,
            id: document.body.dataset.communityThemeId,
            layout: document.body.dataset.communityLayout,
            accent: getComputedStyle(document.documentElement).getPropertyValue('--community-primary').trim(),
            runtimeSecurity: window.desktop.runtimeSecurity,
          });
        }
        return false;
      }).catch(() => {});
    }
  }
  if (state.singularityProbe && window.desktop.integrationTest?.enabled) {
    const receiptKey = `${state.singularityProbe}|${state.title || ''}|${state.paused}|${innerWidth}x${innerHeight}`;
    if (receiptKey !== lastSingularityMiniReceipt) {
      lastSingularityMiniReceipt = receiptKey;
      integrationMiniConfig.then((config) => {
        if (config?.enabled && ['singularity-stage3', 'singularity-stage3-proxy'].includes(config.scenario)) {
          const rect = (selector) => {
            const bounds = $(selector)?.getBoundingClientRect();
            return bounds ? { x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) } : null;
          };
          const bodyStyle = getComputedStyle(document.body);
          const shellStyle = getComputedStyle($('.mini-shell'));
          return window.desktop.integrationTest.report('singularity-mini-state', {
            probe: document.body.dataset.singularityProbe,
            title: $('#miniTitle').textContent,
            paused: !document.body.classList.contains('playing'),
            artworkApplied: $('#miniArt').classList.contains('has-image')
              && Boolean($('#miniArt').style.backgroundImage),
            viewport: { width: innerWidth, height: innerHeight },
            layout: { art: rect('.mini-art'), copy: rect('.mini-copy'), controls: rect('.mini-controls') },
            material: {
              bodyBackgroundColor: bodyStyle.backgroundColor,
              shellBackgroundImage: shellStyle.backgroundImage,
              shellColor: shellStyle.color,
              shellBorderTopColor: shellStyle.borderTopColor,
            },
            runtimeSecurity: window.desktop.runtimeSecurity,
          });
        }
        return false;
      }).catch(() => {});
    }
  }
  if (!integrationMiniCommandSent && window.desktop.integrationTest?.enabled && !state.paused) {
    integrationMiniCommandSent = true;
    setTimeout(async () => {
      const config = await integrationMiniConfig;
      if (!config?.enabled || !['core', 'workspace-production'].includes(config.scenario)) return;
      $('#miniPlay').click();
      await window.desktop.integrationTest.report('mini-command', { command: 'toggle', receivedState: true, runtimeSecurity: window.desktop.runtimeSecurity });
    }, 80);
  }
});

$('#miniPrev').onclick = () => window.desktop.sendMiniCommand('previous');
$('#miniPlay').onclick = () => window.desktop.sendMiniCommand('toggle');
$('#miniNext').onclick = () => window.desktop.sendMiniCommand('next');
$('#restoreMain').onclick = () => window.desktop.restoreMainWindow();
$('#closeMini').onclick = () => window.desktop.closeMiniPlayer();
