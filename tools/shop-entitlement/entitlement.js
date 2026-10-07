'use strict';
// Reference entitlement check for the Pixelody shop website (the worker lives outside this repo).
// Deliberately inert until a config with enabled:true and a public SDK key is supplied.
// The apps never call this: installed modules keep working offline.
const API = 'https://api.revenuecat.com/v1/subscribers/';

function loadConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const keys = c.publicSdkKeys || {};
  for (const [platform, key] of Object.entries(keys)) {
    if (key && /^sk_/.test(key)) throw new Error(`publicSdkKeys.${platform} looks like a secret key; use the public SDK key.`);
  }
  return { enabled: c.enabled === true, keys, entitlements: c.entitlements || {} };
}

// Returns { ok, active, reason }. Never throws for network or config problems: the shop shows "could not load".
async function hasEntitlement(config, { platform = 'web', appUserId, moduleId, fetchImpl = fetch, now = Date.now() }) {
  if (!config.enabled) return { ok: false, active: false, reason: 'disabled' };
  const key = config.keys[platform];
  const entitlementId = config.entitlements[moduleId];
  if (!key) return { ok: false, active: false, reason: 'no-key' };
  if (!entitlementId) return { ok: false, active: false, reason: 'unknown-module' };
  if (typeof appUserId !== 'string' || !appUserId || appUserId.length > 200) return { ok: false, active: false, reason: 'bad-user' };
  try {
    const res = await fetchImpl(API + encodeURIComponent(appUserId), { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } });
    if (!res.ok) return { ok: false, active: false, reason: `http-${res.status}` };
    const e = (await res.json())?.subscriber?.entitlements?.[entitlementId];
    // A null expires_date means a lifetime (non-consumable) purchase.
    const active = !!e && (e.expires_date == null || Date.parse(e.expires_date) > now);
    return { ok: true, active, reason: active ? 'active' : 'not-purchased' };
  } catch { return { ok: false, active: false, reason: 'network' }; }
}
module.exports = { loadConfig, hasEntitlement };
