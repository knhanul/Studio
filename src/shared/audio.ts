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
