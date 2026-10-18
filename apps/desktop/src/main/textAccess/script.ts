/**
 * The helper: Windows PowerShell 5.1 running a JSON-lines loop. One request
 * per stdin line `{id, cmd, ...args}`, one reply per stdout line
 * `{id, ok, ...}`; `{"ready":true}` once it's up, and `{"event":"click",x,y}`
 * from the click watcher thread (all lines go through one synchronized
 * writer, so they never interleave). UI Automation through
 * System.Windows.Automation, input and clipboard through user32. All
 * coordinates are physical screen px (the helper is per-monitor DPI aware).
 *
 * Commands: foreground, selection, copy (Ctrl+C once the hotkey's modifiers
 * are up; never into a terminal), clipSave/clipClear/clipText/clipRestore
 * (a full snapshot of every memory format, held in the helper), textInRect
 * {x,y,w,h,excludePid} (windows of that process are looked through),
 * windowAt {x,y,excludePid} (the top-level window there, looking through that
 * process's windows), watchClicks {on}, click {x,y}.
 *
 * The C# half travels in an environment variable (HELPER_TYPES_ENV): with it
 * on the command line the encoded command would brush the 32K limit.
 * No backticks or dollar-brace in here (template literals). Lines are
 * trimmed and blank ones dropped, so keep both free of comments. PowerShell
 * names are case-insensitive: a local $tp would shadow the global $TP.
 */
