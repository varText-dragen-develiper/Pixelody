'use strict';
const MAX_BYTES = 8192;
// The one place the shop host is named. Android keeps a mirror in ModulePackage.kt;
// scripts/check-module-shop.js fails if the two drift apart.
const SHOP_ORIGIN = 'https://pixelody-web.pixelody101.workers.dev';
const SHOP_ENTRY = SHOP_ORIGIN + '/shop?embedded=1';
function allowedShopUrl(value) { try { const u = new URL(value); return u.origin === SHOP_ORIGIN && !u.username && !u.password; } catch { return false; } }
function parsePackage(bytes, platform) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_BYTES) throw new Error('Module package must be between 1 and 8192 bytes.');
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
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
  if (['state', 'import', 'remove', 'remove-shop', 'open-shop'].includes(request.op)) return Object.keys(request).length === 1;
  return request.op === 'save' && Object.keys(request).length === 2 && typeof request.text === 'string' && request.text.length <= 20000;
}
module.exports = { MAX_BYTES, SHOP_ORIGIN, SHOP_ENTRY, allowedShopUrl, parsePackage, validRequest };
