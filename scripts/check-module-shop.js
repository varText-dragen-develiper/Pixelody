
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parsePackage, validRequest, SHOP_ORIGIN, SHOP_ENTRY, allowedShopUrl } = require('../src/module-shop/contract');
const { ModuleStore, WebModuleStore } = require('../src/module-shop/store');
const bytes = fs.readFileSync(path.join(__dirname, '../src/module-shop/listening-notes.pixelody-module'));
assert.equal(parsePackage(bytes, 'desktop').id, 'pixelody.listening-notes');
assert.throws(() => parsePackage(Buffer.alloc(8193), 'desktop'));
assert.throws(() => parsePackage(Buffer.from([0xc3, 0x28]), 'desktop'));
for (const edit of [v => v.script = 'evil()', v => v.platforms = ['android'], v => v.version = '2.0.0', v => v.id = '../../escape']) { const p=JSON.parse(bytes); edit(p); assert.throws(() => parsePackage(Buffer.from(JSON.stringify(p)), 'desktop')); }
assert.equal(validRequest({op:'save',text:'x'.repeat(20001)}), false);
assert.equal(validRequest({op:'install',path:'arbitrary'}), false);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pixelody-module-test-'));
const store=new ModuleStore(dir);
assert.throws(() => store.save('not installed'));
store.install(bytes); store.save('Remember this listen.');
assert.equal(new ModuleStore(dir).read().text, 'Remember this listen.');
store.remove(); assert.equal(store.read().installed,null); assert.equal(store.read().text,'Remember this listen.');
store.install(bytes); assert.equal(store.read().text,'Remember this listen.');
assert.throws(() => store.install(Buffer.from('{}'))); assert.equal(store.read().text,'Remember this listen.');
fs.writeFileSync(store.file,'damaged');assert.throws(() => store.install(bytes));assert.equal(fs.readFileSync(store.file,'utf8'),'damaged');
console.log('PASS module schema, hostile package rejection, persistence, reinstall, corruption preservation and IPC bounds');

