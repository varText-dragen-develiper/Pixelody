'use strict';
const MAX_BYTES = 8192;
// The one place the shop host is named. Android keeps a mirror in ModulePackage.kt;
// scripts/check-module-shop.js fails if the two drift apart.
const SHOP_ORIGIN = 'https://pixelody-web.pixelody101.workers.dev';
const SHOP_ENTRY = SHOP_ORIGIN + '/shop?embedded=1';
const EDITION_KEYS = Object.freeze(['cosmic-cinema', 'neon-burst']);
function allowedShopUrl(value) { try { const u = new URL(value); return u.origin === SHOP_ORIGIN && !u.username && !u.password; } catch { return false; } }
function parsePackage(bytes, platform) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_BYTES) throw new Error('Module package must be between 1 and 8192 bytes.');
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (value?.kind === 'theme-edition') {
    const keys = ['format', 'id', 'version', 'kind', 'platforms', 'name', 'description', 'recipe'];
    if (Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !(key in value))) throw new Error('Unsupported theme edition fields.');
    if (value.format !== 1 || value.version !== '1.0.0' || !EDITION_KEYS.includes(value.recipe) || value.id !== `pixelody.${value.recipe}`) throw new Error('Unsupported shipped theme edition.');
    if (platform !== 'desktop' || !Array.isArray(value.platforms) || value.platforms.length !== 1 || value.platforms[0] !== 'desktop') throw new Error('Theme editions currently require the Windows development build.');
    for (const [key, max] of [['name', 60], ['description', 300]]) {
      if (typeof value[key] !== 'string' || !value[key].trim() || value[key].length > max || /[\u0000-\u001f\u007f]/.test(value[key])) throw new Error('Invalid theme edition text.');
    }
    return value;
  }
  const isShop = value?.kind === 'web-shop';
  const keys = ['format', 'id', 'version', 'kind', 'platforms', 'name', 'description', isShop ? 'entry' : 'prompt'];
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !(key in value))) throw new Error('Unsupported module fields.');
  if (value.format !== 1 || (isShop ? value.id !== 'pixelody.revenuecat-shop' || value.entry !== SHOP_ENTRY : value.id !== 'pixelody.listening-notes' || value.kind !== 'listening-notes') || value.version !== '1.0.0') throw new Error('This module needs a different Pixelody host.');
  if (!Array.isArray(value.platforms) || value.platforms.length !== 2 || !value.platforms.includes('desktop') || !value.platforms.includes('android') || !value.platforms.includes(platform)) throw new Error('Incompatible platform.');
  for (const [key, max] of [['name', 60], ['description', 300], ...(isShop ? [] : [['prompt', 200]])]) {
    if (typeof value[key] !== 'string' || !value[key].trim() || value[key].length > max || /[\u0000-\u001f\u007f]/.test(value[key])) throw new Error('Invalid module text.');
  }
  return value;
}
function validRequest(request) {
  if (!request || Array.isArray(request) || typeof request !== 'object') return false;
  if (['apply-edition', 'remove-edition'].includes(request.op)) return Object.keys(request).length === 2 && EDITION_KEYS.includes(request.recipe);
  if (['state', 'import', 'remove', 'remove-shop', 'open-shop'].includes(request.op)) return Object.keys(request).length === 1;
  return request.op === 'save' && Object.keys(request).length === 2 && typeof request.text === 'string' && request.text.length <= 20000;
}
module.exports = { MAX_BYTES, SHOP_ORIGIN, SHOP_ENTRY, EDITION_KEYS, allowedShopUrl, parsePackage, validRequest };
