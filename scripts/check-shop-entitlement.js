const assert = require('node:assert/strict');
const { loadConfig, hasEntitlement } = require('../tools/shop-entitlement/entitlement');
const ex = require('../tools/shop-entitlement/config.example.json');
(async () => {
  const resp = (status, body) => async () => ({ ok: status < 300, status, json: async () => body });
  const on = loadConfig({ enabled: true, publicSdkKeys: { web: 'test_placeholder' }, entitlements: { 'm.a': 'module_a' } });
  const q = { appUserId: 'u1', moduleId: 'm.a', now: Date.parse('2026-01-01') };
  assert.equal((await hasEntitlement(loadConfig(ex), { ...q, fetchImpl: () => { throw new Error('must not fetch'); } })).reason, 'disabled');
  assert.equal((await hasEntitlement(on, { ...q, fetchImpl: resp(200, { subscriber: { entitlements: { module_a: { expires_date: null } } } }) })).active, true);
  assert.equal((await hasEntitlement(on, { ...q, fetchImpl: resp(200, { subscriber: { entitlements: { module_a: { expires_date: '2025-01-01T00:00:00Z' } } } }) })).active, false);
  assert.equal((await hasEntitlement(on, { ...q, fetchImpl: resp(200, { subscriber: { entitlements: {} } }) })).reason, 'not-purchased');
  assert.equal((await hasEntitlement(on, { ...q, fetchImpl: resp(401, {}) })).ok, false);
  assert.equal((await hasEntitlement(on, { ...q, fetchImpl: async () => { throw new Error('x'); } })).reason, 'network');
  assert.equal((await hasEntitlement(on, { ...q, moduleId: 'nope' })).reason, 'unknown-module');
  assert.equal((await hasEntitlement(on, { ...q, platform: 'android' })).reason, 'no-key');
  assert.throws(() => loadConfig({ publicSdkKeys: { web: 'sk_live_x' } }));
  assert.equal(Object.values(ex.publicSdkKeys).every(v => v === ''), true);
  console.log('PASS shop entitlement check: disabled by default, lifetime/expired/missing, errors, secret-key rejection');
})();
