const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const HELPER_EXE = 'Pixelody.Wasapi.Helper.exe';
const SYSTEM_AUDIO_BRIDGE_EXE = 'Pixelody.SystemAudio.Bridge.exe';
const HELPER_TIMEOUT_MS = 1600;
const HELPER_PROTOTYPE_TIMEOUT_MS = 6500;
const HELPER_MAX_BUFFER = 256 * 1024;
const NATIVE_MIXER_PROTOCOL = 'pixelody.multiOutput.nativeMixer.v1';
const NATIVE_MIXER_STATES = new Set(['off', 'not-required', 'bridge-missing', 'blocked-unsigned', 'blocked-incompatible', 'starting', 'ready', 'active', 'degraded', 'member-unavailable', 'duplicate-route-blocked', 'unsupported-format', 'unstable', 'recovering', 'error']);

function fileExists(filePath) {
  try {
    return Boolean(filePath) && fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function helperCandidates(app) {
  const candidates = [];
  if (process.env.PIXELODY_WASAPI_HELPER) candidates.push({ source: 'env', path: process.env.PIXELODY_WASAPI_HELPER });
  if (process.resourcesPath) candidates.push({ source: 'bundled', path: path.join(process.resourcesPath, 'native', HELPER_EXE) });
  candidates.push({ source: 'dev-publish', path: path.join(__dirname, '..', 'native', 'windows-wasapi-helper', 'bin', 'Release', 'net8.0-windows', 'win-x64', 'publish', HELPER_EXE) });
  if (app) candidates.push({ source: 'userData', path: path.join(app.getPath('userData'), 'native', HELPER_EXE) });
  return candidates;
}

function systemAudioBridgeCandidates(app) {
  const candidates = [];
  if (process.env.PIXELODY_SYSTEM_AUDIO_BRIDGE) candidates.push({ source: 'env', path: process.env.PIXELODY_SYSTEM_AUDIO_BRIDGE });
  if (process.resourcesPath) candidates.push({ source: 'bundled', path: path.join(process.resourcesPath, 'native', SYSTEM_AUDIO_BRIDGE_EXE) });
  candidates.push({ source: 'dev-build', path: path.join(__dirname, '..', 'native', 'windows-system-audio-bridge', 'bin', 'Release', 'net8.0-windows', SYSTEM_AUDIO_BRIDGE_EXE) });
  if (app) candidates.push({ source: 'userData', path: path.join(app.getPath('userData'), 'native', SYSTEM_AUDIO_BRIDGE_EXE) });
  return candidates;
}

function resolveHelper(app) {
  if (process.platform !== 'win32') return { supported: false, reason: 'WASAPI diagnostics are Windows-only.' };
  const candidates = helperCandidates(app).map((candidate) => ({
    ...candidate,
    exists: fileExists(candidate.path),
  }));
  const match = candidates.find((candidate) => fileExists(candidate.path));
  return match ? { supported: true, installed: true, ...match, candidates } : { supported: true, installed: false, candidates };
}

function getSystemAudioBridgeStatus(app) {
  if (process.platform !== 'win32') return { supported: false, installed: false, status: 'Unsupported' };
  const candidates = systemAudioBridgeCandidates(app).map((candidate) => ({ ...candidate, exists: fileExists(candidate.path) }));
  const match = candidates.find((candidate) => candidate.exists);
  return match
    ? { supported: true, installed: true, status: 'Present', source: match.source, path: match.path, candidates }
    : { supported: true, installed: false, status: 'Missing', expectedPath: candidates.find((candidate) => candidate.source === 'dev-build')?.path || '', candidates };
}

function execFileJson(filePath, args, options = {}) {
  return new Promise((resolve) => {
    execFile(filePath, args, {
      windowsHide: true,
      timeout: options.timeout || HELPER_TIMEOUT_MS,
      maxBuffer: options.maxBuffer || HELPER_MAX_BUFFER,
    }, (error, stdout, stderr) => {
      if (error) {
        resolve({ ok: false, error: error.killed ? 'Helper timed out.' : error.message, stderr: String(stderr || '').trim().slice(0, 1200) });
        return;
      }
      try {
        resolve({ ok: true, data: JSON.parse(String(stdout || '{}')) });
      } catch (parseError) {
        resolve({ ok: false, error: `Helper returned invalid JSON: ${parseError.message}`, stderr: String(stderr || '').trim().slice(0, 1200) });
      }
    });
  });
}

function powershellLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function signatureStatus(filePath) {
  if (process.platform !== 'win32') return { status: 'Unsupported', signed: false };
  const command = `$sig=Get-AuthenticodeSignature -LiteralPath ${powershellLiteral(filePath)}; [pscustomobject]@{ status=$sig.Status.ToString(); signer=($sig.SignerCertificate.Subject -as [string]); thumbprint=($sig.SignerCertificate.Thumbprint -as [string]) } | ConvertTo-Json -Compress`;
  const result = await execFileJson('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], { timeout: 1200, maxBuffer: 64 * 1024 });
  if (!result.ok) return { status: 'Unknown', signed: false, error: result.error };
  return {
    status: result.data.status || 'Unknown',
    signed: result.data.status === 'Valid',
    signer: result.data.signer || '',
    thumbprint: result.data.thumbprint || '',
  };
}

function devUnsignedHelperAllowed(app) {
  return process.env.PIXELODY_ALLOW_UNSIGNED_WASAPI_DEV === '1' && app && !app.isPackaged;
}

function devLocalProbeAllowed(app, resolved) {
  return app && !app.isPackaged && resolved.source === 'dev-publish';
}

function devUnsignedNativeMixerAllowed(app) {
  return process.env.PIXELODY_ALLOW_UNSIGNED_NATIVE_MIXER_DEV === '1' && app && !app.isPackaged;
}

function nativeMixerClaim(state, reason) {
  const allowedLanguage = state === 'bridge-missing'
    ? ['unavailable', 'planned']
    : state === 'blocked-unsigned'
      ? ['blocked', 'development-only']
      : ['prototype', 'development-only'];
  return { releaseReady: false, reason, allowedLanguage };
}

function sanitizeNativeMixerText(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  return text
    .replace(/(?:file:\/\/\/[^\s"']+|[A-Za-z]:[\\/][^\s"']+|\\\\[^\s"']+)/g, '[local-path-hidden]')
    .slice(0, 600);
}

function nativeMixerSnapshot({ state, reason, component = {}, routeProof = {}, runtimeClock = null, warnings = [], lastError = null }) {
  const normalizedState = NATIVE_MIXER_STATES.has(state) ? state : 'error';
  return {
    protocol: NATIVE_MIXER_PROTOCOL,
    state: normalizedState,
    claim: nativeMixerClaim(normalizedState, sanitizeNativeMixerText(reason)),
    component: {
      supported: component.supported === true,
      installed: component.installed === true,
      available: component.available === true,
      trusted: component.trusted === true,
      compatible: component.compatible === true,
      implementation: component.implementation || 'missing',
      version: component.version || '',
      signer: component.signer || '',
      source: component.source || '',
    },
    routeProof: {
      heartbeatCurrent: routeProof.heartbeatCurrent === true,
      configuredRigId: routeProof.configuredRigId || '',
      activeMemberCount: Math.max(0, Math.round(Number(routeProof.activeMemberCount) || 0)),
      allEndpointsOpen: routeProof.allEndpointsOpen === true,
      commandSequenceAck: Math.max(0, Math.round(Number(routeProof.commandSequenceAck) || 0)),
      diagnosticsPathHidden: true,
      primaryRecoveryAvailable: true,
    },
    runtimeClock: runtimeClock || {
      state: 'not-observed',
      transient: true,
      calibrationSeparate: true,
      observedAt: '',
      leader: null,
      follower: null,
      correction: null,
    },
    members: [],
    warnings: Array.isArray(warnings) ? warnings.map((warning) => sanitizeNativeMixerText(warning)).filter(Boolean).slice(0, 8) : [],
    lastError: lastError ? sanitizeNativeMixerText(lastError) : null,
    privacy: {
      pathHidden: true,
      sanitizer: 'pixelody-native-mixer-v1',
    },
  };
}

function clockLabSnapshot(payload = {}) {
  const lab = payload?.lab && typeof payload.lab === 'object' ? payload.lab : {};
  const leader = lab.leaderClock && typeof lab.leaderClock === 'object' ? lab.leaderClock : null;
  const follower = lab.followerClock && typeof lab.followerClock === 'object' ? lab.followerClock : null;
  const correction = lab.followerCorrection && typeof lab.followerCorrection === 'object' ? lab.followerCorrection : null;
  return {
    state: correction?.state || 'not-observed',
    transient: true,
    calibrationSeparate: true,
    observedAt: new Date().toISOString(),
    leader: leader ? {
      sampleCount: Math.max(0, Math.round(Number(leader.sampleCount) || 0)),
      nominalFramesPerSecond: Number(leader.nominalFramesPerSecond) || null,
      observedFramesPerSecond: Number(leader.observedFramesPerSecond) || null,
      driftPpm: Number(leader.driftPpm) || 0,
    } : null,
    follower: follower ? {
      sampleCount: Math.max(0, Math.round(Number(follower.sampleCount) || 0)),
      nominalFramesPerSecond: Number(follower.nominalFramesPerSecond) || null,
      observedFramesPerSecond: Number(follower.observedFramesPerSecond) || null,
      driftPpm: Number(follower.driftPpm) || 0,
    } : null,
    correction: correction ? {
      state: correction.state || 'not-observed',
      correctionPpm: Number(correction.correctionPpm) || 0,
      requestedPpm: Number(correction.requestedPpm) || 0,
      ratio: Number(correction.ratio) || 1,
      bufferErrorFrames: Math.round(Number(correction.bufferErrorFrames) || 0),
      clamped: correction.clamped === true,
    } : null,
  };
}

async function getNativeMixerStatus(app) {
  const resolved = getSystemAudioBridgeStatus(app);
  if (!resolved.supported) {
    return nativeMixerSnapshot({
      state: 'bridge-missing',
      reason: 'Native grouped playback is Windows-only; normal primary playback remains available.',
      component: { supported: false },
    });
  }
  if (!resolved.installed) {
    return nativeMixerSnapshot({
      state: 'bridge-missing',
      reason: 'The optional native mixer bridge is not installed. Browser fan-out remains separate and experimental.',
      component: { supported: true, installed: false, source: 'not-found' },
    });
  }

  const signature = await signatureStatus(resolved.path);
  const devUnsigned = devUnsignedNativeMixerAllowed(app);
  const trusted = signature.signed || devUnsigned;
  if (!trusted) {
    return nativeMixerSnapshot({
      state: 'blocked-unsigned',
      reason: 'The native mixer bridge is present but is not trusted by the current policy.',
      component: { supported: true, installed: true, trusted: false, source: resolved.source, signer: signature.signer || '' },
      warnings: ['Unsigned native mixer components are blocked outside an explicit unpackaged development override.'],
    });
  }

  const result = await execFileJson(resolved.path, ['--json', '--command', 'status']);
  if (!result.ok) {
    return nativeMixerSnapshot({
      state: 'error',
      reason: 'The native mixer bridge could not return a status snapshot.',
      component: { supported: true, installed: true, available: true, trusted: true, source: resolved.source, signer: signature.signer || '' },
      lastError: result.error || 'Bridge status command failed.',
    });
  }
  const bridge = result.data?.bridge && typeof result.data.bridge === 'object' ? result.data.bridge : {};
  const protocolMatches = Number(result.data?.contract) === 1;
  if (!protocolMatches) {
    return nativeMixerSnapshot({
      state: 'blocked-incompatible',
      reason: 'The native mixer bridge returned an incompatible protocol response.',
      component: { supported: true, installed: true, available: true, trusted: true, compatible: false, source: resolved.source, signer: signature.signer || '' },
    });
  }
  const implementation = bridge.audioEngineImplemented === true ? 'renderer-present' : 'bounded-labs-only';
  return nativeMixerSnapshot({
    state: bridge.audioEngineImplemented === true ? 'ready' : 'not-required',
    reason: bridge.audioEngineImplemented === true
      ? 'The native mixer bridge responded, but no grouped native route has been configured.'
      : 'The installed bridge currently exposes bounded development labs only; it cannot render grouped Pixelody playback.',
    component: {
      supported: true,
      installed: true,
      available: true,
      trusted: true,
      compatible: true,
      implementation,
      version: String(bridge.version || ''),
      signer: signature.signer || '',
      source: resolved.source,
    },
    warnings: bridge.audioEngineImplemented === true ? [] : ['Endpoint-clock observations are development-only and remain separate from saved acoustic alignment.'],
  });
}

async function runNativeMixerClockDisciplineLab(app, request = {}) {
  const initial = await getNativeMixerStatus(app);
  if (!devUnsignedNativeMixerAllowed(app)) {
    return {
      ok: false,
      status: nativeMixerSnapshot({
        state: initial.state === 'bridge-missing' ? 'bridge-missing' : 'blocked-unsigned',
        reason: 'Endpoint-clock monitoring is available only with the explicit unpackaged native-mixer development override.',
        component: initial.component,
        warnings: ['Set PIXELODY_ALLOW_UNSIGNED_NATIVE_MIXER_DEV=1 only for an unpackaged development run.'],
      }),
    };
  }
  const leaderEndpointId = String(request.leaderEndpointId || '').trim();
  const followerEndpointId = String(request.followerEndpointId || '').trim();
  if (!leaderEndpointId || !followerEndpointId || leaderEndpointId === followerEndpointId) {
    return { ok: false, status: nativeMixerSnapshot({ state: 'duplicate-route-blocked', reason: 'Clock monitoring requires two distinct explicit endpoint IDs.', component: initial.component }) };
  }
  const resolved = getSystemAudioBridgeStatus(app);
  if (!resolved.installed) return { ok: false, status: initial };
  const durationMs = Math.max(250, Math.min(3000, Number(request.durationMs) || 1000));
  const result = await execFileJson(resolved.path, ['--json', '--command', 'clock-discipline-lab', '--dev-allow-clock-discipline', '--leader-endpoint-id', leaderEndpointId, '--follower-endpoint-id', followerEndpointId, '--duration-ms', String(durationMs)], { timeout: Math.max(HELPER_PROTOTYPE_TIMEOUT_MS, durationMs + 2500) });
  if (!result.ok) {
    return { ok: false, status: nativeMixerSnapshot({ state: 'error', reason: 'The endpoint-clock monitoring lab failed.', component: initial.component, lastError: result.error || 'Clock monitoring command failed.' }) };
  }
  const bridgeState = result.data?.status?.state === 'degraded' ? 'degraded' : result.data?.status?.state === 'bypass-suspected' ? 'unstable' : 'error';
  return {
    ok: result.data?.ok === true,
    status: nativeMixerSnapshot({
      state: bridgeState,
      reason: result.data?.status?.reason || 'Endpoint-clock monitoring completed.',
      component: initial.component,
      runtimeClock: clockLabSnapshot(result.data),
      warnings: ['This is a bounded silent development observation, not native grouped program playback.'],
      lastError: result.data?.status?.accepted === false ? result.data?.status?.reason || 'Clock monitoring was blocked.' : null,
    }),
  };
}

function policyPayload(extra = {}) {
  return {
    required: false,
    policy: 'Optional only: signed helper executable by default, no driver, no service, no registry edits, no exclusive-mode playback changes. Unsigned helpers require PIXELODY_ALLOW_UNSIGNED_WASAPI_DEV=1 in an unpackaged dev run.',
    ...extra,
  };
}

async function getWasapiHelperStatus(app) {
  const resolved = resolveHelper(app);
  const bridge = getSystemAudioBridgeStatus(app);
  if (!resolved.supported) {
    return policyPayload({ supported: false, installed: false, available: false, status: 'Unsupported', reason: resolved.reason, bridge });
  }
  if (!resolved.installed) {
    return policyPayload({
      supported: true,
      installed: false,
      available: false,
      status: 'Not installed',
      reason: 'No WASAPI helper executable was found. Browser-safe diagnostics remain active.',
      expectedPath: resolved.candidates.find((candidate) => candidate.source === 'dev-publish')?.path || '',
      candidates: resolved.candidates,
      bridge,
    });
  }
  const signature = await signatureStatus(resolved.path);
  const devUnsigned = devUnsignedHelperAllowed(app);
  const devLocalProbe = devLocalProbeAllowed(app, resolved);
  const available = signature.signed || devUnsigned || devLocalProbe;
  return policyPayload({
    supported: true,
    installed: true,
    available,
    status: signature.signed ? 'Available' : devUnsigned ? 'Dev unsigned helper allowed' : devLocalProbe ? 'Dev diagnostics helper allowed' : 'Blocked',
    reason: signature.signed
      ? 'Signed WASAPI helper is available for on-demand diagnostics.'
      : devUnsigned
        ? 'Unsigned WASAPI helper is available only because the local dev override is set.'
        : devLocalProbe
          ? 'Local dev-publish WASAPI helper is available for diagnostics and route probing. Dev capture still requires PIXELODY_ALLOW_UNSIGNED_WASAPI_DEV=1.'
          : 'Helper exists but is not signed with a valid Authenticode signature.',
    source: resolved.source,
    path: resolved.path,
    candidates: resolved.candidates,
    signature,
    devUnsigned,
    devLocalProbe,
    bridge,
  });
}

async function runHelperCommand(app, request = {}, commandArgs = [], options = {}) {
  const status = await getWasapiHelperStatus(app);
  if (!status.available) return { ok: false, status, diagnostics: null };
  const resolved = resolveHelper(app);
  const args = ['--json', ...commandArgs];
  const bridge = getSystemAudioBridgeStatus(app);
  args.push('--bridge-present', bridge.installed ? '1' : '0');
  if (bridge.source) args.push('--bridge-source', String(bridge.source).slice(0, 80));
  if (request.outputLabel) args.push('--output-label', String(request.outputLabel).slice(0, 240));
  if (request.sinkId) args.push('--sink-id', String(request.sinkId).slice(0, 240));
  if (request.eqProfile && typeof request.eqProfile === 'object') {
    args.push('--eq-json', Buffer.from(JSON.stringify(request.eqProfile), 'utf8').toString('base64'));
  }
  const result = await execFileJson(resolved.path, args, options);
  if (!result.ok) return { ok: false, status: { ...status, status: 'Failed', reason: result.error }, data: null };
  const payloadOk = result.data?.ok !== false;
  return {
    ok: payloadOk,
    status: payloadOk ? status : { ...status, status: 'Failed', reason: result.data?.error || 'Helper reported failure.' },
    data: result.data,
  };
}

async function runWasapiDiagnostics(app, request = {}) {
  const result = await runHelperCommand(app, request, ['--diagnose']);
  return { ok: result.ok, status: result.status, diagnostics: result.data || null };
}

async function runWasapiCapabilityProbe(app, request = {}) {
  const result = await runHelperCommand(app, request, ['--probe']);
  return { ok: result.ok, status: result.status, probe: result.data || null };
}

async function runWasapiLoopbackPrototype(app, request = {}) {
  if (!devUnsignedHelperAllowed(app)) {
    return {
      ok: false,
      status: await getWasapiHelperStatus(app),
      prototype: null,
      error: 'Loopback prototype is dev-only. Set PIXELODY_ALLOW_UNSIGNED_WASAPI_DEV=1 in an unpackaged run.',
    };
  }
  const durationMs = Math.max(250, Math.min(3000, Number(request.durationMs) || 1000));
  const result = await runHelperCommand(app, request, ['--loopback-prototype', '--dev-allow-loopback-prototype', '--duration-ms', String(durationMs)], {
    timeout: Math.max(HELPER_PROTOTYPE_TIMEOUT_MS, durationMs + 2500),
    maxBuffer: HELPER_MAX_BUFFER,
  });
  return { ok: result.ok, status: result.status, prototype: result.data || null };
}

module.exports = {
  getWasapiHelperStatus,
  getSystemAudioBridgeStatus,
  getNativeMixerStatus,
  runWasapiDiagnostics,
  runWasapiCapabilityProbe,
  runWasapiLoopbackPrototype,
  runNativeMixerClockDisciplineLab,
};
