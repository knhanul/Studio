import {useEffect,useRef} from 'react';
import {duckFactor,takeLength,takeSpan} from '../../shared/project';
import type {ComposerProject,SubtitleItem} from '../../shared/types';

const buffers=new Map<string,Promise<AudioBuffer|null>>();
let ctxSingleton:AudioContext|null=null;
export function audioContext(){if(!ctxSingleton)ctxSingleton=new AudioContext();return ctxSingleton;}
export function loadBuffer(url:string):Promise<AudioBuffer|null>{
  if(!url)return Promise.resolve(null);
  if(!buffers.has(url))buffers.set(url,fetch(url).then(r=>r.arrayBuffer()).then(b=>audioContext().decodeAudioData(b)).catch(()=>null));
  return buffers.get(url)!;
}
/** 미리보기 재생 중 더빙 녹음과 배경음악을 타임라인에 맞춰 들려준다 (덕킹·페이드 근사) */
export function usePreviewAudio({doc,urls,cues,playing,startAt,startKey,getPlayhead}:{doc:ComposerProject|null;urls:Record<string,string>;cues:SubtitleItem[];playing:boolean;startAt:number;startKey:number;getPlayhead:()=>number}){
  const docRef=useRef(doc);docRef.current=doc;
  useEffect(()=>{
    const d=docRef.current;if(!playing||!d)return;
    let dead=false;const ctx=audioContext();void ctx.resume();
    const sources:AudioBufferSourceNode[]=[];void startAt;const latency=Number(d.dubbing.latency_ms)||0;
    const spans=d.dubbing.takes.map(t=>({t,s:takeSpan(t,cues,latency)}));
    const voiceGain=ctx.createGain();voiceGain.gain.value=Number(d.dubbing.volume??1);voiceGain.connect(ctx.destination);
    void Promise.all(spans.map(async({t,s})=>{
      const buf=await loadBuffer(urls[t.file]);if(dead||!buf)return;
      const len=takeLength({...t,duration:t.duration??buf.duration});const now=getPlayhead();const skip=Math.max(0,now-s.start);if(skip>=len)return;
      const src=ctx.createBufferSource();src.buffer=buf;const g=ctx.createGain();g.gain.value=t.volume==null?1:Number(t.volume);src.connect(g).connect(voiceGain);
      src.start(ctx.currentTime+Math.max(0,s.start-now),(Number(t.trim_start)||0)+skip,len-skip);sources.push(src);
    }));
    let audio:HTMLAudioElement|null=null;let raf=0;
    const b=d.bgm;const burl=b.file?urls[b.file]:'';
    if(burl&&Number(b.volume??.3)>0){
      audio=new Audio(burl);audio.loop=b.loop!==false;const start=Number(b.start_offset)||0;
      const begin=()=>{if(!audio||dead)return;const pos=Math.max(0,getPlayhead()-start)+(Number(b.file_start)||0);try{audio.currentTime=audio.duration&&audio.loop?pos%audio.duration:pos;}catch{/* */}void audio.play().catch(()=>{});};
      if(audio.readyState>=1)begin();else audio.addEventListener('loadedmetadata',begin,{once:true});
      const duck=b.duck_under_voice!==false?duckFactor(b):1;
      const tick=()=>{if(!audio)return;const now=getPlayhead();const voice=spans.some(({s})=>now>=s.start&&now<s.end);
        const fi=Number(b.fade_in??1),since=now-start;const fade=fi>0?Math.min(1,Math.max(0,since/fi)):1;
        audio.volume=Math.max(0,Math.min(1,Number(b.volume??.3)*(voice?duck:1)*fade));raf=requestAnimationFrame(tick);};
      raf=requestAnimationFrame(tick);
    }
    return()=>{dead=true;cancelAnimationFrame(raf);for(const s of sources){try{s.stop();}catch{/* */}}voiceGain.disconnect();if(audio){audio.pause();audio.src='';}};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[playing,startKey]);
}
/** 녹음 하나만 바로 듣기 */
export async function playTake(url:string,trimStart=0,trimEnd:number|null=null,volume=1):Promise<()=>void>{
  const buf=await loadBuffer(url);if(!buf)throw new Error('녹음 파일을 읽지 못했어요.');
  const ctx=audioContext();await ctx.resume();const src=ctx.createBufferSource();src.buffer=buf;const g=ctx.createGain();g.gain.value=volume;src.connect(g).connect(ctx.destination);
  const end=trimEnd??buf.duration;src.start(0,trimStart,Math.max(.05,end-trimStart));
  return ()=>{try{src.stop();}catch{/* */}};
}
export function forgetBuffer(url:string){buffers.delete(url);}