const webBytes = Buffer.from(JSON.stringify({format:1,id:'pixelody.revenuecat-shop',version:'1.0.0',kind:'web-shop',platforms:['desktop','android'],name:'RevenueCat Shop',description:'Optional shop',entry:SHOP_ENTRY}));
assert.equal(parsePackage(webBytes,'desktop').kind,'web-shop');
for (const entry of ['https://evil.example/shop', SHOP_ENTRY + '&bad=1', 'file:///tmp/shop']) { const p=JSON.parse(webBytes); p.entry=entry; assert.throws(()=>parsePackage(Buffer.from(JSON.stringify(p)),'desktop')); }
for (const url of ['https://pixelody-web.pixelody101.workers.dev.evil.example/', 'https://user@pixelody-web.pixelody101.workers.dev/', 'http://pixelody-web.pixelody101.workers.dev/', 'javascript:alert(1)']) assert.equal(allowedShopUrl(url),false);
assert.equal(allowedShopUrl(SHOP_ENTRY),true);
assert.equal(validRequest({op:'install'}),false);
assert.equal(validRequest({op:'open-shop'}),true);
assert.equal(validRequest({op:'open-shop',url:SHOP_ENTRY}),false);
const webDir=fs.mkdtempSync(path.join(os.tmpdir(),'pixelody-web-module-test-'));
const notebook=new ModuleStore(webDir); const web=new WebModuleStore(webDir);
assert.equal(web.read(),null); notebook.install(bytes); notebook.save('Keep me.'); web.install(webBytes);
assert.equal(notebook.read().text,'Keep me.'); assert.equal(web.read().entry,SHOP_ENTRY);
web.remove(); assert.equal(web.read(),null); assert.equal(notebook.read().text,'Keep me.');
web.install(webBytes); notebook.remove(); assert.equal(web.read().entry,SHOP_ENTRY);
console.log('PASS optional web module validation, absent-by-default state and independent notebook persistence');
const { EventEmitter }=require('node:events');
const windows=[];
const session=new EventEmitter();session.setPermissionRequestHandler=fn=>session.permission=fn;session.setPermissionCheckHandler=fn=>session.check=fn;session.clearStorageData=async()=>{};
class Window extends EventEmitter {
 constructor(options) { super();this.options=options;this.webContents=new EventEmitter();this.webContents.session=session;this.webContents.setWindowOpenHandler=fn=>this.popup=fn;windows.push(this); }
 isDestroyed(){return Boolean(this.dead)} setMenu(){} show(){} focus(){} loadFile(){} loadURL(url){this.url=url} destroy(){this.dead=true;this.emit('closed')}
}
const isolated=fs.mkdtempSync(path.join(os.tmpdir(),'pixelody-shop-window-test-'));
const dialogStub={};
const controller=require('../src/module-shop/window').createModuleShop({app:{getPath:()=>isolated},BrowserWindow:Window,dialog:dialogStub});
(async()=>{
 assert.equal((await controller.handle({op:'open-shop'})).ok,false);
 new WebModuleStore(path.join(isolated,'modules')).install(webBytes);
 assert.equal((await controller.handle({op:'open-shop'})).ok,true);
 const remote=windows.at(-1); assert.equal(remote.url,SHOP_ENTRY);assert.equal(remote.options.webPreferences.preload,undefined);assert.equal(remote.options.webPreferences.nodeIntegration,false);assert.equal(remote.options.webPreferences.sandbox,true);assert.equal(remote.options.webPreferences.contextIsolation,true);
 assert.equal(remote.popup().action,'deny');assert.equal(session.check(),false);
 let denied=false;remote.webContents.emit('will-navigate',{preventDefault(){denied=true}},'https://evil.example/');assert.equal(denied,true);
 denied=false;remote.webContents.emit('will-redirect',{preventDefault(){denied=true}},'file:///tmp');assert.equal(denied,true);
 let saveOptions=null;const item={getURLChain:()=>['https://pixelody-web.pixelody101.workers.dev/modules/listening-notes-1.0.0.pixelody-module'],getMimeType:()=> 'application/octet-stream',getTotalBytes:()=>361,setSaveDialogOptions:o=>saveOptions=o};
 denied=false;session.emit('will-download',{preventDefault(){denied=true}},item);assert.equal(denied,false);assert.ok(saveOptions);
 denied=false;session.emit('will-download',{preventDefault(){denied=true}},{...item,getURLChain:()=>['https://evil.example/file.pixelody-module']});assert.equal(denied,true);
 // Failure states: offline load closes the window with a message; a cancelled navigation does not.
 const shown=[];dialogStub.showMessageBox=async(...a)=>{shown.push(a)};
 remote.webContents.emit('did-fail-load',{},-3,'ERR_ABORTED',SHOP_ENTRY,true);assert.equal(remote.dead,undefined);
 remote.webContents.emit('did-fail-load',{},-106,'ERR_INTERNET_DISCONNECTED',SHOP_ENTRY,false);assert.equal(remote.dead,undefined);
 remote.webContents.emit('did-fail-load',{},-106,'ERR_INTERNET_DISCONNECTED',SHOP_ENTRY,true);assert.equal(remote.dead,true);assert.equal(shown.length,1);
 assert.equal((await controller.handle({op:'open-shop'})).ok,true);
 // Bad packages are rejected without touching what is installed.
 for (const bad of ['', 'not json', '[]', JSON.stringify({format:1,kind:'web-shop'})]) assert.throws(()=>parsePackage(Buffer.from(bad),'desktop'));
 assert.equal(new WebModuleStore(path.join(isolated,'modules')).read().entry,SHOP_ENTRY);
 assert.equal((await controller.handle({op:'remove-shop'})).ok,true);assert.equal(remote.dead,true);assert.equal((await controller.handle({op:'open-shop'})).ok,false);
 console.log('PASS sandbox settings, installed-only opening, origin/redirect/download guards and uninstall closure');
})().catch(error=>{console.error(error);process.exitCode=1});
