import {useEffect,useRef} from 'react';
import {duckFactor,takeLength,takeSpan} from '../../shared/project';
import {layerFade,musicLayers} from '../../shared/media';
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
    // 배경음악 + 추가 소리(음악 바꾸기·효과음): 구간 안에서만 재생, 페이드·자동 줄이기 근사
    let raf=0;const duck=duckFactor(d.bgm);
    const players=musicLayers(d).filter(l=>urls[l.file]).map(l=>{const a=new Audio(urls[l.file]);a.loop=l.loop;a.preload='auto';return {l,a,on:false};});
    const tick=()=>{const now=getPlayhead();const voice=spans.some(({s})=>now>=s.start&&now<s.end);
      for(const p of players){const inside=now>=p.l.start&&now<p.l.end;
        if(inside&&!p.on){p.on=true;const a=p.a,l=p.l;
          const begin=()=>{if(dead||!p.on)return;const pos=getPlayhead()-l.start+l.file_start;try{a.currentTime=a.duration&&l.loop?pos%a.duration:pos;}catch{/* 아직 못 읽음 */}void a.play().catch(()=>{});};
          if(a.readyState>=1)begin();else a.addEventListener('loadedmetadata',begin,{once:true});}
        else if(!inside&&p.on){p.on=false;p.a.pause();}
        if(p.on)p.a.volume=Math.max(0,Math.min(1,p.l.volume*(voice&&p.l.duck?duck:1)*layerFade(p.l,now)));}
      raf=requestAnimationFrame(tick);};
    if(players.length)raf=requestAnimationFrame(tick);
    return()=>{dead=true;cancelAnimationFrame(raf);for(const s of sources){try{s.stop();}catch{/* */}}voiceGain.disconnect();for(const p of players){p.a.pause();p.a.src='';}};
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
