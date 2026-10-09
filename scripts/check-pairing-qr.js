const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const qrcode = require('qrcode-generator');

const renderer = fs.readFileSync(path.join(__dirname, '../src/renderer.js'), 'utf8');
const start = renderer.indexOf('function pairingQrLink(');
const end = renderer.indexOf('function updateJamPairingUi(', start);
assert(start >= 0 && end > start);
const element = { dataset: {}, removeAttribute() {} };
const context = vm.createContext({
  sharingState: {}, activeJamPairing: (pairing) => pairing,
  window: { qrcode }, $: () => element,
});
vm.runInContext(renderer.slice(start, end), context);
const pairing = { pairingPayload: {
  remoteBaseUrl: 'http://100.72.0.9:4822', baseUrl: 'http://100.72.0.9:4822',
  baseUrls: ['http://192.168.1.45:4822', 'http://127.0.0.1:4822'],
  pairingCode: '042917', secret: 'pairing-secret',
} };
const text = context.pairingQrLink(pairing);
const parameters = new URL(text).searchParams;
assert.equal(parameters.get('u'), pairing.pairingPayload.remoteBaseUrl);
assert.deepEqual(parameters.get('urls').split(','), pairing.pairingPayload.baseUrls);
assert.equal(parameters.get('c'), '042917');
assert.equal(parameters.get('s'), 'pairing-secret');
assert.equal(context.pairingQrLink({ pairingPayload: { ...pairing.pairingPayload, secret: '' } }), '');
assert.equal(context.pairingQrLink({ pairingPayload: {
  baseUrl: 'http://192.168.1.45:4822', pairingCode: '042917', secret: 'pairing-secret',
} }), 'pxd1|http%3A%2F%2F192.168.1.45%3A4822|042917|pairing-secret');
context.renderPairingVisualCode(text);
assert.match(element.innerHTML, /^<svg /);
assert.match(element.innerHTML, /fill="white"/);
assert.match(element.innerHTML, /fill="black"/);
assert(!element.title.includes('pairing-secret'));

// This fixture is decoded by the real Android ZXing implementation in unit tests.
const qr = qrcode(0, 'M');
qr.addData(text);
qr.make();
const modules = qr.getModuleCount();
const scale = 1;
const rows = [];
for (let y = -4; y < modules + 4; y++) {
  let row = '';
  for (let x = -4; x < modules + 4; x++) {
    const dark = x >= 0 && y >= 0 && x < modules && y < modules && qr.isDark(y, x);
    row += (dark ? '1' : '0').repeat(scale);
  }
  for (let i = 0; i < scale; i++) rows.push(row);
}
const fixture = `${text}\n${rows.join('\n')}\n`;
const fixturePath = path.join(__dirname, '../https://github.com/varText-dragen-develiper/pixelody-android/blob/main/app/src/test/resources/pairing-desktop-qr.txt');
if (process.argv.includes('--write-fixture')) {
  fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
  fs.writeFileSync(fixturePath, fixture);
} else {
  assert.equal(fs.readFileSync(fixturePath, 'utf8').replace(/\r\n/g, '\n'), fixture);
}
context.renderPairingVisualCode('');
assert.equal(element.innerHTML, '<span>Create a code</span>');
console.log('Pairing QR payload, monochrome rendering, and Android fixture audit passed.');
