/** 마이크 녹음용 순수 함수 (렌더러·테스트 공용) */
export function mergeChunks(chunks:Float32Array[]):Float32Array{
  const total=chunks.reduce((n,c)=>n+c.length,0);const out=new Float32Array(total);let o=0;
  for(const c of chunks){out.set(c,o);o+=c.length;}
  return out;
}
/** 16-bit PCM 모노 WAV */
export function encodeWav(samples:Float32Array,sampleRate:number):ArrayBuffer{
  const buffer=new ArrayBuffer(44+samples.length*2);const v=new DataView(buffer);
  const str=(o:number,s:string)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};
  str(0,'RIFF');v.setUint32(4,36+samples.length*2,true);str(8,'WAVE');str(12,'fmt ');
  v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sampleRate,true);
  v.setUint32(28,sampleRate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,samples.length*2,true);
  for(let i=0;i<samples.length;i++){const s=Math.max(-1,Math.min(1,samples[i]));v.setInt16(44+i*2,s<0?s*0x8000:s*0x7fff,true);}
  return buffer;
}
export function peakDb(samples:Float32Array):number{let p=0;for(let i=0;i<samples.length;i++){const a=Math.abs(samples[i]);if(a>p)p=a;}return p>0?20*Math.log10(p):-90;}
export function rmsDb(samples:Float32Array):number{if(!samples.length)return -90;let s=0;for(let i=0;i<samples.length;i++)s+=samples[i]*samples[i];const r=Math.sqrt(s/samples.length);return r>0?Math.max(-90,20*Math.log10(r)):-90;}
/** 레벨 미터 표시용 0~1 (-60dB ~ 0dB) */
export function meterFraction(db:number):number{return Math.max(0,Math.min(1,(db+60)/60));}
/** 목소리가 있는 구간 [start, end] (초). 앞뒤 무음 자르기에 사용. 소리가 없으면 null */
export function detectVoiceBounds(samples:Float32Array,sampleRate:number,{thresholdDb=-40,windowSec=.02,margin=.12}:{thresholdDb?:number;windowSec?:number;margin?:number}={}):{start:number;end:number}|null{
  const win=Math.max(1,Math.round(sampleRate*windowSec));const n=Math.floor(samples.length/win);
  let first=-1,last=-1;
  for(let w=0;w<n;w++){
    if(rmsDb(samples.subarray(w*win,(w+1)*win))>thresholdDb){if(first<0)first=w;last=w;}
  }
  if(first<0)return null;
  const dur=samples.length/sampleRate;
  return {start:Math.max(0,first*windowSec-margin),end:Math.min(dur,(last+1)*windowSec+margin)};
}
/** 파형 그리기용: bins 개의 최대 진폭 (0~1) */
export function waveformPeaks(samples:Float32Array,bins:number):number[]{
  const out:number[]=[];const step=Math.max(1,Math.floor(samples.length/Math.max(1,bins)));
  for(let b=0;b<bins;b++){let p=0;const end=Math.min(samples.length,(b+1)*step);for(let i=b*step;i<end;i++){const a=Math.abs(samples[i]);if(a>p)p=a;}out.push(Math.min(1,p));}
  return out;
}

// ── 연속 녹음: 문장 사이에서 쉬면 자동으로 다음 문장으로 넘기기 ──
export interface PauseOptions{/** 이보다 크면 목소리 */speechDb:number;/** 이보다 작으면 쉼 */silenceDb:number;/** 이만큼 말한 뒤에만 넘김(초) */minSpeech:number;/** 이만큼 쉬면 넘김(초) */pause:number}
export const DEFAULT_PAUSE:PauseOptions={speechDb:-38,silenceDb:-45,minSpeech:.4,pause:1};
export interface PauseState{t:number;speech:number;silenceStart:number|null}
export const pauseStart=(t=0):PauseState=>({t,speech:0,silenceStart:null});
/** 녹음 조각(길이 dt초, 크기 db) 하나를 넣는다. 말한 뒤 pause 초 이상 쉬면 split(나눌 시각, 초)을 돌려준다.
 *  나누는 시각은 쉬기 시작한 때에서 조금 뒤(쉼의 앞쪽) — 앞 문장 끝 숨소리는 앞 녹음에, 나머지 쉼은 다음 녹음 앞에 들어가고 무음 자르기로 정리된다 */
export function pauseStep(s:PauseState,db:number,dt:number,o:PauseOptions=DEFAULT_PAUSE):{state:PauseState;split:number|null}{
  const t=s.t+dt;let {speech,silenceStart}=s;
  if(db>=o.speechDb){speech+=dt;silenceStart=null;}
  else if(db<o.silenceDb){if(silenceStart==null)silenceStart=s.t;}
  else silenceStart=null; // 애매한 크기: 쉼으로 세지 않는다
  if(speech>=o.minSpeech&&silenceStart!=null&&t-silenceStart>=o.pause){
    const split=silenceStart+Math.min(.3,o.pause/2);return {state:pauseStart(t),split};
  }
  return {state:{t,speech,silenceStart},split:null};
}
/** 한 번에 녹음한 소리를 나눔 위치(샘플 번호)들로 자른다: marks = [0, m1, m2, …, 끝] */
export function splitAtMarks(samples:Float32Array,marks:number[]):Float32Array[]{
  const m=[...marks].map(x=>Math.max(0,Math.min(samples.length,Math.round(x)))).sort((a,b)=>a-b);
  const out:Float32Array[]=[];for(let i=0;i<m.length-1;i++)out.push(samples.slice(m[i],m[i+1]));return out;
}