const TYPES = String.raw`
using System;using System.Collections.Generic;using System.Diagnostics;using System.IO;using System.Runtime.InteropServices;using System.Text;using System.Threading;
public static class HT{
const string U="user32.dll",K="kernel32.dll";
static TextWriter Out=TextWriter.Synchronized(new StreamWriter(Console.OpenStandardOutput(),new UTF8Encoding(false)){AutoFlush=true});
public static void Line(string s){Out.WriteLine(s);}
[DllImport(U)]public static extern IntPtr GetForegroundWindow();
[DllImport(U)]static extern bool GetCursorPos(out PT p);
[DllImport(U)]static extern bool SetCursorPos(int x,int y);
[DllImport(U)]static extern int GetSystemMetrics(int i);
[DllImport(U)]static extern IntPtr WindowFromPoint(PT p);
[DllImport(U)]static extern IntPtr GetAncestor(IntPtr h,uint f);
[DllImport(U,CharSet=CharSet.Unicode)]static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
[DllImport(U)]static extern int GetWindowTextLength(IntPtr h);
[DllImport(U,CharSet=CharSet.Unicode)]static extern int GetClassName(IntPtr h,StringBuilder s,int n);
[DllImport(U)]static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
[DllImport(U)]static extern short GetAsyncKeyState(int k);
[DllImport(U)]static extern uint SendInput(uint n,IN[] i,int s);
[DllImport(U)]static extern bool SetProcessDpiAwarenessContext(IntPtr c);
[DllImport(U)]static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
[DllImport(U)]static extern bool OpenClipboard(IntPtr h);
[DllImport(U)]static extern bool CloseClipboard();
[DllImport(U)]static extern bool EmptyClipboard();
[DllImport(U)]static extern uint EnumClipboardFormats(uint f);
[DllImport(U)]static extern IntPtr GetClipboardData(uint f);
[DllImport(U)]static extern IntPtr SetClipboardData(uint f,IntPtr h);
[DllImport(U,CharSet=CharSet.Unicode)]static extern IntPtr CreateWindowEx(int e,string c,string n,int s,int x,int y,int w,int h,IntPtr p,IntPtr m,IntPtr i,IntPtr l);
[DllImport(U)]static extern bool DestroyWindow(IntPtr h);
[DllImport(U)]static extern bool EnumWindows(EW f,IntPtr l);
[DllImport(U)]static extern bool IsWindowVisible(IntPtr h);
[DllImport(U)]static extern bool IsIconic(IntPtr h);
[DllImport(U)]static extern bool GetWindowRect(IntPtr h,out RC r);
[DllImport(U)]static extern int GetWindowLong(IntPtr h,int i);
[DllImport("dwmapi.dll")]static extern int DwmGetWindowAttribute(IntPtr h,int a,out int v,int s);
[DllImport(K)]static extern IntPtr GlobalLock(IntPtr h);
[DllImport(K)]static extern bool GlobalUnlock(IntPtr h);
[DllImport(K)]static extern UIntPtr GlobalSize(IntPtr h);
[DllImport(K)]static extern IntPtr GlobalAlloc(uint f,UIntPtr n);
[DllImport(K)]static extern IntPtr GlobalFree(IntPtr h);
delegate bool EW(IntPtr h,IntPtr l);
public struct PT{public int X,Y;}
public struct RC{public int L,T,R,B;}
public struct KI{public ushort V,S;public uint F,T;public IntPtr X;}
public struct MI{public int X,Y;public uint D,F,T;public IntPtr E;}
[StructLayout(LayoutKind.Explicit)]public struct UN{[FieldOffset(0)]public MI M;[FieldOffset(0)]public KI K;}
public struct IN{public uint T;public UN U;}
public static void Dpi(){try{SetProcessDpiAwarenessContext(new IntPtr(-4));}catch{}try{SetThreadDpiAwarenessContext(new IntPtr(-4));}catch{}}
public static uint Pid(IntPtr h){uint p;GetWindowThreadProcessId(h,out p);return p;}
public static string Title(IntPtr h){var s=new StringBuilder(GetWindowTextLength(h)+1);GetWindowText(h,s,s.Capacity);return s.ToString();}
public static string Cls(IntPtr h){var s=new StringBuilder(256);GetClassName(h,s,256);return s.ToString();}
public static bool Term(IntPtr h){return Array.IndexOf(new[]{"ConsoleWindowClass","CASCADIA_HOSTING_WINDOW_CLASS","mintty","VirtualConsoleClass","PuTTY","KiTTY"},Cls(h))>=0;}
static IN Key(ushort v,ushort s,uint f){var i=new IN();i.T=1;i.U.K.V=v;i.U.K.S=s;i.U.K.F=f;return i;}
static IN Btn(uint f){var i=new IN();i.U.M.F=f;return i;}
static int Sz(){return Marshal.SizeOf(typeof(IN));}
static void Idle(int[] keys){var w=Stopwatch.StartNew();while(w.ElapsedMilliseconds<700){bool d=false;foreach(int k in keys)if((GetAsyncKeyState(k)&0x8000)!=0)d=true;if(!d)break;Thread.Sleep(15);}}
public static bool Copy(){
Idle(new[]{16,17,18,91,92});
if(Term(GetForegroundWindow()))return false;
var a=new[]{Key(17,29,0),Key(67,46,0),Key(67,46,2),Key(17,29,2)};
return SendInput(4,a,Sz())==4;
}
public static bool Click(int x,int y){
var w=Stopwatch.StartNew();while(w.ElapsedMilliseconds<150){bool d=false;foreach(int k in new[]{1,2,4,16,17,18,91,92})if((GetAsyncKeyState(k)&0x8000)!=0)d=true;if(!d)break;Thread.Sleep(4);}
if(!SetCursorPos(x,y))return false;
bool sw=GetSystemMetrics(23)!=0;
if(SendInput(1,new[]{Btn(sw?8u:2u)},Sz())!=1)return false;
Thread.Sleep(8);
return SendInput(1,new[]{Btn(sw?16u:4u)},Sz())==1;
}
static volatile bool watching;static Thread watcher;
public static bool Watch(bool on){
watching=on;
if(on&&(watcher==null||!watcher.IsAlive)){watcher=new Thread(Spy);watcher.IsBackground=true;watcher.Start();}
return on;
}
static void Spy(){
try{SetThreadDpiAwarenessContext(new IntPtr(-4));}catch{}
int vk=GetSystemMetrics(23)!=0?2:1;
bool down=(GetAsyncKeyState(vk)&0x8000)!=0;
while(watching){
Thread.Sleep(15);
short s=GetAsyncKeyState(vk);bool now=(s&0x8000)!=0;
if(!now&&(down||(s&1)!=0)){PT p;if(GetCursorPos(out p))Line("{\"event\":\"click\",\"x\":"+p.X+",\"y\":"+p.Y+"}");}
down=now;
}
}
static List<KeyValuePair<uint,byte[]>> snap;static int tok;
static bool Open(IntPtr h){for(int i=0;i<20;i++){if(OpenClipboard(h))return true;Thread.Sleep(10);}return false;}
static bool Skip(uint f){return f==2||f==3||f==9||f==14||f==0x80||f==0x82||f==0x83||f==0x8E||(f>=0x200&&f<=0x3FF);}
public static int Save(){
if(!Open(IntPtr.Zero))return -1;
var l=new List<KeyValuePair<uint,byte[]>>();
try{uint f=0;while((f=EnumClipboardFormats(f))!=0){if(Skip(f))continue;IntPtr h=GetClipboardData(f);if(h==IntPtr.Zero)continue;long n=(long)GlobalSize(h).ToUInt64();if(n<=0||n>(64<<20))continue;IntPtr p=GlobalLock(h);if(p==IntPtr.Zero)continue;try{var b=new byte[n];Marshal.Copy(p,b,0,(int)n);l.Add(new KeyValuePair<uint,byte[]>(f,b));}finally{GlobalUnlock(h);}}}
finally{CloseClipboard();}
snap=l;return ++tok;
}
static bool Own(Func<bool> act){
IntPtr w=CreateWindowEx(0,"STATIC","",0,0,0,0,0,new IntPtr(-3),IntPtr.Zero,IntPtr.Zero,IntPtr.Zero);
try{if(!Open(w))return false;try{EmptyClipboard();return act();}finally{CloseClipboard();}}finally{if(w!=IntPtr.Zero)DestroyWindow(w);}
}
public static bool Clear(){return Own(delegate{return true;});}
public static bool Restore(int t){
if(t!=tok||snap==null)return false;
var l=snap;snap=null;
return Own(delegate{foreach(var e in l){IntPtr h=GlobalAlloc(2,new UIntPtr((ulong)e.Value.Length));if(h==IntPtr.Zero)continue;IntPtr p=GlobalLock(h);Marshal.Copy(e.Value,0,p,e.Value.Length);GlobalUnlock(h);if(SetClipboardData(e.Key,h)==IntPtr.Zero)GlobalFree(h);}return true;});
}
public static string Text(){
if(!Open(IntPtr.Zero))return "";
try{IntPtr h=GetClipboardData(13);if(h==IntPtr.Zero)return "";IntPtr p=GlobalLock(h);if(p==IntPtr.Zero)return "";try{int n=(int)Math.Min((long)GlobalSize(h).ToUInt64()/2,40000);var s=Marshal.PtrToStringUni(p,n);int z=s.IndexOf('\0');return z>=0?s.Substring(0,z):s;}finally{GlobalUnlock(h);}}
finally{CloseClipboard();}
}
public static IntPtr Under(int x,int y,uint skip){
IntPtr r=IntPtr.Zero;
EnumWindows(delegate(IntPtr h,IntPtr l){RC c;int v;
if(!IsWindowVisible(h)||IsIconic(h)||!GetWindowRect(h,out c)||x<c.L||x>=c.R||y<c.T||y>=c.B||(GetWindowLong(h,-20)&0x20)!=0||Pid(h)==skip)return true;
if(DwmGetWindowAttribute(h,14,out v,4)==0&&v!=0)return true;
r=h;return false;},IntPtr.Zero);
return r;
}
public static IntPtr Target(int x,int y,uint skip){PT p;p.X=x;p.Y=y;IntPtr h=GetAncestor(WindowFromPoint(p),2);return h!=IntPtr.Zero&&Pid(h)!=skip?h:Under(x,y,skip);}
}
`

