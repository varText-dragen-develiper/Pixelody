const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {syncInstalledShortcutIcons:sync,taskbarIdentityForProfile,applyWindowsTaskbarIcon}=require('../src/windows-taskbar-icon');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'pixelody-shortcut-test-'));
const locations={desktop:path.join(root,'desktop'),appData:path.join(root,'appData'),userData:path.join(root,'profile')};
const app={isPackaged:true,getPath:key=>locations[key]},identity={productName:'Pixelody',appUserModelId:'io.pixelody.desktop'};
const links=[path.join(locations.desktop,'Pixelody.lnk'),path.join(locations.appData,'Microsoft/Windows/Start Menu/Programs/Pixelody.lnk')];
const details=new Map(),writes=[],reads=[];
for(const link of links){fs.mkdirSync(path.dirname(link),{recursive:true});fs.writeFileSync(link,'original shortcut');details.set(link,{target:process.execPath,appUserModelId:identity.appUserModelId,args:'',icon:'original.exe',iconIndex:0});}
const shell={readShortcutLink:link=>{reads.push(link);return details.get(link)},writeShortcutLink(link,operation,update){assert.equal(operation,'update');assert.deepEqual(Object.keys(update).sort(),update.appUserModelId?['appUserModelId','icon','iconIndex']:['icon','iconIndex']);Object.assign(details.get(link),update);writes.push(link);return true}};
try {
 for(const file of ['obsession-red.ico','cartridge-purple.ico','studio-lavender.ico'])assert.equal(sync({app,shell,identity,file}).length,2);
 assert.equal(writes.length,6);assert.equal(sync({app,shell,identity,file:'studio-lavender.ico'}).length,0);
 assert.equal(fs.readFileSync(path.join(locations.userData,'brand-icons/shortcut-backups/desktop.lnk'),'utf8'),'original shortcut');
 const prior=writes.length;sync({app,shell,identity,file:'preview.ico',profileDirectory:root});assert.equal(writes.length,prior);
 details.get(links[0]).target='C:/unrelated/application.exe';details.get(links[1]).appUserModelId='different.app';assert.equal(sync({app,shell,identity,file:'other.ico'}).length,0);
 details.get(links[0]).target=process.execPath;details.get(links[0]).args='--pixelody-profile-directory=other';assert.equal(sync({app,shell,identity,file:'other.ico'}).length,0);
 const preview=path.join(locations.desktop,'Pixelody Public Test - Desktop.lnk');fs.writeFileSync(preview,'preview shortcut');
 details.set(preview,{target:process.execPath,args:`--pixelody-profile-directory="${root}"`,appUserModelId:'',icon:'original.exe',iconIndex:0});
 const ownerIcon=details.get(links[1]).icon;
 assert.deepEqual(sync({app,shell,identity,file:'preview-red.ico',profileDirectory:root}),[preview]);
 assert.equal(details.get(preview).appUserModelId,taskbarIdentityForProfile(identity,root));
 assert.notEqual(details.get(preview).appUserModelId,identity.appUserModelId);
 assert.equal(taskbarIdentityForProfile(identity),identity.appUserModelId);
 assert.notEqual(taskbarIdentityForProfile(identity,root),taskbarIdentityForProfile(identity,path.join(root,'different')));
 assert.equal(details.get(links[1]).icon,ownerIcon);
 assert.equal(sync({app,shell,identity,file:'preview-purple.ico',profileDirectory:path.join(root,'other')}).length,0);
 assert.deepEqual(sync({app,shell,identity,file:'preview-purple.ico',profileDirectory:root}),[preview]);
 const nativeCalls=[];
 const refreshTargets=[];
 const image={resize:()=>({toPNG:()=>Buffer.from('generated PNG fixture')})};
 applyWindowsTaskbarIcon({win:{setAppDetails:details=>nativeCalls.push(details)},image,app,shell,identity,color:'#7b68c9',profileDirectory:root,onShortcut:shortcut=>refreshTargets.push(shortcut)});
 assert.equal(nativeCalls.length,2,'Publish icon properties separately from the ID refresh trigger.');
 assert.equal(nativeCalls[0].appId,undefined,'Microsoft requires related properties before AppUserModel.ID.');
 assert.ok(nativeCalls[0].appIconPath.endsWith('logo-7b68c9.ico'));
 assert.deepEqual(nativeCalls[1],{appId:taskbarIdentityForProfile(identity,root)});
 assert.equal(details.get(preview).icon,nativeCalls[0].appIconPath,'Shortcut must have the new icon before the window ID refresh.');
 assert.deepEqual(refreshTargets,[preview],'Shell refresh must receive the exact matching shortcut.');
 refreshTargets.length=0;
 applyWindowsTaskbarIcon({win:{setAppDetails:()=>{}},image,app,shell,identity,color:'#7b68c9',profileDirectory:root,onShortcut:shortcut=>refreshTargets.push(shortcut)});
 assert.deepEqual(refreshTargets,[preview],'A failed Shell refresh retry must include unchanged matching shortcuts.');
 const warn=console.warn;console.warn=()=>{};
 try {assert.throws(()=>sync({app,shell:{...shell,writeShortcutLink:()=>false},identity,file:'blocked.ico',profileDirectory:root}),/shortcut icon update failed/,'A matching shortcut write failure must fail the acknowledgement so the renderer can retry.');}
 finally {console.warn=warn;}
 const foreign=path.join(locations.desktop,'Renamed application.lnk');fs.writeFileSync(foreign,'foreign shortcut');
 details.set(foreign,{target:'C:/other/app.exe',args:'',appUserModelId:'other.app',icon:'other.ico',iconIndex:0});
 sync({app,shell,identity,file:'cache-first.ico',profileDirectory:root});
 const foreignReads=reads.filter(link=>link===foreign).length;
 sync({app,shell,identity,file:'cache-second.ico',profileDirectory:root});
 assert.equal(reads.filter(link=>link===foreign).length,foreignReads,'Color changes must not repeatedly resolve unrelated shortcuts through COM.');
 Object.assign(details.get(foreign),{target:process.execPath,args:`--pixelody-profile-directory="${root}"`,appUserModelId:taskbarIdentityForProfile(identity,root)});
 fs.utimesSync(foreign,new Date(Date.now()+2000),new Date(Date.now()+2000));
 assert.equal(sync({app,shell,identity,file:'cache-third.ico',profileDirectory:root}).length,2,'A changed foreign shortcut must be rediscovered and guarded.');
 console.log('Theme round trip, icon-only writes, backup preservation, preview isolation, and foreign shortcut guards passed.');
} finally {
 const resolved=path.resolve(root);if(!resolved.startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(resolved).startsWith('pixelody-shortcut-test-'))throw Error('Unsafe cleanup path');fs.rmSync(resolved,{recursive:true});
}

