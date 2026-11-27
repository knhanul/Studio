import {useCallback,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {Captions,Check,ChevronLeft,Film,Settings2,ChevronRight,Circle,FileAudio,ListChecks,Mic2,Play,RefreshCw,Repeat,Scissors,Square,Trash2,Wand2,X} from 'lucide-react';
import {DEFAULT_PAUSE,detectVoiceBounds,encodeWav,meterFraction,pauseStart,pauseStep,splitAtMarks,waveformPeaks,type PauseState} from '../../shared/audio';
import {applyTrim,dubWindows,fitTimelineToTakes,pictureTake,removeTakeForCue,round,setTakeForCue,sortCues,takeForCue,takeLength,timeline,type DubWindow} from '../../shared/project';
import type {DubbingTake,StepId} from '../../shared/types';
import {SidePanel,StepLayout} from '../components/Shell';
import {Timeline,type TimelineLive} from '../components/Timeline';
import {Button,Empty,Field,IconButton,Section,Segmented,Slider} from '../components/UI';
import {useEditor} from '../editor';
import {loadBuffer,playMusicLayers,playTake,playTakesAlong} from '../hooks/usePreviewAudio';
import {Monitor} from '../components/Monitor';
import {useRecorder} from '../hooks/useRecorder';

type Phase='idle'|'countdown'|'recording'|'saving';
interface Opts{/** 시작 전 준비: 바로 · 1초 · 3초 카운트다운 */prep:0|1|3;autoNext:boolean;autoTrim:boolean;autoFit:boolean;
  /** 연속 녹음: 쉬면 자동으로 다음 문장 · 쉬는 시간(초) */pauseNext:boolean;pauseSec:number;
  /** 영상 보며 녹음 (자막 시간 기준으로 문장이 넘어감) · 녹음 중 배경음악 듣기(헤드폰) */picture:boolean;listenBgm:boolean;
  /** 녹음하며 다른 문장 녹음 듣기(헤드폰) */listenTakes:boolean}
const OPTS_KEY='studio-dub-options';
const BASE_OPTS:Opts={prep:3,autoNext:true,autoTrim:true,autoFit:true,pauseNext:true,pauseSec:1,picture:true,listenBgm:false,listenTakes:false};
const loadOpts=():Opts=>{try{const raw=JSON.parse(localStorage.getItem(OPTS_KEY)||'{}') as Partial<Opts>&{countdown?:boolean};
  // 예전 설정(3초 카운트다운 켜기/끄기) 이어받기
  const prep:Opts['prep']=raw.prep===0||raw.prep===1||raw.prep===3?raw.prep:raw.countdown===false?1:3;
  return {...BASE_OPTS,...raw,prep};}catch{return BASE_OPTS;}};
const PREPS=[{id:0 as const,label:'바로'},{id:1 as const,label:'1초'},{id:3 as const,label:'3초 카운트다운'}];
/** 녹음 범위: 이 문장 · 체크한 문장 · 여기부터 끝까지 */
type Scope='one'|'checked'|'rest';
const PAUSES=[{id:.7,label:'0.7초'},{id:1,label:'1초'},{id:1.5,label:'1.5초'}];
/** 영상 보며 녹음: 화면 시계(from 초에서 startedAt 부터 흐름)와 녹음 구간 */
interface Pic{queue:number[];windows:DubWindow[];from:number;startedAt:number;T0:number;recT0:number|null;pos:number;single:boolean;lastCount:number}
const picNow=(p:{from:number;startedAt:number})=>p.from+(performance.now()-p.startedAt)/1000;
/** 더빙 화면의 영상: 자기 시계로만 다시 그려(앱 전체를 다시 그리지 않음) 녹음이 끊기지 않게 한다. 소리는 내지 않는다 */
function DubMonitor({clock,idle}:{clock:{from:number;startedAt:number}|null;idle:number}){
  const [t,setT]=useState(idle);
  useEffect(()=>{if(!clock){setT(idle);return;}let raf=0;const tick=()=>{setT(picNow(clock));raf=requestAnimationFrame(tick);};raf=requestAnimationFrame(tick);return()=>cancelAnimationFrame(raf);},[clock,idle]);
  return <Monitor time={t} run={!!clock} silent showTransport={false}/>;
}
const fmtT=(sec:number)=>`${String(Math.floor(sec/60)).padStart(2,'0')}:${(sec%60).toFixed(1).padStart(4,'0')}`;
/** 녹음 중 원형 타이머: 문장 시작까지 · 다음 문장까지 · 끝까지 (자기 시계로 0.1초마다만 다시 그림) */
function NextRing({clock,windows}:{clock:{from:number;startedAt:number};windows:DubWindow[]}){
  const [t,setT]=useState(()=>picNow(clock));
  useEffect(()=>{let raf=0;const tick=()=>{const v=Math.floor(picNow(clock)*10)/10;setT(x=>x===v?x:v);raf=requestAnimationFrame(tick);};raf=requestAnimationFrame(tick);return()=>cancelAnimationFrame(raf);},[clock]);
  const k=windows.findIndex(w=>t<w.end);const w=windows[k<0?windows.length-1:k];
  const before=t<windows[0].start;
  const left=before?windows[0].start-t:Math.max(0,w.end-t);
  const span=before?Math.max(.1,windows[0].start-clock.from):Math.max(.1,w.end-Math.max(w.start,windows[0].start));
  const soon=!before&&left<1.5;
  const label=before?'녹음 시작까지':k>=0&&k<windows.length-1?'다음 문장까지':'끝까지';
  return <><span className="side-label">{label}</span>
    <div className={`ring ${soon?'soon':''} ${before?'wait':''}`} style={{['--p' as string]:String(Math.max(0,Math.min(1,left/span)))}}><div><strong>{left.toFixed(1)}</strong><small>초</small></div></div>
    <span className={`side-hint ${soon?'soon':''}`}>{before?'화면을 보며 준비하세요':soon?(label==='끝까지'?'곧 끝나요':'숨 고르고 다음 문장 준비'):'지금 문장을 읽으세요'}</span></>;
}
/** 대본 띠의 지금 문장 진행 막대 */
function LiveBar({clock,windows,index}:{clock:{from:number;startedAt:number};windows:DubWindow[];index:number}){
  const [t,setT]=useState(()=>picNow(clock));
  useEffect(()=>{let raf=0;const tick=()=>{const v=Math.floor(picNow(clock)*20)/20;setT(x=>x===v?x:v);raf=requestAnimationFrame(tick);};raf=requestAnimationFrame(tick);return()=>cancelAnimationFrame(raf);},[clock]);
  const w=windows.find(x=>x.index===index);const f=w?Math.max(0,Math.min(1,(t-w.start)/Math.max(.1,w.end-w.start))):0;
  return <div className="strip-progress" aria-hidden="true"><span style={{width:`${f*100}%`}}/></div>;
}
/** 녹음 설정 창: 자주 바꾸지 않는 것만 모아 둔다 */
function RecordSettings({opts,setOpt,latency,setLatency,onClose}:{opts:Opts;setOpt:<K extends keyof Opts>(k:K,v:Opts[K])=>void;latency:number;setLatency:(v:number)=>void;onClose:()=>void}){
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{const down=(e:MouseEvent)=>{if(ref.current&&!ref.current.contains(e.target as Node)&&!(e.target as HTMLElement).closest('.settings-btn'))onClose();};
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};
    window.addEventListener('mousedown',down);window.addEventListener('keydown',key);return()=>{window.removeEventListener('mousedown',down);window.removeEventListener('keydown',key);};},[onClose]);
  return <section className="record-settings" ref={ref} aria-label="녹음 설정">
    <div className="rs-head"><strong>녹음 설정</strong><span>자주 안 바꾸는 것만 여기에 모았어요</span></div>
    <div className="rs-group"><span className="rs-label">녹음 방식</span>
      <div className="rs-modes">
        <button type="button" className={opts.picture?'on':''} aria-pressed={opts.picture} onClick={()=>setOpt('picture',true)}><strong>영상 보며</strong><small>자막 시간에 맞춰 넘어가요. 말한 위치 그대로 저장</small></button>
        <button type="button" className={!opts.picture?'on':''} aria-pressed={!opts.picture} onClick={()=>setOpt('picture',false)}><strong>대본만 보며</strong><small>쉬면 다음 문장. 녹음 길이에 장면을 맞출 수 있어요</small></button>
      </div></div>
    <div className="rs-group"><span className="rs-label">시작 전 준비</span>
      <Segmented label="시작 전 준비" value={opts.prep} options={PREPS} onChange={v=>setOpt('prep',v)}/></div>
    <div className="rs-group"><span className="rs-label">녹음한 뒤</span>
      <label className="rs-check"><input type="checkbox" checked={opts.autoNext} onChange={e=>setOpt('autoNext',e.target.checked)}/> 다음 문장 이어서 녹음 <small>(「이 문장」으로 녹음할 때)</small></label>
      <label className="rs-check"><input type="checkbox" checked={opts.autoTrim} onChange={e=>setOpt('autoTrim',e.target.checked)}/> 앞뒤 무음 자동으로 자르기</label>
      {!opts.picture&&<label className="rs-check"><input type="checkbox" checked={opts.autoFit} onChange={e=>setOpt('autoFit',e.target.checked)}/> 녹음 길이에 장면·자막 맞추기</label>}
      {!opts.picture&&<label className="rs-check"><input type="checkbox" checked={opts.pauseNext} onChange={e=>setOpt('pauseNext',e.target.checked)}/> 연속 녹음: 쉬면 자동으로 다음 문장</label>}
      {!opts.picture&&opts.pauseNext&&<div className="rs-indent"><Segmented label="쉬는 시간" value={opts.pauseSec} options={PAUSES} onChange={v=>setOpt('pauseSec',v)}/></div>}
    </div>
    {opts.picture&&<div className="rs-group"><span className="rs-label">듣기 (헤드폰일 때만 — 스피커면 마이크에 들어가요)</span>
      <label className="rs-check"><input type="checkbox" checked={opts.listenBgm} onChange={e=>setOpt('listenBgm',e.target.checked)}/> 녹음하며 배경음악 듣기</label>
      <label className="rs-check"><input type="checkbox" checked={opts.listenTakes} onChange={e=>setOpt('listenTakes',e.target.checked)}/> 앞뒤 문장 녹음 들으며 이어 말하기</label>
    </div>}
    <div className="rs-latency">
      <Slider label="마이크 지연 보정" value={latency} min={0} max={300} step={10} format={v=>`${v}ms`} onChange={v=>setLatency(Math.round(v))} description="녹음한 목소리가 영상보다 늦게 들리면 늘려 주세요. 그만큼 당겨서 놓아요."/>
    </div>
  </section>;
}
/** 연속 녹음 진행 상태 */
interface Cont{queue:number[];pos:number}
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