const SCRIPT = String.raw`
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$u=New-Object Text.UTF8Encoding $false
[Console]::InputEncoding=$u
[Console]::OutputEncoding=$u
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase
Add-Type -TypeDefinition $env:HOOT_TEXT_ACCESS_TYPES
[HT]::Dpi()
$A=[Windows.Automation.AutomationElement]
$TP=[Windows.Automation.TextPattern]::Pattern
$VP=[Windows.Automation.ValuePattern]::Pattern
$CV=[Windows.Automation.Automation]::ControlViewCondition
$W=[Windows.Automation.TreeWalker]::ControlViewWalker
$EP=[Windows.Automation.Text.TextPatternRangeEndpoint]
function Pn($p){try{[Diagnostics.Process]::GetProcessById([int]$p).ProcessName}catch{''}}
function Fg{$h=[HT]::GetForegroundWindow();$p=[HT]::Pid($h);@{process=(Pn $p);title=[HT]::Title($h);pid=$p;terminal=[HT]::Term($h)}}
function Tp($e){for($i=0;$e -and $i -lt 10;$i++){$o=$null;if($e.TryGetCurrentPattern($TP,[ref]$o)){return $o};$e=$W.GetParent($e)}}
function Sel1{
$r=Fg;$r.text='';$r.paragraph='';$r.rects=New-Object Collections.ArrayList
$p=Tp ($A::FocusedElement)
if(-not $p){return $r}
$s=$null;try{$s=$p.GetSelection()}catch{}
if(-not $s){return $r}
$r.text=(@($s|ForEach-Object{$_.GetText(20000)}) -join [char]10)
foreach($g in $s){foreach($b in $g.GetBoundingRectangles()){if($r.rects.Count -lt 64 -and $b.Width -gt 0 -and $b.Height -gt 0){[void]$r.rects.Add(@{x=$b.X;y=$b.Y;w=$b.Width;h=$b.Height})}}}
try{$c=$s[0].Clone();$c.ExpandToEnclosingUnit([Windows.Automation.Text.TextUnit]::Paragraph);$r.paragraph=$c.GetText(1500)}catch{}
$r
}
function Sel{$r=Sel1;if(-not $r.text.Trim() -and ([HT]::Cls([HT]::GetForegroundWindow()) -like 'Chrome_WidgetWin*')){Start-Sleep -Milliseconds 150;$r=Sel1};$r}
$CR=New-Object Windows.Automation.CacheRequest
$IT=$A::IsTextPatternAvailableProperty;$IV=$A::IsValuePatternAvailableProperty
foreach($p in $A::BoundingRectangleProperty,$A::NameProperty,$IT,$IV){$CR.Add($p)}
function Walk($hs,$R,$sw){
$o=New-Object Collections.ArrayList;$st=New-Object Collections.Stack;$n=0;$len=0;$hit=$false
for($j=$hs.Count-1;$j -ge 0;$j--){try{$st.Push($A::FromHandle($hs[$j]).GetUpdatedCache($CR))}catch{}}
$CR.Push()
try{
while($st.Count -and $n -lt 2500 -and $len -lt 16000 -and $sw.ElapsedMilliseconds -lt 1000){
$e=$st.Pop();$n++
try{
$c=$e.Cached;$b=$c.BoundingRectangle
if(-not $b.IsEmpty -and -not $b.IntersectsWith($R)){continue}
$i=if($b.IsEmpty){$R}else{[Windows.Rect]::Intersect($R,$b)}
if($e.GetCachedPropertyValue($IT)){
$t=$e.GetCurrentPattern($TP)
$ra=$t.RangeFromPoint((New-Object Windows.Point ($i.Left+1),($i.Top+1)))
$rz=$t.RangeFromPoint((New-Object Windows.Point ($i.Right-1),($i.Bottom-1)))
try{$rz.ExpandToEnclosingUnit([Windows.Automation.Text.TextUnit]::Character)}catch{}
$ra.MoveEndpointByRange($EP::End,$rz,$EP::End)
$x=$ra.GetText(8000)
if($x.Trim()){[void]$o.Add(@{text=$x;x=$i.Left;y=$i.Top});$len+=$x.Length;$hit=$true;continue}
}
$k=$e.FindAll([Windows.Automation.TreeScope]::Children,$CV)
if($k.Count){for($j=$k.Count-1;$j -ge 0;$j--){$st.Push($k[$j])}}
else{
$x=$c.Name
if($e.GetCachedPropertyValue($IV)){$v=$e.GetCurrentPattern($VP).Current.Value;if($v -and $v -ne $x){$x=("$x $v").Trim()}}
if($x -and $x.Trim()){[void]$o.Add(@{text=$x;x=$i.Left;y=$i.Top});$len+=$x.Length}
}
}catch{}
}
}finally{$CR.Pop()}
@{items=$o;nodes=$n;hit=$hit}
}
function Tir($q){
$R=New-Object Windows.Rect ([double]$q.x),([double]$q.y),([double]$q.w),([double]$q.h)
$sw=[Diagnostics.Stopwatch]::StartNew()
$hs=New-Object Collections.ArrayList
foreach($fy in 0.2,0.5,0.8){foreach($fx in 0.2,0.5,0.8){$h=[HT]::Target([int]($q.x+$q.w*$fx),[int]($q.y+$q.h*$fy),[uint32]$q.excludePid);if($h -ne [IntPtr]::Zero -and -not $hs.Contains($h)){[void]$hs.Add($h)}}}
$res=Walk $hs $R $sw
if(-not $res.hit -and @($hs|Where-Object{[HT]::Cls($_) -like 'Chrome_WidgetWin*'}).Count){Start-Sleep -Milliseconds 250;$res=Walk $hs $R $sw}
@{items=$res.items;nodes=$res.nodes}
}
function Wat($q){
$h=[HT]::Target([int]$q.x,[int]$q.y,[uint32]$q.excludePid)
if($h -eq [IntPtr]::Zero){return @{found=$false}}
$p=[HT]::Pid($h);@{found=$true;process=(Pn $p);title=[HT]::Title($h)}
}
$in=New-Object IO.StreamReader ([Console]::OpenStandardInput()),$u
[HT]::Line('{"ready":true}')
while($null -ne ($l=$in.ReadLine())){
$q=$null
try{
$q=ConvertFrom-Json $l
$r=switch($q.cmd){
'foreground'{Fg}
'selection'{Sel}
'copy'{@{sent=[HT]::Copy()}}
'clipSave'{@{token=[HT]::Save()}}
'clipClear'{@{done=[HT]::Clear()}}
'clipText'{@{text=[HT]::Text()}}
'clipRestore'{@{done=[HT]::Restore([int]$q.token)}}
'textInRect'{Tir $q}
'windowAt'{Wat $q}
'watchClicks'{@{on=[HT]::Watch([bool]$q.on)}}
'click'{@{done=[HT]::Click([int]$q.x,[int]$q.y)}}
'ping'{@{}}
default{throw "unknown command $($q.cmd)"}
}
$r.id=$q.id;$r.ok=$true
}catch{$r=@{id=$(if($q){$q.id}else{$null});ok=$false;error="$_"}}
[HT]::Line((ConvertTo-Json $r -Compress -Depth 5))
}
`

const compact = (source: string): string =>
  source
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')

export const HELPER_SCRIPT = compact(SCRIPT)
export const HELPER_TYPES = compact(TYPES)
export const HELPER_TYPES_ENV = 'HOOT_TEXT_ACCESS_TYPES'

/** `powershell -EncodedCommand` takes base64 of UTF-16LE. */
export const encodeCommand = (script: string): string =>
  Buffer.from(script, 'utf16le').toString('base64')
