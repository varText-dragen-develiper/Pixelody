'use strict';
const $ = id => document.getElementById(id);
let saved = ''; let dirty = false;
async function request(op, extra = {}) {
  document.getElementById('note').readOnly = true;
  for (const button of document.querySelectorAll('button')) button.disabled = true;
  try {
    const result = await window.moduleShop.request({ op, ...extra });
    if (!result.ok) throw new Error(result.error || 'Operation failed.');
    if (result.canceled) { $('status').textContent = 'Import canceled.'; return; }
    const state = result.state;
    $('notebook').hidden = !state.installed;
    $('webshop').hidden = !state.shop;
    if (state.shop) { $('shop-name').textContent = state.shop.name; $('shop-description').textContent = state.shop.description; }

    $('note').value = state.text; saved = state.text; dirty = false;
    if (state.installed) $('prompt').textContent = state.installed.prompt;
    $('count').textContent = `${state.text.length} / 20,000`;
    $('status').textContent = op === 'save' ? 'Saved on this device.' : op === 'remove' ? 'Module removed. Your notes are kept on this device.' : state.shop ? 'Shop module installed. Choose Open shop above.' : state.installed ? 'Listening Notes is installed and ready.' : 'Import a downloaded module to get started.';
  } catch(error) { $('status').textContent = error.message; }
  finally { document.getElementById('note').readOnly = false; for (const button of document.querySelectorAll('button')) button.disabled = false; }
}
$('open-shop').onclick = () => { if (!dirty || confirm('Discard unsaved note edits?')) request('open-shop'); };
$('remove-shop').onclick = () => { if (!dirty || confirm('Discard unsaved note edits?')) request('remove-shop'); };
$('import').onclick = () => { if (!dirty || confirm('Discard unsaved edits before importing?')) request('import'); };
$('save').onclick = () => request('save', { text: $('note').value });
$('remove').onclick = () => { if (!dirty || confirm('Discard unsaved edits? Previously saved notes will be kept.')) request('remove'); };
$('note').oninput = () => { dirty = $('note').value !== saved; $('count').textContent = `${$('note').value.length} / 20,000`; $('status').textContent = dirty ? 'Unsaved changes — choose Save note.' : 'Saved on this device.'; };
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
request('state');