export function LevelMeter({db,active}:{db:number;active:boolean}){
  const f=meterFraction(db);return <div className={`level-meter ${active?'':'off'}`} title={active?`입력 ${Math.round(db)} dB`:'마이크 꺼짐'}><span style={{width:`${f*100}%`}} className={db>-3?'clip':db>-12?'hot':''}/><i style={{left:`${meterFraction(-12)*100}%`}}/><i style={{left:`${meterFraction(-3)*100}%`}}/></div>;
}
function Waveform({url,take}:{url?:string;take:DubbingTake}){
  const [peaks,setPeaks]=useState<number[]>([]);const [dur,setDur]=useState(0);
  useEffect(()=>{let dead=false;if(!url){setPeaks([]);return;}void loadBuffer(url).then(b=>{if(dead||!b)return;setDur(b.duration);setPeaks(waveformPeaks(b.getChannelData(0),140));});return()=>{dead=true;};},[url]);
  if(!peaks.length)return <div className="waveform empty">파형을 읽는 중…</div>;
  const ts=Number(take.trim_start)||0;const te=take.trim_end??dur;
  return <div className="waveform" aria-label="녹음 파형">{peaks.map((p,i)=>{const t=(i+.5)/peaks.length*dur;return <span key={i} className={t<ts||t>te?'cut':''} style={{height:`${Math.max(4,p*100)}%`}}/>;})}
    <em style={{left:`${dur?ts/dur*100:0}%`}}/><em style={{left:`${dur?Math.min(1,te/dur)*100:100}%`}}/></div>;
}

