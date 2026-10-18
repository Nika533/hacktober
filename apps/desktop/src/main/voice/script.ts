/**
 * The voice helper: Windows PowerShell 5.1 running the same JSON-lines loop
 * as the textAccess helper (`{id, cmd, ...}` in, `{id, ok, ...}` out,
 * `{"ready":true}` once up), with System.Speech doing the work: dictation
 * from the default microphone (SpeechRecognitionEngine, the recognizer for
 * the Windows display language, else en-US) and Windows voices for replies
 * (SpeechSynthesizer). Recognizer and synthesizer threads write events
 * through one synchronized writer:
 *   {"event":"partial","text","peak"}    a live guess at the phrase so far
 *   {"event":"final","text","confidence","peak"}  a finished phrase
 *   {"event":"rejected"}                 a phrase it couldn't make out
 *   {"event":"level","value"}            microphone level 0–100 (~8 a second)
 *   {"event":"stopped"[,"error"]}        listening ended
 *   {"event":"spoken","utterance"[,"cancelled"]}  a `speak` finished
 * `peak` is the loudest level since the last phrase, so main can drop
 * phrases the recognizer made up from room noise.
 *
 * Commands: listen (→ problem: '' | 'unavailable' | 'no_microphone' | other
 * text), stop {finish} (finish lets the phrase in progress complete), speak
 * {text, utterance, rate}, hush (cancels everything queued), ping.
 *
 * Same rules as textAccess/script.ts: C# 5 only (no ?. or $""), no
 * backticks or dollar-brace, no comments (lines are trimmed and joined).
 */
const TYPES = String.raw`
using System;using System.Collections.Generic;using System.Globalization;using System.IO;using System.Speech.Recognition;using System.Speech.Synthesis;using System.Text;
public static class HV{
static TextWriter Out=TextWriter.Synchronized(new StreamWriter(Console.OpenStandardOutput(),new UTF8Encoding(false)){AutoFlush=true});
public static void Line(string s){Out.WriteLine(s);}
static string Q(string s){var b=new StringBuilder("\"");foreach(char c in s){if(c=='"')b.Append("\\\"");else if(c=='\\')b.Append("\\\\");else if(c<32)b.AppendFormat("\\u{0:x4}",(int)c);else b.Append(c);}return b.Append('"').ToString();}
static SpeechRecognitionEngine R;static SpeechSynthesizer S;static volatile bool on;static int lv=-1,pk;static long lt;
static Dictionary<Prompt,int> ids=new Dictionary<Prompt,int>();
static RecognizerInfo Pick(){RecognizerInfo p=null;foreach(var i in SpeechRecognitionEngine.InstalledRecognizers()){if(i.Culture.Name==CultureInfo.CurrentUICulture.Name)return i;if(p==null||i.Culture.Name=="en-US")p=i;}return p;}
public static string Listen(){
if(on)return "";
if(R==null){var p=Pick();if(p==null)return "unavailable";
R=new SpeechRecognitionEngine(p);R.LoadGrammar(new DictationGrammar());
R.SpeechHypothesized+=delegate(object s,SpeechHypothesizedEventArgs e){if(on)Line("{\"event\":\"partial\",\"text\":"+Q(e.Result.Text)+",\"peak\":"+pk+"}");};
R.SpeechRecognized+=delegate(object s,SpeechRecognizedEventArgs e){Line("{\"event\":\"final\",\"text\":"+Q(e.Result.Text)+",\"confidence\":"+e.Result.Confidence.ToString("0.00",CultureInfo.InvariantCulture)+",\"peak\":"+pk+"}");pk=0;};
R.SpeechRecognitionRejected+=delegate(object s,SpeechRecognitionRejectedEventArgs e){pk=0;Line("{\"event\":\"rejected\"}");};
R.AudioLevelUpdated+=delegate(object s,AudioLevelUpdatedEventArgs e){if(!on)return;int a=e.AudioLevel;if(a>pk)pk=a;long t=Environment.TickCount;if(t-lt<120&&Math.Abs(a-lv)<15)return;lt=t;lv=a;Line("{\"event\":\"level\",\"value\":"+a+"}");};
R.RecognizeCompleted+=delegate(object s,RecognizeCompletedEventArgs e){on=false;Line("{\"event\":\"stopped\""+(e.Error!=null?",\"error\":"+Q(e.Error.Message):"")+"}");};
}
try{R.SetInputToDefaultAudioDevice();}catch(Exception){return "no_microphone";}
on=true;lv=-1;pk=0;
try{R.RecognizeAsync(RecognizeMode.Multiple);}catch(Exception e){on=false;return e.Message;}
return "";
}
public static bool Stop(bool finish){if(R==null||!on)return false;if(finish)R.RecognizeAsyncStop();else R.RecognizeAsyncCancel();return true;}
public static bool Speak(string text,int id,int rate){
if(S==null){S=new SpeechSynthesizer();S.SetOutputToDefaultAudioDevice();S.SpeakCompleted+=delegate(object s,SpeakCompletedEventArgs e){int n;lock(ids){if(!ids.TryGetValue(e.Prompt,out n))return;ids.Remove(e.Prompt);}Line("{\"event\":\"spoken\",\"utterance\":"+n+(e.Cancelled?",\"cancelled\":true":"")+"}");};}
S.Rate=Math.Max(-10,Math.Min(10,rate));
var pb=new PromptBuilder();pb.AppendText(text);
lock(ids){ids[S.SpeakAsync(pb)]=id;}
return true;
}
public static bool Hush(){if(S!=null)S.SpeakAsyncCancelAll();return true;}
}
`

const SCRIPT = String.raw`
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$u=New-Object Text.UTF8Encoding $false
[Console]::InputEncoding=$u
[Console]::OutputEncoding=$u
Add-Type -AssemblyName System.Speech
Add-Type -TypeDefinition $env:HOOT_VOICE_TYPES -ReferencedAssemblies System.Speech
$in=New-Object IO.StreamReader ([Console]::OpenStandardInput()),$u
[HV]::Line('{"ready":true}')
while($null -ne ($l=$in.ReadLine())){
$q=$null
try{
$q=ConvertFrom-Json $l
$r=switch($q.cmd){
'listen'{@{problem=[HV]::Listen()}}
'stop'{@{done=[HV]::Stop([bool]$q.finish)}}
'speak'{@{done=[HV]::Speak([string]$q.text,[int]$q.utterance,[int]$q.rate)}}
'hush'{@{done=[HV]::Hush()}}
'ping'{@{}}
default{throw "unknown command $($q.cmd)"}
}
$r.id=$q.id;$r.ok=$true
}catch{$r=@{id=$(if($q){$q.id}else{$null});ok=$false;error="$_"}}
[HV]::Line((ConvertTo-Json $r -Compress -Depth 5))
}
`

const compact = (source: string): string =>
  source
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')

export const VOICE_SCRIPT = compact(SCRIPT)
export const VOICE_TYPES = compact(TYPES)
export const VOICE_TYPES_ENV = 'HOOT_VOICE_TYPES'
