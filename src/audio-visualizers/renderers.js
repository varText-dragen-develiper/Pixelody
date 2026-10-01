(function pixelodyVisualizerRenderersFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyVisualizerRenderers = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createRendererApi() {
  'use strict';

  const TAU = Math.PI * 2;
  const PROCESS_FAMILIES = Object.freeze(['frequency', 'waveform', 'history', 'stereo', 'particles', 'geometry', 'metering', 'mechanical', 'weave']);

  function clamp(value, minimum = 0, maximum = 1) { return Math.max(minimum, Math.min(maximum, Number(value) || 0)); }
  function sample(values, position) {
    if (!values?.length) return 0;
    const at = clamp(position) * (values.length - 1);
    const left = Math.floor(at);
    const right = Math.min(values.length - 1, left + 1);
    return values[left] * (1 - (at - left)) + values[right] * (at - left);
  }
  function rgba(hex, alpha) {
    const value = String(hex || '#ffffff').replace('#', '');
    const full = value.length === 3 ? value.split('').map((part) => part + part).join('') : value.padEnd(6, 'f').slice(0, 6);
    return `rgba(${parseInt(full.slice(0, 2), 16)},${parseInt(full.slice(2, 4), 16)},${parseInt(full.slice(4, 6), 16)},${clamp(alpha)})`;
  }
  function clear(ctx, width, height, palette, alpha = 1) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = rgba(palette.background, alpha);
    ctx.fillRect(0, 0, width, height);
  }
  function line(ctx, color, width = 1, alpha = 1) {
    ctx.strokeStyle = rgba(color, alpha);
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }
  function pathWave(ctx, values, width, height, amplitude = 0.38, phase = 0, verticalOffset = 0.5) {
    ctx.beginPath();
    for (let index = 0; index < values.length; index += 1) {
      const x = index / Math.max(1, values.length - 1) * width;
      const normalized = values[(index + phase + values.length) % values.length] * 2 - 1;
      const y = height * verticalOffset + normalized * height * amplitude;
      if (!index) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
  }
  function energy(frame, index) {
    const values = [frame.bands.sub, frame.bands.bass, frame.bands.lowMid, frame.bands.mid, frame.bands.highMid, frame.bands.air];
    return values[index % values.length];
  }
  function seeded(index) {
    const value = Math.sin((index + 1) * 91.231) * 43758.5453;
    return value - Math.floor(value);
  }
  function pushHistory(state, key, value, limit) {
    const history = state[key] || (state[key] = []);
    history.push(value);
    if (history.length > limit) history.splice(0, history.length - limit);
    return history;
  }

  function spectrumDeck({ ctx, width, height, frame, palette, state, quality }) {
    clear(ctx, width, height, palette, 0.94);
    const count = quality === 'conserve' ? 24 : Math.max(28, Math.min(64, Math.floor(width / 10)));
    const gap = Math.max(2, width / count * 0.18);
    const barWidth = width / count - gap;
    state.peaks = state.peaks || new Float32Array(count);
    if (state.peaks.length !== count) state.peaks = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      const value = sample(frame.spectrum, Math.pow(index / Math.max(1, count - 1), 1.65));
      const barHeight = Math.max(2, value * height * 0.88);
      const x = index * width / count + gap / 2;
      const gradient = ctx.createLinearGradient(0, height, 0, 0);
      gradient.addColorStop(0, palette.secondary);
      gradient.addColorStop(0.68, palette.primary);
      gradient.addColorStop(1, palette.highlight);
      ctx.fillStyle = gradient;
      ctx.fillRect(x, height - barHeight, barWidth, barHeight);
      state.peaks[index] = Math.max(value, state.peaks[index] - 0.014);
      ctx.fillStyle = rgba(palette.highlight, 0.88);
      ctx.fillRect(x, height - state.peaks[index] * height * 0.88 - 4, barWidth, 2);
    }
  }

  function mirrorScope({ ctx, width, height, frame, palette }) {
    clear(ctx, width, height, palette, 0.92);
    line(ctx, palette.muted, 1, 0.22);
    ctx.beginPath(); ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2); ctx.stroke();
    const glow = Math.max(2, Math.min(10, frame.rms * 12));
    ctx.save(); ctx.shadowBlur = glow; ctx.shadowColor = palette.primary;
    line(ctx, palette.primary, 2, 0.92); pathWave(ctx, frame.waveform, width, height, 0.34); ctx.stroke();
    ctx.translate(0, height); ctx.scale(1, -1);
    line(ctx, palette.secondary, 1.25, 0.48); pathWave(ctx, frame.waveform, width, height, 0.18); ctx.stroke(); ctx.restore();
  }

  function radialCrown({ ctx, width, height, frame, palette, quality }) {
    clear(ctx, width, height, palette, 0.9);
    const cx = width / 2; const cy = height / 2; const base = Math.min(width, height) * 0.18;
    const count = quality === 'conserve' ? 48 : 96;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(-Math.PI / 2);
    for (let index = 0; index < count; index += 1) {
      const value = sample(frame.spectrum, Math.pow(index / count, 1.4));
      const angle = index / count * TAU;
      const length = base * (0.18 + value * 1.24);
      ctx.save(); ctx.rotate(angle); line(ctx, index % 3 ? palette.primary : palette.highlight, Math.max(1, base * 0.025), 0.35 + value * 0.65);
      ctx.beginPath(); ctx.moveTo(base, 0); ctx.lineTo(base + length, 0); ctx.stroke(); ctx.restore();
    }
    line(ctx, palette.secondary, 1.5, 0.7); ctx.beginPath(); ctx.arc(0, 0, base * (0.9 + frame.bands.bass * 0.12), 0, TAU); ctx.stroke(); ctx.restore();
  }

  function waterfall({ ctx, width, height, frame, palette, state, quality }) {
    const columns = quality === 'conserve' ? 32 : 64;
    const rows = quality === 'conserve' ? 28 : 52;
    if (!state.rows || state.rows[0]?.length !== columns) state.rows = [];
    const next = new Float32Array(columns);
    for (let index = 0; index < columns; index += 1) next[index] = sample(frame.spectrum, Math.pow(index / (columns - 1), 1.55));
    state.rows.unshift(next); if (state.rows.length > rows) state.rows.length = rows;
    clear(ctx, width, height, palette, 0.98);
    const cellWidth = width / columns; const cellHeight = height / rows;
    state.rows.forEach((row, rowIndex) => row.forEach((value, index) => {
      const fade = 1 - rowIndex / rows;
      ctx.fillStyle = value > 0.72 ? rgba(palette.highlight, value * fade) : value > 0.38 ? rgba(palette.primary, value * fade) : rgba(palette.secondary, value * fade * 0.82);
      ctx.fillRect(index * cellWidth, rowIndex * cellHeight, cellWidth + 0.5, cellHeight + 0.5);
    }));
  }

  function stereoPhase({ ctx, width, height, frame, palette, quality }) {
    clear(ctx, width, height, palette, 0.96);
    line(ctx, palette.muted, 1, 0.18);
    ctx.beginPath(); ctx.moveTo(width / 2, 8); ctx.lineTo(width / 2, height - 8); ctx.moveTo(8, height / 2); ctx.lineTo(width - 8, height / 2); ctx.stroke();
    ctx.save(); ctx.shadowBlur = 7; ctx.shadowColor = palette.primary; line(ctx, frame.stereoWidth > 0.55 ? palette.highlight : palette.primary, 1.35, 0.76);
    ctx.beginPath();
    const stride = quality === 'conserve' ? 4 : 2;
    for (let index = 0; index < frame.left.length; index += stride) {
      const left = frame.left[index] * 2 - 1; const right = frame.right[index] * 2 - 1;
      const x = width / 2 + (left - right) * width * 0.31;
      const y = height / 2 - (left + right) * height * 0.22;
      if (!index) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke(); ctx.restore();
  }

  function ribbonCurrent({ ctx, width, height, frame, palette, quality }) {
    clear(ctx, width, height, palette, 0.9);
    const layers = quality === 'conserve' ? 4 : 8;
    for (let layer = layers - 1; layer >= 0; layer -= 1) {
      const offset = (layer - (layers - 1) / 2) * height * 0.055;
      ctx.save(); ctx.translate(0, offset); line(ctx, layer % 2 ? palette.primary : palette.secondary, 1 + frame.rms * 1.8, 0.16 + (layers - layer) / layers * 0.42);
      pathWave(ctx, frame.waveform, width, height, 0.12 + layer * 0.018, layer * 5, 0.5); ctx.stroke(); ctx.restore();
    }
    const gradient = ctx.createLinearGradient(0, 0, width, 0); gradient.addColorStop(0, rgba(palette.background, 0.8)); gradient.addColorStop(0.5, rgba(palette.highlight, 0.08 + frame.beat * 0.22)); gradient.addColorStop(1, rgba(palette.background, 0.8));
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
  }

  function topographic({ ctx, width, height, frame, palette, state, quality }) {
    const row = new Float32Array(quality === 'conserve' ? 30 : 56);
    for (let index = 0; index < row.length; index += 1) row[index] = sample(frame.spectrum, Math.pow(index / (row.length - 1), 1.45));
    const history = pushHistory(state, 'terrain', row, quality === 'conserve' ? 9 : 16);
    clear(ctx, width, height, palette, 0.96);
    history.forEach((values, rowIndex) => {
      const depth = rowIndex / Math.max(1, history.length - 1);
      const baseY = height * (0.18 + depth * 0.73);
      line(ctx, rowIndex % 4 ? palette.secondary : palette.primary, 1 + (1 - depth) * 0.65, 0.16 + (1 - depth) * 0.64);
      ctx.beginPath();
      values.forEach((value, index) => {
        const x = index / (values.length - 1) * width;
        const y = baseY - value * height * (0.13 + (1 - depth) * 0.25);
        if (!index) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });
  }

  function particleDrift({ ctx, width, height, frame, palette, state, delta, quality }) {
    const count = quality === 'conserve' ? 34 : 82;
    if (!state.particles || state.particles.length !== count) state.particles = Array.from({ length: count }, (_, index) => ({ x: seeded(index) * width, y: seeded(index + 91) * height, vx: 0, vy: 0, band: index % 6 }));
    clear(ctx, width, height, palette, 0.92);
    const step = Math.min(2, Math.max(0.2, delta / 16.67));
    state.particles.forEach((particle, index) => {
      const bandEnergy = energy(frame, particle.band);
      const angle = seeded(index + Math.floor(frame.timestamp / 480)) * TAU + frame.timestamp * 0.00008 * (particle.band + 1);
      particle.vx = particle.vx * 0.93 + Math.cos(angle) * (0.035 + bandEnergy * 0.16) * step;
      particle.vy = particle.vy * 0.93 + Math.sin(angle) * (0.035 + bandEnergy * 0.16) * step;
      particle.x = (particle.x + particle.vx + width) % width; particle.y = (particle.y + particle.vy + height) % height;
      ctx.fillStyle = rgba(particle.band > 3 ? palette.highlight : particle.band > 1 ? palette.primary : palette.secondary, 0.2 + bandEnergy * 0.72);
      ctx.beginPath(); ctx.arc(particle.x, particle.y, 0.8 + bandEnergy * 2.8, 0, TAU); ctx.fill();
    });
  }

  function constellation({ ctx, width, height, frame, palette, quality }) {
    clear(ctx, width, height, palette, 0.95);
    const count = quality === 'conserve' ? 14 : 24;
    const nodes = Array.from({ length: count }, (_, index) => {
      const band = index % 6; const value = energy(frame, band);
      return { x: (seeded(index) * 0.82 + 0.09) * width + Math.sin(frame.timestamp * 0.00022 + index) * value * 9, y: (seeded(index + 47) * 0.76 + 0.12) * height + Math.cos(frame.timestamp * 0.00018 + index * 0.7) * value * 7, value };
    });
    line(ctx, palette.secondary, 0.8, 0.18 + frame.rms * 0.2);
    for (let index = 0; index < nodes.length; index += 1) for (let other = index + 1; other < nodes.length; other += 1) {
      const a = nodes[index]; const b = nodes[other]; const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (distance < Math.min(width, height) * (0.25 + frame.bands.air * 0.1)) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    }
    nodes.forEach((node, index) => { ctx.fillStyle = rgba(index % 5 ? palette.primary : palette.highlight, 0.45 + node.value * 0.5); ctx.beginPath(); ctx.arc(node.x, node.y, 1.2 + node.value * 3.2 + frame.beat * 1.5, 0, TAU); ctx.fill(); });
  }

  function kineticTiles({ ctx, width, height, frame, palette, quality }) {
    clear(ctx, width, height, palette, 0.96);
    const columns = quality === 'conserve' ? 10 : 16; const rows = quality === 'conserve' ? 5 : 8;
    const gap = Math.max(2, Math.min(width / columns, height / rows) * 0.1);
    for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
      const value = sample(frame.spectrum, Math.pow(column / Math.max(1, columns - 1), 1.6));
      const wave = 0.5 + 0.5 * Math.sin(frame.timestamp * 0.002 + row * 0.75 + column * 0.24);
      const active = value > (rows - row - 1) / rows * 0.9;
      const x = column * width / columns + gap / 2; const y = row * height / rows + gap / 2;
      const cellWidth = width / columns - gap; const cellHeight = height / rows - gap;
      ctx.fillStyle = rgba(active ? (column % 4 ? palette.primary : palette.highlight) : palette.muted, active ? 0.42 + wave * 0.42 : 0.09 + value * 0.12);
      const inset = active ? (1 - wave) * Math.min(cellWidth, cellHeight) * 0.12 : 0;
      ctx.fillRect(x + inset, y + inset, cellWidth - inset * 2, cellHeight - inset * 2);
    }
  }

  function seismograph({ ctx, width, height, frame, palette, state, quality }) {
    const points = quality === 'conserve' ? 70 : 150;
    const history = pushHistory(state, 'trace', { value: (frame.waveform[Math.floor(frame.waveform.length * 0.31)] * 2 - 1) * (0.35 + frame.rms), beat: frame.beat }, points);
    clear(ctx, width, height, palette, 0.96);
    line(ctx, palette.muted, 1, 0.12);
    for (let y = height * 0.2; y < height; y += height * 0.2) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
    line(ctx, palette.primary, 1.6, 0.9); ctx.beginPath();
    history.forEach((point, index) => { const x = index / Math.max(1, points - 1) * width; const y = height / 2 - point.value * height * 0.31 - point.beat * height * 0.08; if (!index) ctx.moveTo(x, y); else ctx.lineTo(x, y); }); ctx.stroke();
    ctx.fillStyle = rgba(palette.highlight, 0.9); ctx.fillRect(Math.max(0, (history.length - 1) / points * width - 1), height * 0.08, 2, height * 0.84);
  }

  function spectralBloom({ ctx, width, height, frame, palette, quality }) {
    clear(ctx, width, height, palette, 0.92);
    const cx = width / 2; const cy = height / 2; const petals = quality === 'conserve' ? 18 : 36;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(frame.timestamp * 0.000035);
    for (let index = petals - 1; index >= 0; index -= 1) {
      const value = sample(frame.spectrum, Math.pow(index / petals, 1.3)); const angle = index / petals * TAU;
      const radius = Math.min(width, height) * (0.09 + value * 0.25);
      ctx.save(); ctx.rotate(angle); ctx.fillStyle = rgba(index % 3 ? palette.primary : palette.secondary, 0.08 + value * 0.36);
      ctx.beginPath(); ctx.ellipse(radius * 0.78, 0, radius, Math.max(2, radius * (0.12 + frame.bands.air * 0.13)), 0, 0, TAU); ctx.fill(); ctx.restore();
    }
    ctx.fillStyle = rgba(palette.highlight, 0.58 + frame.beat * 0.3); ctx.beginPath(); ctx.arc(0, 0, Math.min(width, height) * (0.035 + frame.rms * 0.025), 0, TAU); ctx.fill(); ctx.restore();
  }

  function grooveDisc({ ctx, width, height, frame, palette, quality }) {
    clear(ctx, width, height, palette, 0.95);
    const cx = width / 2; const cy = height / 2; const rings = quality === 'conserve' ? 18 : 34; const maximum = Math.min(width, height) * 0.44;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(frame.timestamp * 0.00008);
    for (let ring = 1; ring <= rings; ring += 1) {
      const base = maximum * ring / rings; const value = sample(frame.spectrum, Math.pow(ring / rings, 1.5));
      line(ctx, ring % 6 ? palette.muted : palette.primary, ring % 6 ? 0.75 : 1.4, ring % 6 ? 0.18 + value * 0.2 : 0.35 + value * 0.45);
      ctx.beginPath();
      const segments = quality === 'conserve' ? 42 : 76;
      for (let index = 0; index <= segments; index += 1) {
        const angle = index / segments * TAU; const radius = base + Math.sin(angle * (2 + ring % 5) + frame.timestamp * 0.001) * value * maximum * 0.018;
        const x = Math.cos(angle) * radius; const y = Math.sin(angle) * radius;
        if (!index) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.stroke();
    }
    ctx.fillStyle = rgba(palette.highlight, 0.8); ctx.beginPath(); ctx.arc(0, 0, maximum * 0.055, 0, TAU); ctx.fill(); ctx.restore();
  }

  function meterBridge({ ctx, width, height, frame, palette, state }) {
    clear(ctx, width, height, palette, 0.96);
    const meters = [frame.bands.sub, frame.bands.bass, frame.bands.lowMid, frame.bands.mid, frame.bands.highMid, frame.bands.air];
    state.needles = state.needles || meters.slice();
    meters.forEach((value, index) => {
      state.needles[index] += (value - state.needles[index]) * (value > state.needles[index] ? 0.28 : 0.09);
      const cellWidth = width / meters.length; const cx = cellWidth * (index + 0.5); const cy = height * 0.78; const radius = Math.min(cellWidth * 0.38, height * 0.48);
      line(ctx, palette.muted, 1, 0.34); ctx.beginPath(); ctx.arc(cx, cy, radius, Math.PI * 1.14, Math.PI * 1.86); ctx.stroke();
      for (let tick = 0; tick <= 6; tick += 1) {
        const angle = Math.PI * (1.14 + tick / 6 * 0.72); const inner = radius * 0.82;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner); ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius); ctx.stroke();
      }
      const angle = Math.PI * (1.14 + clamp(state.needles[index]) * 0.72); line(ctx, value > 0.82 ? palette.highlight : palette.primary, 1.8, 0.92); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(angle) * radius * 0.88, cy + Math.sin(angle) * radius * 0.88); ctx.stroke();
      ctx.fillStyle = rgba(palette.primary, 0.9); ctx.beginPath(); ctx.arc(cx, cy, 2.2, 0, TAU); ctx.fill();
    });
  }

  function harmonicPendulums({ ctx, width, height, frame, palette, state, delta, quality }) {
    clear(ctx, width, height, palette, 0.96);
    const count = quality === 'conserve' ? 7 : 11;
    if (!state.pendulums || state.pendulums.length !== count) state.pendulums = Array.from({ length: count }, () => ({ angle: 0, velocity: 0 }));
    const step = Math.min(1.8, Math.max(0, delta / 16.67));
    const railY = height * 0.12;
    line(ctx, palette.muted, 1.2, 0.38); ctx.beginPath(); ctx.moveTo(width * 0.055, railY); ctx.lineTo(width * 0.945, railY); ctx.stroke();
    state.pendulums.forEach((pendulum, index) => {
      const position = index / Math.max(1, count - 1);
      const value = sample(frame.spectrum, Math.pow(position, 1.55));
      const anchorX = width * (0.08 + position * 0.84);
      const length = height * (0.32 + position * 0.42);
      const target = Math.sin(frame.timestamp * (0.00072 + position * 0.00048) + index * 0.68) * value * 0.46 + frame.balance * 0.08;
      pendulum.velocity = (pendulum.velocity + (target - pendulum.angle) * 0.045 * step + frame.beat * (index % 2 ? -1 : 1) * 0.012 * step) * Math.pow(0.91, step);
      pendulum.angle += pendulum.velocity * step;
      const bobX = anchorX + Math.sin(pendulum.angle) * length;
      const bobY = railY + Math.cos(pendulum.angle) * length;
      line(ctx, index % 3 ? palette.secondary : palette.primary, 0.8 + value * 1.2, 0.24 + value * 0.5);
      ctx.beginPath(); ctx.moveTo(anchorX, railY); ctx.lineTo(bobX, bobY); ctx.stroke();
      ctx.fillStyle = rgba(index % 4 ? palette.primary : palette.highlight, 0.46 + value * 0.48);
      ctx.beginPath(); ctx.arc(bobX, bobY, 2.2 + value * 5.2, 0, TAU); ctx.fill();
      ctx.fillStyle = rgba(palette.muted, 0.6); ctx.fillRect(anchorX - 1.5, railY - 2, 3, 4);
    });
  }

  function spectralLoom({ ctx, width, height, frame, palette, quality }) {
    clear(ctx, width, height, palette, 0.97);
    const warpCount = quality === 'conserve' ? 12 : 22;
    const weftCount = quality === 'conserve' ? 8 : 15;
    const segments = quality === 'conserve' ? 18 : 34;
    for (let column = 0; column < warpCount; column += 1) {
      const position = column / Math.max(1, warpCount - 1);
      const value = sample(frame.spectrum, Math.pow(position, 1.5));
      line(ctx, column % 4 ? palette.secondary : palette.highlight, 0.7 + value * 0.8, 0.12 + value * 0.43);
      ctx.beginPath();
      for (let segment = 0; segment <= segments; segment += 1) {
        const yPosition = segment / segments;
        const wave = sample(frame.waveform, (yPosition + position * 0.18) % 1) * 2 - 1;
        const x = position * width + wave * width * (0.012 + value * 0.026) + Math.sin(frame.timestamp * 0.00045 + segment * 0.42 + column) * value * 2.5;
        const y = yPosition * height;
        if (!segment) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    for (let row = 0; row < weftCount; row += 1) {
      const position = row / Math.max(1, weftCount - 1);
      const bandValue = energy(frame, row);
      line(ctx, row % 3 ? palette.primary : palette.highlight, 0.65 + bandValue, 0.12 + bandValue * 0.48);
      ctx.beginPath();
      for (let segment = 0; segment <= segments; segment += 1) {
        const xPosition = segment / segments;
        const spectrumValue = sample(frame.spectrum, Math.pow(xPosition, 1.45));
        const x = xPosition * width;
        const y = position * height + Math.sin(xPosition * TAU * (2 + row % 4) - frame.timestamp * 0.00065) * spectrumValue * height * 0.035;
        if (!segment) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    const shuttleX = (0.08 + ((frame.timestamp * 0.00008) % 0.84)) * width;
    ctx.fillStyle = rgba(palette.highlight, 0.34 + frame.beat * 0.52); ctx.fillRect(shuttleX, height * 0.08, 1.5, height * 0.84);
  }

  const RENDERERS = Object.freeze([
    { id: 'spectrum-deck', name: 'Spectrum Deck', family: 'frequency', process: 'Log-spaced frequency bars with falling peak caps', complexity: 'low', placements: ['strip', 'panel', 'hero'], render: spectrumDeck },
    { id: 'mirror-scope', name: 'Mirror Scope', family: 'waveform', process: 'Dual reflected time-domain oscilloscope trace', complexity: 'low', placements: ['strip', 'panel'], render: mirrorScope },
    { id: 'radial-crown', name: 'Radial Crown', family: 'frequency', process: 'Circular frequency rays around a quiet center', complexity: 'medium', placements: ['square', 'hero', 'artwork-ring'], render: radialCrown },
    { id: 'waterfall-memory', name: 'Waterfall Memory', family: 'history', process: 'Scrolling spectral heat history', complexity: 'medium', placements: ['panel', 'hero'], render: waterfall },
    { id: 'stereo-phase', name: 'Stereo Phase', family: 'stereo', process: 'Lissajous phase portrait with mono-safe fallback', complexity: 'low', placements: ['square', 'panel'], channels: 'stereo', render: stereoPhase },
    { id: 'ribbon-current', name: 'Ribbon Current', family: 'waveform', process: 'Layered waveform ribbons with depth interference', complexity: 'medium', placements: ['strip', 'hero', 'background'], render: ribbonCurrent },
    { id: 'topographic-field', name: 'Topographic Field', family: 'history', process: 'Frequency-history contours as an audio landscape', complexity: 'medium', placements: ['panel', 'hero', 'background'], render: topographic },
    { id: 'particle-drift', name: 'Particle Drift', family: 'particles', process: 'Band-driven deterministic particle advection', complexity: 'high', placements: ['panel', 'hero', 'background'], render: particleDrift },
    { id: 'signal-constellation', name: 'Signal Constellation', family: 'particles', process: 'Transient-linked nodes and proximity routes', complexity: 'high', placements: ['square', 'panel', 'background'], render: constellation },
    { id: 'kinetic-tiles', name: 'Kinetic Tiles', family: 'geometry', process: 'Frequency-threshold tile matrix with breathing cells', complexity: 'low', placements: ['strip', 'panel', 'mini'], render: kineticTiles },
    { id: 'paper-seismograph', name: 'Paper Seismograph', family: 'history', process: 'Continuous energy trace across a calibrated grid', complexity: 'low', placements: ['strip', 'panel', 'mini'], render: seismograph },
    { id: 'spectral-bloom', name: 'Spectral Bloom', family: 'geometry', process: 'Polar petal field shaped by spectral energy', complexity: 'medium', placements: ['square', 'hero', 'artwork-ring'], render: spectralBloom },
    { id: 'groove-disc', name: 'Groove Disc', family: 'geometry', process: 'Rotating concentric grooves with harmonic deformation', complexity: 'medium', placements: ['square', 'hero', 'artwork-ring'], render: grooveDisc },
    { id: 'meter-bridge', name: 'Meter Bridge', family: 'metering', process: 'Six damped analog needles across frequency regions', complexity: 'low', placements: ['strip', 'panel', 'mini'], render: meterBridge },
    { id: 'harmonic-pendulums', name: 'Harmonic Pendulums', family: 'mechanical', process: 'Band-weighted pendulums with damped transient impulses', complexity: 'medium', placements: ['strip', 'panel', 'hero'], render: harmonicPendulums },
    { id: 'spectral-loom', name: 'Spectral Loom', family: 'weave', process: 'Waveform warp threads interlaced with spectral weft', complexity: 'medium', placements: ['panel', 'hero', 'background'], render: spectralLoom },
  ].map((entry) => Object.freeze({ channels: 'mono', ...entry })));

  const byId = new Map(RENDERERS.map((renderer) => [renderer.id, renderer]));
  function getRenderer(id) { return byId.get(String(id)) || null; }
  function listRenderers() { return RENDERERS.slice(); }

  return Object.freeze({ PROCESS_FAMILIES, getRenderer, listRenderers });
}));