export function DubbingStep({header,actionBar,goto}:{header:ReactNode;actionBar:ReactNode;goto:(s:StepId)=>void}){
  const {doc,commit,urls,selectedCue,setSelectedCue,seek,toast,setPlaying,cues,checkedCues,setCheckedCues}=useEditor();
  const rec=useRecorder();
  const [phase,setPhase]=useState<Phase>('idle');const [count,setCount]=useState(0);const [elapsed,setElapsed]=useState(0);
  const [opts,setOpts]=useState<Opts>(loadOpts);
  const setOpt=<K extends keyof Opts>(k:K,v:Opts[K])=>setOpts(o=>{const n={...o,[k]:v};localStorage.setItem(OPTS_KEY,JSON.stringify(n));return n;});
  const items=useMemo(()=>sortCues(doc.subtitle.items||[]),[doc.subtitle.items]);
  /** 여러 문장 고르기 (체크) — 선택한 녹음 지우기 · 선택한 문장 연속 녹음 */
  const checked=checkedCues;const setChecked=setCheckedCues;
  const [cont,setCont]=useState<Cont|null>(null);
  const [showSettings,setShowSettings]=useState(false);
  const [scope,setScope]=useState<Scope>('one');
  // 문장을 고르기 시작하면 녹음 범위를 「선택한 문장」으로, 모두 풀면 「이 문장」으로
  const prevChecked=useRef(checkedCues.length);
  useEffect(()=>{const before=prevChecked.current,now=checkedCues.length;prevChecked.current=now;
    if(before===0&&now>0)setScope(s=>s==='one'?'checked':s);else if(before>0&&now===0)setScope(s=>s==='checked'?'one':s);},[checkedCues.length]);
  /** 이번에 막 녹음한 문장 (오른쪽 목록에 「방금」) */
  const [justDone,setJustDone]=useState<number[]>([]);
  const contRef=useRef<(Cont&{marks:number[];pause:PauseState})|null>(null);
  const picRef=useRef<Pic|null>(null);const [clock,setClock]=useState<{from:number;startedAt:number}|null>(null);const [live,setLive]=useState<TimelineLive|null>(null);const stopMusic=useRef<(()=>void)|null>(null);
  const curIndex=selectedCue!=null&&items.some(c=>c.index===selectedCue)?selectedCue:(items.find(c=>!takeForCue(doc,c.index))||items[0])?.index??null;
  const pos=items.findIndex(c=>c.index===curIndex);const cur=items[pos];
  const next=cont?items.find(c=>c.index===cont.queue[cont.pos+1]):items[pos+1];
  const prev=cont&&cont.pos>0?items.find(c=>c.index===cont.queue[cont.pos-1]):items[pos-1];
  const abort=useRef(false);const optsRef=useRef(opts);optsRef.current=opts;
  const startPictureRef=useRef<((q:number[],single:boolean)=>Promise<void>)|null>(null);
  const shown=(idx:number)=>cues.find(c=>c.index===idx);
  const focus=useCallback((idx:number)=>{setSelectedCue(idx);const c=cues.find(x=>x.index===idx);if(c)seek(c.start);},[cues,seek,setSelectedCue]);

  const begin=useCallback(async(idx:number,prepOverride?:number)=>{
    if(optsRef.current.picture){void startPictureRef.current?.([idx],true);return;}
    setPlaying(false);abort.current=false;
    if(!rec.ready&&!(await rec.open()))return;
    focus(idx);
    const prep=prepOverride??optsRef.current.prep;if(prep>0){setPhase('countdown');for(let n=prep;n>=1;n--){if(abort.current){setPhase('idle');return;}setCount(n);rec.beep(n===1);await sleep(1000);}if(abort.current){setPhase('idle');return;}}
    rec.start();setPhase('recording');
  },[rec,focus,setPlaying]);
  const finish=useCallback(async(idx:number,mode:'stop'|'next'|'discard')=>{
    const {samples,sampleRate}=rec.stop();
    if(mode==='discard'){setPhase('idle');toast('이번 녹음은 저장하지 않았어요.');return;}
    if(samples.length<sampleRate*.3){setPhase('idle');toast('녹음이 너무 짧아요. 다시 시도해 주세요.','error');return;}
    setPhase('saving');
    try{
      const file=await window.compose.take.save(idx,encodeWav(samples,sampleRate));
      let take:DubbingTake={file,subtitle:idx,offset:0,volume:1,duration:round(samples.length/sampleRate)};
      if(optsRef.current.autoTrim){const b=detectVoiceBounds(samples,sampleRate);if(b)take=applyTrim(take,b.start,b.end);else toast('목소리가 거의 들리지 않아요. 마이크 입력을 확인해 주세요.','error');}
      commit(p=>{const n=setTakeForCue(p,take);return optsRef.current.autoFit?fitTimelineToTakes(n):n;});setJustDone(j=>[...j.filter(x=>x!==idx),idx]);
      const after=items[items.findIndex(c=>c.index===idx)+1];
      if(mode==='next'&&after){void begin(after.index,0);return;}
      if(optsRef.current.autoNext&&after){void begin(after.index);return;}
      if(after)focus(after.index);
      setPhase('idle');toast(`문장 ${idx} 녹음을 저장했어요 (${takeLength(take).toFixed(1)}초).`,'success');
    }catch(e){setPhase('idle');toast(e instanceof Error?e.message:String(e),'error');}
  },[rec,commit,items,begin,focus,toast]);
  // ── 연속 녹음: 마이크를 멈추지 않고 고른 문장을 차례로 읽는다. 끝나면 문장 사이(넘긴 위치)에서 잘라 문장별 녹음으로 저장 ──
  const finishCont=useCallback(async(mode:'save'|'discard')=>{
    const c=contRef.current;if(!c)return;contRef.current=null;rec.setChunkListener(null);
    const {samples,sampleRate}=rec.stop();setCont(null);
    if(mode==='discard'){setPhase('idle');toast('연속 녹음을 저장하지 않았어요.');return;}
    const done=c.queue.slice(0,c.pos+1);const parts=splitAtMarks(samples,[...c.marks,samples.length]).slice(0,done.length);
    setPhase('saving');
    try{
      const takes:DubbingTake[]=[];let skipped=0;
      for(let k=0;k<parts.length;k++){
        const part=parts[k];const idx=done[k];
        if(part.length<sampleRate*.3){skipped++;continue;}
        const file=await window.compose.take.save(idx,encodeWav(part,sampleRate));
        let take:DubbingTake={file,subtitle:idx,offset:0,volume:1,duration:round(part.length/sampleRate)};
        if(optsRef.current.autoTrim){const b=detectVoiceBounds(part,sampleRate);if(b)take=applyTrim(take,b.start,b.end);else{skipped++;continue;}}
        takes.push(take);
      }
      if(takes.length)commit(p=>{let n=p;for(const t of takes)n=setTakeForCue(n,t);return optsRef.current.autoFit?fitTimelineToTakes(n):n;});setJustDone(takes.map(t=>Number(t.subtitle)));
      const last=done[done.length-1];const after=items[items.findIndex(x=>x.index===last)+1];if(after)focus(after.index);
      setPhase('idle');
      toast(`연속 녹음: 문장 ${takes.length}개를 저장했어요.${skipped?` 목소리가 거의 없는 ${skipped}개는 건너뛰었어요.`:''}${c.pos+1<c.queue.length?` (남은 ${c.queue.length-c.pos-1}개는 녹음하지 않았어요)`:''}`,takes.length?'success':'error');
    }catch(e){setPhase('idle');toast(e instanceof Error?e.message:String(e),'error');}
  },[rec,commit,items,focus,toast]);
  /** 다음 문장으로 (at: 나눌 위치 샘플 번호 — 없으면 지금) */
  const advanceCont=useCallback((at?:number)=>{
    const c=contRef.current;if(!c)return;
    if(c.pos>=c.queue.length-1){void finishCont('save');return;}
    c.marks.push(at??rec.sampleCount());c.pos++;c.pause=pauseStart(c.pause.t);
    setCont({queue:c.queue,pos:c.pos});focus(c.queue[c.pos]);
  },[rec,finishCont,focus]);
  const startCont=useCallback(async(queue:number[])=>{
    if(optsRef.current.picture){void startPictureRef.current?.(queue,false);return;}
    const q=items.filter(x=>queue.includes(x.index)).map(x=>x.index);if(!q.length)return;
    setPlaying(false);abort.current=false;
    if(!rec.ready&&!(await rec.open()))return;
    focus(q[0]);setCont({queue:q,pos:0});
    const prep=optsRef.current.prep;if(prep>0){setPhase('countdown');for(let n=prep;n>=1;n--){if(abort.current){setPhase('idle');setCont(null);return;}setCount(n);rec.beep(n===1);await sleep(1000);}if(abort.current){setPhase('idle');setCont(null);return;}}
    contRef.current={queue:q,pos:0,marks:[0],pause:pauseStart()};
    rec.setChunkListener((db,len,total,sr)=>{const c=contRef.current;if(!c||!optsRef.current.pauseNext)return;
      const r=pauseStep(c.pause,db,len/sr,{...DEFAULT_PAUSE,pause:optsRef.current.pauseSec});c.pause=r.state;
      if(r.split!=null)advanceCont(Math.min(total,Math.round(r.split*sr)));});
    rec.start();setPhase('recording');
  },[items,rec,focus,setPlaying,advanceCont]);
  // ── 영상 보며 녹음: 문장 시작 전부터 영상을 재생하고, 화면이 문장 시작에 닿는 순간 녹음 시작.
  //    문장은 자막 시간 기준으로 넘어가고, 끝나면 문장마다 자막 구간에서 잘라 말한 위치 그대로 저장한다 ──
  const finishPicture=useCallback(async(mode:'save'|'discard')=>{
    const p=picRef.current;if(!p)return;picRef.current=null;
    const tEnd=picNow(p);setClock(null);setLive(null);seek(Math.min(tEnd,p.windows[p.windows.length-1].end));stopMusic.current?.();stopMusic.current=null;
    if(p.recT0==null){setCont(null);setPhase('idle');return;}
    const {samples,sampleRate}=rec.stop();setCont(null);
    if(mode==='discard'){setPhase('idle');toast('이번 녹음은 저장하지 않았어요.');return;}
    setPhase('saving');
    try{
      const takes:DubbingTake[]=[];let silent=0;const recEnd=p.recT0+samples.length/sampleRate;
      for(const w of p.windows){
        const fs=Math.max(w.start,p.recT0),fe=Math.min(w.end,tEnd,recEnd);if(fe-fs<.3)continue;
        const part=samples.slice(Math.round((fs-p.recT0)*sampleRate),Math.round((fe-p.recT0)*sampleRate));
        const voice=optsRef.current.autoTrim?detectVoiceBounds(part,sampleRate):null;
        if(optsRef.current.autoTrim&&!voice){silent++;continue;}
        const cue=cues.find(c=>c.index===w.index);if(!cue)continue;
        const file=await window.compose.take.save(w.index,encodeWav(part,sampleRate));
        takes.push(pictureTake(file,cue,fs,part.length/sampleRate,voice));
      }
      // 화면에 맞춰 말했으므로 장면·자막 길이는 바꾸지 않는다
      if(takes.length)commit(d=>{let n=d;for(const t of takes)n=setTakeForCue(n,t);return n;});setJustDone(j=>p.single?[...j.filter(x=>!takes.some(t=>t.subtitle===x)),...takes.map(t=>Number(t.subtitle))]:takes.map(t=>Number(t.subtitle)));
      const last=p.windows[p.windows.length-1].index;const after=items[items.findIndex(x=>x.index===last)+1];
      const all=tEnd>=p.windows[p.windows.length-1].end-.01;
      if(p.single&&all&&takes.length&&optsRef.current.autoNext&&after){void startPicture([after.index],true);return;}
      if(after&&all)focus(after.index);
      setPhase('idle');
      toast(takes.length?`문장 ${takes.length}개를 영상에 맞춰 저장했어요.${silent?` 목소리가 거의 없는 ${silent}개는 건너뛰었어요.`:''}`:'저장할 목소리가 없었어요. 마이크 입력을 확인해 주세요.',takes.length?'success':'error');
    }catch(e){setPhase('idle');toast(e instanceof Error?e.message:String(e),'error');}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[rec,commit,items,cues,focus,toast,seek]);
  const startPicture=useCallback(async(queue:number[],single:boolean)=>{
    const q=items.filter(x=>queue.includes(x.index)).map(x=>x.index);if(!q.length)return;
    setPlaying(false);abort.current=false;
    if(!rec.ready&&!(await rec.open()))return;
    const windows=dubWindows(cues,q);if(!windows.length)return;
    const T0=windows[0].start;const from=Math.max(0,T0-optsRef.current.prep);
    const startedAt=performance.now();
    picRef.current={queue:q,windows,from,startedAt,T0,recT0:null,pos:0,single,lastCount:-1};
    setSelectedCue(q[0]);setCont(single?null:{queue:q,pos:0});setClock({from,startedAt});setLive({clock:{from,startedAt},recStart:null,windows});setPhase('countdown');setCount(0);
    {const c={from,startedAt};const stops:(()=>void)[]=[];
      if(optsRef.current.listenBgm)stops.push(playMusicLayers(doc,urls,()=>picNow(c)));
      if(optsRef.current.listenTakes)stops.push(playTakesAlong(doc,urls,cues,()=>picNow(c),new Set(q)));
      stopMusic.current=stops.length?()=>stops.forEach(f=>f()):null;}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[items,cues,rec,setPlaying,setSelectedCue,doc,urls]);
  startPictureRef.current=startPicture;
  // 화면 시계에 맞춰: 카운트다운 → 녹음 시작 → 자막 시간에 따라 문장 넘기기 → 마지막 문장 뒤에 끝내기
  useEffect(()=>{if(!clock)return;let raf=0;
    const tick=()=>{const p=picRef.current;if(!p)return;const t=picNow(p);
      if(p.recT0==null){const remain=p.T0-t;
        if(remain>0){const n=Math.ceil(remain);if(n!==p.lastCount&&n<=optsRef.current.prep){p.lastCount=n;setCount(n);rec.beep(n===1);}}
        else{rec.start();p.recT0=t;setPhase('recording');setLive(l=>l?{...l,recStart:t}:l);}}
      else{
        let k=p.windows.findIndex(w=>t<w.end);if(k<0){void finishPicture('save');return;}
        if(k!==p.pos){p.pos=k;if(!p.single)setCont({queue:p.queue,pos:k});setSelectedCue(p.windows[k].index);}
      }
      raf=requestAnimationFrame(tick);};
    raf=requestAnimationFrame(tick);return()=>cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[clock]);
  /** 녹음 범위에 따라 시작: 이 문장 · 체크한 문장 · 여기부터 끝까지 */
  const startScope=()=>{if(curIndex==null)return;setShowSettings(false);
    if(scope==='one'){void begin(curIndex);return;}
    if(scope==='checked'){if(checked.length)void startCont(checked);return;}
    void startCont(items.slice(Math.max(0,pos)).map(c=>c.index));};
  const cancel=()=>{abort.current=true;if(picRef.current){void finishPicture('discard');return;}if(contRef.current){void finishCont('discard');return;}if(cont&&phase==='countdown'){setCont(null);setPhase('idle');return;}if(phase==='recording')void finish(curIndex!,'discard');else setPhase('idle');};
  useEffect(()=>{if(phase!=='recording')return;let raf=0;const t=()=>{const e=Math.floor(rec.elapsed()*10)/10;setElapsed(v=>v===e?v:e);raf=requestAnimationFrame(t);};raf=requestAnimationFrame(t);return()=>cancelAnimationFrame(raf);},[phase,rec]);
  // 키보드: R = 녹음/정지, N = 저장하고 다음 문장, Esc = 취소
  useEffect(()=>{const fn=(e:KeyboardEvent)=>{if((e.target as HTMLElement)?.closest('input,textarea,select'))return;const k=e.key.toLowerCase();
    if(picRef.current){
      if(k==='r'){e.preventDefault();void finishPicture('save');}
      else if(k==='escape'){e.preventDefault();cancel();}
      return;}
    if(contRef.current&&phase==='recording'){
      if(k==='n'||k==='enter'||k===' '){e.preventDefault();advanceCont();}
      else if(k==='r'){e.preventDefault();void finishCont('save');}
      else if(k==='escape'){e.preventDefault();cancel();}
      return;}
    if(k==='r'){e.preventDefault();if(phase==='recording')void finish(curIndex!,'stop');else if(phase==='idle'&&curIndex!=null)startScope();}
    else if(k==='n'&&phase==='recording'){e.preventDefault();void finish(curIndex!,'next');}
    else if(k==='escape'&&(phase==='recording'||phase==='countdown')){e.preventDefault();cancel();}};
    window.addEventListener('keydown',fn);return()=>window.removeEventListener('keydown',fn);});
  useEffect(()=>()=>{abort.current=true;rec.setChunkListener(null);if(picRef.current){picRef.current=null;rec.stop();}stopMusic.current?.();},[]); // eslint-disable-line react-hooks/exhaustive-deps

  const recorded=items.filter(c=>takeForCue(doc,c.index)).length;
  const sceneOf=(idx:number)=>{const c=shown(idx);if(!c)return null;const tl=timeline(doc);return tl.find(t=>c.start>=t.start&&c.start<t.end)||tl[tl.length-1];};
  const sc=cur?sceneOf(cur.index):null;
  const busy=phase!=='idle';
  const makeCues=()=>commit(p=>{const tl=timeline(p);p.subtitle.items=tl.map((t,k)=>({index:k+1,start:round(t.start+.2),end:round(t.end-.2),text:''}));return p;});

  const main=!items.length?<div className="editor-stack"><div className="panel dub-empty"><Empty icon={<Captions size={25}/>} title="녹음할 문장이 없어요" description="더빙은 자막 문장 단위로 녹음해요. 창작실 내레이션이 자막으로 넘어오지 않았다면 자막 단계에서 문장을 넣어 주세요."
      action={<div className="empty-actions"><Button onClick={()=>goto('subtitles')}>자막 단계에서 문장 넣기</Button><Button kind="outline" disabled={!doc.clips.length} onClick={makeCues}>장면마다 빈 문장 칸 만들기</Button></div>}/></div><Timeline/></div>
  :<div className="editor-stack dub-stack">
    <div className="mic-bar">
      <Mic2 size={16}/>
      <select aria-label="마이크 선택" value={rec.deviceId} onChange={e=>rec.choose(e.target.value)} disabled={busy}>{!rec.devices.length&&<option value="">기본 마이크</option>}{rec.devices.map(d=><option key={d.id} value={d.id}>{d.label}</option>)}</select>
      <LevelMeter db={rec.level} active={rec.ready}/>
      {rec.ready?<span className={`mic-state ${rec.level>-3?'warn':rec.level<-50?'low':'on'}`}>{rec.level>-3?'너무 커요':rec.level<-50?'소리가 작아요':'입력 좋음'}</span>:<Button size="sm" kind="outline" onClick={()=>void rec.open()}>마이크 켜기</Button>}
      <div className="mode-chips" aria-label="지금 녹음 방식">
        <span>{opts.picture?'영상 보며':'대본만 보며'}</span>
        <span>{opts.prep===0?'바로 시작':opts.prep===1?'1초 뒤 시작':'카운트다운 3초'}</span>
        {opts.autoNext&&<span>이어서 녹음</span>}
        {(opts.listenBgm||opts.listenTakes)&&opts.picture&&<span>헤드폰 듣기</span>}
      </div>
      <div className="settings-anchor">
        <button type="button" className={`settings-btn ${showSettings?'on':''}`} aria-expanded={showSettings} onClick={()=>setShowSettings(v=>!v)} disabled={busy}><Settings2 size={14}/> 녹음 설정</button>
        {showSettings&&<RecordSettings opts={opts} setOpt={setOpt} latency={Number(doc.dubbing.latency_ms)||0} setLatency={v=>commit(p=>{p.dubbing.latency_ms=v;return p;})} onClose={()=>setShowSettings(false)}/>}
      </div>
    </div>
    {rec.error&&<div className="inline-notice error-notice">{rec.error}</div>}

    <div className="dub-stage">
      {opts.picture
        ?<div className={`dub-picture phase-${phase}`}>
          <DubMonitor clock={clock} idle={(cur?shown(cur.index)?.start??0:0)+.05}/>
          {clock&&phase==='countdown'&&count>0&&<div className="pic-countdown" aria-live="assertive"><b key={count}>{count}</b><span>화면이 문장에 닿으면 녹음이 시작돼요</span></div>}
          {phase==='recording'&&<span className="pic-rec"><i/>REC {elapsed.toFixed(1)}초</span>}
          {sc&&<span className="pic-scene">{sc.clip.scene_id?String(sc.clip.scene_id):`장면 ${sc.index+1}`}{cur?` · ${fmtT(shown(cur.index)?.start??0)}`:''}</span>}
        </div>
        :<div className={`prompter phase-${phase}`}>
          {sc&&urls[sc.clip.file]&&sc.clip.type==='image'&&<img className="prompter-scene" src={urls[sc.clip.file]} alt=""/>}
          <div className="prompter-head"><span className="tag tag-accent">문장 {pos+1} / {items.length}</span>{sc&&<span>장면 {sc.index+1}</span>}
            {phase==='recording'&&<span className="rec-badge"><i/>녹음 중 {elapsed.toFixed(1)}초</span>}</div>
          <p className="prompter-current">{cur?.text?.trim()||<em>(빈 문장 — 자막 단계에서 문구를 넣어 주세요)</em>}</p>
          <div className="prompter-next"><small>다음 문장</small><p>{next?next.text||'(빈 문장)':'마지막 문장이에요'}</p></div>
          {phase==='countdown'&&!clock&&<div className="countdown" aria-live="assertive"><b key={count}>{count}</b><span>준비하세요</span></div>}
        </div>}
      <div className="dub-side">
        <div className="side-card ring-card">
          {live?<NextRing clock={live.clock} windows={live.windows}/>
            :<><span className="side-label">{phase==='recording'?'녹음한 시간':'이 문장 자막'}</span>
              <div className="ring" style={{['--p' as string]:'0'}}><div><strong>{phase==='recording'?elapsed.toFixed(1):(cur?Math.max(0,cur.end-cur.start):0).toFixed(1)}</strong><small>초</small></div></div>
              <span className="side-hint">{phase==='saving'?'저장 중…':phase==='idle'?(cur&&takeForCue(doc,cur.index)?`녹음됨 ${takeLength(takeForCue(doc,cur.index)!).toFixed(1)}초`:'아직 녹음 안 함'):''}</span></>}
        </div>
        <div className="side-card">
          <span className="side-label">{cont?'연속 녹음':'전체 녹음'}</span>
          <strong className="side-big">{cont?cont.pos+1:recorded} <small>/ {cont?cont.queue.length:items.length} 문장</small></strong>
          <div className="side-bar"><span style={{width:`${(cont?(cont.pos+.5)/cont.queue.length:recorded/Math.max(1,items.length))*100}%`}} className={cont?'rec':''}/></div>
        </div>
      </div>
    </div>

    {opts.picture&&<div className={`script-strip phase-${phase}`}>
      <div className="strip-line prev"><span className="strip-tag">{prev?`${items.findIndex(c=>c.index===prev.index)+1}${takeForCue(doc,prev.index)?' ✓':''}`:''}</span><span>{prev?prev.text||'(빈 문장)':'처음 문장이에요'}</span></div>
      <div className="strip-line now"><span className="strip-tag">{pos+1}{phase==='recording'?' ● 지금':''}</span><strong>{cur?.text?.trim()||<em>(빈 문장 — 자막 단계에서 문구를 넣어 주세요)</em>}</strong>
        {phase==='idle'&&cur&&takeForCue(doc,cur.index)&&<span className="tag tag-success">녹음됨 {takeLength(takeForCue(doc,cur.index)!).toFixed(1)}초</span>}</div>
      {live&&<LiveBar clock={live.clock} windows={live.windows} index={cur?.index??-1}/>}
      <div className="strip-line next"><span className="strip-tag">{next?`${items.findIndex(c=>c.index===next.index)+1} 다음`:''}</span><span>{next?next.text||'(빈 문장)':'마지막 문장이에요'}</span></div>
    </div>}

    <div className="dub-controls">
      <IconButton label="이전 문장" disabled={busy||pos<=0} onClick={()=>focus(items[pos-1].index)}><ChevronLeft size={18}/></IconButton>
      {clock
        ?<><button type="button" className="rec-button stop" onClick={()=>void finishPicture('save')} title="여기까지 저장하고 끝내기 (R)"><Square size={16}/> 끝내고 저장</button>
           <Button kind="outline" onClick={cancel} title="저장하지 않고 취소 (Esc)">취소</Button></>
        :phase==='recording'&&cont
        ?<><Button onClick={()=>advanceCont()} title="이 문장을 끝내고 다음 문장으로 — 녹음은 계속돼요 (N · Space · Enter)">{cont.pos+1<cont.queue.length?<>다음 문장 <ChevronRight size={16}/></>:'마지막 문장 끝내기'}</Button>
           <button type="button" className="rec-button stop" onClick={()=>void finishCont('save')} title="여기까지 저장하고 끝내기 (R)"><Square size={16}/> 끝내고 저장</button>
           <Button kind="outline" onClick={cancel} title="모두 저장하지 않고 취소 (Esc)">취소</Button></>
        :phase==='recording'
        ?<><button type="button" className="rec-button stop" onClick={()=>void finish(cur.index,'stop')} title="정지하고 저장 (R)"><Square size={16}/> 정지</button>
           <Button kind="secondary" disabled={!next} onClick={()=>void finish(cur.index,'next')} title="저장하고 바로 다음 문장 녹음 (N)">저장하고 다음 문장 <ChevronRight size={16}/></Button>
           <Button kind="outline" onClick={cancel} title="저장하지 않고 취소 (Esc)">취소</Button></>
        :phase==='countdown'?<Button kind="outline" onClick={cancel}>취소</Button>
        :<>
          <Segmented label="녹음 범위" value={scope} options={[{id:'one' as Scope,label:'이 문장'},{id:'checked' as Scope,label:checked.length?`선택한 ${checked.length}개`:'선택한 문장'},{id:'rest' as Scope,label:'여기부터 끝까지'}]} onChange={setScope}/>
          <button type="button" className="rec-button" disabled={busy||!cur||(scope==='checked'&&!checked.length)} onClick={startScope} title={scope==='checked'&&!checked.length?'오른쪽 목록에서 체크하거나 타임라인 자막을 Ctrl·Shift+클릭해 고르세요':'녹음 시작 (R)'}><Circle size={14} fill="currentColor"/> {scope==='one'&&cur&&takeForCue(doc,cur.index)?'다시 녹음':'녹음 시작'}</button>
        </>}
      <IconButton label="다음 문장" disabled={busy||!next} onClick={()=>next&&focus(next.index)}><ChevronRight size={18}/></IconButton>
      <span className="key-hint">{busy?<><kbd>R</kbd> 저장 <kbd>Esc</kbd> 취소{cont&&!clock?<> <kbd>N</kbd> 다음 문장</>:null}</>:<><kbd>R</kbd> 녹음 시작 <kbd>‹</kbd><kbd>›</kbd> 문장 고르기</>}</span>
    </div>
    <Timeline live={live} multiSelect={!busy}/>
  </div>;
  return <StepLayout header={header} actionBar={actionBar} panel={items.length?<DubbingPanel busy={busy} curIndex={curIndex} onRecord={idx=>void begin(idx)} onFocus={focus} checked={checked} setChecked={setChecked} onRecordMany={q=>{setScope('checked');void startCont(q);}} activeQueue={cont?.queue??(busy&&curIndex!=null?[curIndex]:[])} recordingCue={phase==='recording'?curIndex:null} justDone={justDone}/>:undefined}>{main}</StepLayout>;
}

function DubbingPanel({busy,curIndex,onRecord,onFocus,checked,setChecked,onRecordMany,activeQueue,recordingCue,justDone}:{busy:boolean;curIndex:number|null;onRecord:(idx:number)=>void;onFocus:(idx:number)=>void;
  checked:number[];setChecked:(v:number[]|((c:number[])=>number[]))=>void;onRecordMany:(queue:number[])=>void;
  /** 이번 녹음에 들어가는 문장 · 지금 녹음 중인 문장 · 막 녹음한 문장 */activeQueue:number[];recordingCue:number|null;justDone:number[]}){
  const {doc,commit,urls,toast,pickCue}=useEditor();
  const items=sortCues(doc.subtitle.items||[]);
  const sel=new Set(checked);
  /** 체크: 그냥 누르면 하나 켜고 끄기, Shift 를 누르고 누르면 앞에 누른 곳부터 여기까지 한 번에 */
  const toggle=(idx:number,shift:boolean)=>pickCue(idx,shift?'range':'toggle');
  const checkedTakes=checked.filter(i=>takeForCue(doc,i));
  const removeChecked=()=>{if(!checkedTakes.length)return;if(!confirm(`선택한 문장 ${checkedTakes.length}개의 녹음을 지울까요? (파일은 takes 폴더에 남겨 둬요)`))return;
    commit(p=>{let n=p;for(const i of checkedTakes)n=removeTakeForCue(n,i);return n;});toast(`녹음 ${checkedTakes.length}개를 지웠어요.`,'success');};
  const take=curIndex!=null?takeForCue(doc,curIndex):undefined;
  const stopRef=useRef<(()=>void)|null>(null);
  const listen=async(t:DubbingTake)=>{stopRef.current?.();try{stopRef.current=await playTake(urls[t.file],Number(t.trim_start)||0,t.trim_end??null,t.volume==null?1:Number(t.volume));}catch(e){toast(e instanceof Error?e.message:String(e),'error');}};
  const patchTake=(x:Partial<DubbingTake>)=>{if(curIndex==null||!take)return;commit(p=>setTakeForCue(p,{...take,...x}));};
  const autoTrim=async()=>{if(!take)return;const b=await loadBuffer(urls[take.file]);if(!b)return toast('녹음 파일을 읽지 못했어요.','error');const r=detectVoiceBounds(b.getChannelData(0),b.sampleRate);if(!r)return toast('목소리 구간을 찾지 못했어요.','error');commit(p=>setTakeForCue(p,applyTrim({...take,duration:take.duration??round(b.duration)},r.start,r.end)));toast('앞뒤 무음을 잘라냈어요.','success');};
  const importFile=async()=>{if(curIndex==null)return;const r=await window.compose.take.import(curIndex);if(!r)return;commit(p=>setTakeForCue(p,{file:r.file,subtitle:curIndex,offset:0,volume:1,duration:r.duration?round(r.duration):null}));toast('음성 파일을 이 문장에 연결했어요.','success');};
  return <SidePanel title="문장별 녹음" className="wide-panel" head={<Button size="sm" kind="ghost" title="녹음된 길이에 맞춰 이미지 장면 길이와 자막 시간을 다시 계산해요" onClick={()=>{commit(p=>fitTimelineToTakes(p));toast('녹음 길이에 맞춰 장면과 자막 시간을 맞췄어요.','success');}}><Wand2 size={14}/> 길이 맞추기</Button>}>
    {!busy&&<div className="cue-select-bar">
      <span className="cue-select-count"><ListChecks size={14}/> {checked.length?`${checked.length}개 선택`:'체크해서 여러 개 고르기'}</span>
      <Button size="sm" kind="ghost" disabled={busy} onClick={()=>setChecked(items.map(c=>c.index))}>전체</Button>
      <Button size="sm" kind="ghost" disabled={busy} onClick={()=>setChecked(items.filter(c=>!takeForCue(doc,c.index)).map(c=>c.index))}>미녹음만</Button>
      <Button size="sm" kind="ghost" disabled={busy||!checked.length} onClick={()=>setChecked([])}>해제</Button>
    </div>}
    {busy&&<p className="cue-busy-note">녹음하는 동안 목록은 잠겨요. 이번에 녹음할 문장 {activeQueue.length}개가 표시돼요.</p>}
    {!busy&&checked.length>0&&<div className="cue-select-actions">
      <Button size="sm" disabled={busy} onClick={()=>onRecordMany(checked)} title="마이크를 멈추지 않고 고른 문장을 차례로 녹음해요. 문장 사이에서 쉬거나 N·Space를 누르면 다음 문장으로 넘어가요"><Repeat size={14}/> 선택한 {checked.length}개 녹음</Button>
      <Button size="sm" kind="danger" disabled={busy||!checkedTakes.length} onClick={removeChecked} title="선택한 문장의 녹음 연결을 지워요 (파일은 남겨 둬요)"><Trash2 size={14}/> 녹음 {checkedTakes.length}개 지우기</Button>
    </div>}
    <ol className="cue-list">{items.map((c,k)=>{const t=takeForCue(doc,c.index);const on=sel.has(c.index);
      const state=recordingCue===c.index?'recording':busy&&activeQueue.includes(c.index)?'queued':justDone.includes(c.index)?'just':'';
      return <li key={c.index} className={`${c.index===curIndex&&!busy?'selected':''} ${on&&!busy?'checked':''} ${state?`is-${state}`:''} ${busy&&!activeQueue.includes(c.index)?'dim':''}`}>
      <button type="button" role="checkbox" aria-checked={on} aria-label={`문장 ${k+1} 고르기`} className={`cue-check ${on?'on':''}`} title="여러 개 고르기 (Shift: 범위)" disabled={busy} onClick={e=>toggle(c.index,e.shiftKey)}><Check size={12} strokeWidth={3}/></button>
      <button type="button" disabled={busy} onClick={e=>{if(e.ctrlKey||e.metaKey||e.shiftKey){toggle(c.index,e.shiftKey);return;}pickCue(c.index,'anchor');onFocus(c.index);}}>
      <span className="cue-num">{k+1}</span><span className="cue-text">{c.text||<em>(빈 문장)</em>}</span>{state==='recording'?<span className="tag tag-rec">● 녹음 중</span>:state==='queued'&&!t?<span className="tag">대기</span>:t?<span className="tag tag-success">{state==='just'?'방금 · ':''}{takeLength(t).toFixed(1)}초</span>:<span className="tag">미녹음</span>}</button></li>;})}</ol>
    {curIndex!=null&&<Section title="선택한 문장의 녹음">
      {take?<>
        <Waveform url={urls[take.file]} take={take}/>
        <div className="btn-row"><Button size="sm" onClick={()=>void listen(take)} disabled={!urls[take.file]}><Play size={14}/> 들어 보기</Button><Button size="sm" kind="outline" disabled={busy} onClick={()=>onRecord(curIndex)}><RefreshCw size={14}/> 다시 녹음</Button>
          <IconButton label="녹음 연결 지우기 (파일은 남겨 둬요)" danger onClick={()=>{if(confirm('이 문장의 녹음을 지울까요? (파일은 takes 폴더에 남겨 둬요)'))commit(p=>removeTakeForCue(p,curIndex));}}><Trash2 size={15}/></IconButton></div>
        <Slider label="목소리 크기" value={take.volume==null?1:Number(take.volume)} min={0} max={2} step={.05} format={v=>`${Math.round(v*100)}%`} onChange={v=>patchTake({volume:round(v,2)})}/>
        <div className="field-row">
          <Field label="앞 자르기 (초)"><input type="number" min={0} step={.05} value={Number(take.trim_start)||0} onChange={e=>{const v=Math.max(0,Number(e.target.value)||0);patchTake({trim_start:v,offset:round(-v)});}}/></Field>
          <Field label="끝 위치 (초)"><input type="number" min={0} step={.05} value={take.trim_end??''} placeholder={take.duration?String(take.duration):'끝까지'} onChange={e=>patchTake({trim_end:e.target.value===''?null:Math.max(0,Number(e.target.value))})}/></Field>
        </div>
        <div className="btn-row"><Button size="sm" kind="ghost" onClick={()=>void autoTrim()}><Scissors size={14}/> 앞뒤 무음 자동 자르기</Button></div>
        <small className="muted-text">파일: {take.file}</small>
      </>:<p className="muted-text">아직 녹음이 없어요. 가운데의 녹음 버튼을 누르거나 녹음해 둔 파일을 불러오세요.</p>}
      <Button size="sm" kind="outline" onClick={()=>void importFile()} disabled={busy}><FileAudio size={14}/> 녹음해 둔 음성 파일 불러오기</Button>
    </Section>}
  </SidePanel>;
}
