param([Parameter(Mandatory=$true)][uint32]$TaskProcessId,[Parameter(Mandatory=$true)][string]$AppId)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
try {
 if($AppId -notmatch '^[a-zA-Z0-9._-]{1,100}$' -or $TaskProcessId -eq 0){throw 'Invalid icon worker authority.'}
 Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class PixelodyLiveWindowIcons {
 [StructLayout(LayoutKind.Sequential)] struct Key { public Guid format; public uint id; public Key(uint p){format=new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");id=p;} }
 [StructLayout(LayoutKind.Explicit,Size=24)] struct Variant { [FieldOffset(0)] public ushort type; [FieldOffset(8)] public IntPtr pointer; [FieldOffset(8)] public short number; }
 [ComImport,Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface Store {
  [PreserveSig]int GetCount(out uint count); [PreserveSig]int GetAt(uint index,out Key key); [PreserveSig]int GetValue(ref Key key,out Variant value); [PreserveSig]int SetValue(ref Key key,ref Variant value); [PreserveSig]int Commit();
 }
 [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint process);
 [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr window,ref Guid iid,out Store store);
 [DllImport("ole32.dll")] static extern int PropVariantClear(ref Variant value);
 static readonly Dictionary<long,Dictionary<uint,string>> saved=new Dictionary<long,Dictionary<uint,string>>();
 static readonly Dictionary<long,short?> pins=new Dictionary<long,short?>();
 static Store Open(long handle,uint owner){var window=new IntPtr(handle);if(!IsWindow(window))return null;uint process;GetWindowThreadProcessId(window,out process);if(process!=owner)throw new Exception("Foreign window rejected");Guid iid=typeof(Store).GUID;Store store;Marshal.ThrowExceptionForHR(SHGetPropertyStoreForWindow(window,ref iid,out store));return store;}
 static string Read(Store store,uint pid){var key=new Key(pid);Variant v;Marshal.ThrowExceptionForHR(store.GetValue(ref key,out v));try{if(v.type==0)return null;if(v.type!=31)throw new Exception("Unexpected window property type");return Marshal.PtrToStringUni(v.pointer);}finally{PropVariantClear(ref v);}}
 static void Set(Store store,uint pid,string text){var key=new Key(pid);var v=new Variant();if(text!=null){v.type=31;v.pointer=Marshal.StringToCoTaskMemUni(text);}try{Marshal.ThrowExceptionForHR(store.SetValue(ref key,ref v));}finally{PropVariantClear(ref v);}}
 static short? ReadPin(Store s){var k=new Key(9);Variant v;Marshal.ThrowExceptionForHR(s.GetValue(ref k,out v));try{if(v.type==0)return null;if(v.type!=11)throw new Exception("Unexpected pin property type");return v.number;}finally{PropVariantClear(ref v);}}
 static void SetPin(Store s,short? value){var k=new Key(9);var v=new Variant();if(value.HasValue){v.type=11;v.number=value.Value;}Marshal.ThrowExceptionForHR(s.SetValue(ref k,ref v));}
 public static void Begin(string[] handles,uint owner,string id){
  var opened=new Dictionary<long,Store>();
  try{
   // Validate all windows before changing any. A second Begin only enrolls new
   // windows (for example a mini-player opened during the transition).
   foreach(string text in handles){long h=Convert.ToInt64(text,16);if(opened.ContainsKey(h))continue;Store store=Open(h,owner);if(store==null)continue;opened.Add(h,store);if(Read(store,5)!=id)throw new Exception("Unexpected taskbar identity");if(saved.ContainsKey(h)&&ReadPin(store)!=-1)throw new Exception("Live icon policy changed unexpectedly");}
   foreach(var pair in opened){if(saved.ContainsKey(pair.Key))continue;var prior=new Dictionary<uint,string>();foreach(uint key in new uint[]{2,3,4,5})prior[key]=Read(pair.Value,key);pins.Add(pair.Key,ReadPin(pair.Value));saved.Add(pair.Key,prior);}
   foreach(var pair in opened){if(ReadPin(pair.Value)==-1)continue;Set(pair.Value,5,null);SetPin(pair.Value,-1);foreach(uint key in new uint[]{2,3,4})Set(pair.Value,key,null);Set(pair.Value,5,id);}
  }catch{Finish(owner,id,false);throw;}finally{foreach(Store store in opened.Values)Marshal.ReleaseComObject(store);}
 }
 public static void Finish(uint owner,string id,bool commit){
  if(commit){foreach(long h in saved.Keys){Store s=Open(h,owner);if(s==null)continue;try{if(Read(s,5)!=id||String.IsNullOrEmpty(Read(s,2))||String.IsNullOrEmpty(Read(s,3))||String.IsNullOrEmpty(Read(s,4)))throw new Exception("Canonical taskbar properties not restored");}finally{Marshal.ReleaseComObject(s);}}}
  foreach(var pair in saved){Store s=Open(pair.Key,owner);if(s==null)continue;try{
   Set(s,5,null);SetPin(s,pins[pair.Key]);
   if(!commit)foreach(uint key in new uint[]{2,3,4})Set(s,key,pair.Value[key]);
   Set(s,5,pair.Value[5]);
   if(ReadPin(s)!=pins[pair.Key])throw new Exception("Pin property restoration failed");
  }finally{Marshal.ReleaseComObject(s);}}
  saved.Clear();pins.Clear();
 }
}
'@
 while($null-ne($line=[Console]::ReadLine())){
  $requestId=$null
  try{
   if($line.Length-gt2048){throw 'Oversized icon request.'}
   $r=$line|ConvertFrom-Json
   if($null-eq$r.id-or$r.id-isnot[ValueType]-or$r.id-is[bool]-or[double]$r.id-lt1-or[double]$r.id-gt2147483647-or[double]$r.id-ne[Math]::Truncate([double]$r.id)){throw 'Invalid icon request ID.'}
   $requestId=[int]$r.id
   if($r.action-notin@('prepare','begin','commit','rollback')-or@($r.handles).Count-gt2){throw 'Invalid icon operation.'}
   $handles=@();foreach($h in @($r.handles)){if($h-isnot[string]-or$h-notmatch'^[a-f0-9]{1,16}$'){throw 'Invalid window handle.'};$handles+=$h}
   if($r.action-eq'begin'){[PixelodyLiveWindowIcons]::Begin([string[]]$handles,$TaskProcessId,$AppId)}
   elseif($r.action-eq'commit'){[PixelodyLiveWindowIcons]::Finish($TaskProcessId,$AppId,$true)}
   elseif($r.action-eq'rollback'){[PixelodyLiveWindowIcons]::Finish($TaskProcessId,$AppId,$false)}
   [Console]::WriteLine((@{id=$requestId;ok=$true}|ConvertTo-Json -Compress))
  }catch{[Console]::WriteLine((@{id=$requestId;ok=$false;error=$_.Exception.Message}|ConvertTo-Json -Compress))}
 }
}catch{[Console]::WriteLine((@{id=$null;ok=$false;error=$_.Exception.Message}|ConvertTo-Json -Compress))}
finally{if('PixelodyLiveWindowIcons'-as[type]){try{[PixelodyLiveWindowIcons]::Finish($TaskProcessId,$AppId,$false)}catch{}}}
