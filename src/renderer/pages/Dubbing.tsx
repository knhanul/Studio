import {useCallback,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {Captions,ChevronLeft,Film,ChevronRight,Circle,FileAudio,ListChecks,Mic2,Play,RefreshCw,Repeat,Scissors,Square,Trash2,Wand2,X} from 'lucide-react';
import {DEFAULT_PAUSE,detectVoiceBounds,encodeWav,meterFraction,pauseStart,pauseStep,splitAtMarks,waveformPeaks,type PauseState} from '../../shared/audio';
import {applyTrim,dubWindows,fitTimelineToTakes,pictureTake,removeTakeForCue,round,setTakeForCue,sortCues,takeForCue,takeLength,timeline,type DubWindow} from '../../shared/project';
import type {DubbingTake,StepId} from '../../shared/types';
import {SidePanel,StepLayout} from '../components/Shell';
import {Timeline} from '../components/Timeline';
import {Button,Empty,Field,IconButton,Section,Segmented,Slider,Toggle} from '../components/UI';
import {useEditor} from '../editor';
import {loadBuffer,playMusicLayers,playTake} from '../hooks/usePreviewAudio';
import {Monitor} from '../components/Monitor';
import {useRecorder} from '../hooks/useRecorder';

type Phase='idle'|'countdown'|'recording'|'saving';
interface Opts{countdown:boolean;autoNext:boolean;autoTrim:boolean;autoFit:boolean;
  /** 연속 녹음: 쉬면 자동으로 다음 문장 · 쉬는 시간(초) */pauseNext:boolean;pauseSec:number;
  /** 영상 보며 녹음 (자막 시간 기준으로 문장이 넘어감) · 녹음 중 배경음악 듣기(헤드폰) */picture:boolean;listenBgm:boolean}
const OPTS_KEY='studio-dub-options';
const BASE_OPTS:Opts={countdown:true,autoNext:true,autoTrim:true,autoFit:true,pauseNext:true,pauseSec:1,picture:true,listenBgm:false};
const loadOpts=():Opts=>{try{return {...BASE_OPTS,...JSON.parse(localStorage.getItem(OPTS_KEY)||'{}')};}catch{return BASE_OPTS;}};
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
  const {doc,commit,urls,selectedCue,setSelectedCue,seek,toast,setPlaying,cues}=useEditor();
  const rec=useRecorder();
  const [phase,setPhase]=useState<Phase>('idle');const [count,setCount]=useState(0);const [elapsed,setElapsed]=useState(0);
  const [opts,setOpts]=useState<Opts>(loadOpts);
  const setOpt=<K extends keyof Opts>(k:K,v:Opts[K])=>setOpts(o=>{const n={...o,[k]:v};localStorage.setItem(OPTS_KEY,JSON.stringify(n));return n;});
  const items=useMemo(()=>sortCues(doc.subtitle.items||[]),[doc.subtitle.items]);
  /** 여러 문장 고르기 (체크) — 선택한 녹음 지우기 · 선택한 문장 연속 녹음 */
  const [checked,setChecked]=useState<number[]>([]);
  useEffect(()=>{setChecked(c=>c.filter(i=>items.some(x=>x.index===i)));},[items]);
  const [cont,setCont]=useState<Cont|null>(null);
  const contRef=useRef<(Cont&{marks:number[];pause:PauseState})|null>(null);
  const picRef=useRef<Pic|null>(null);const [clock,setClock]=useState<{from:number;startedAt:number}|null>(null);const stopMusic=useRef<(()=>void)|null>(null);
  const curIndex=selectedCue!=null&&items.some(c=>c.index===selectedCue)?selectedCue:(items.find(c=>!takeForCue(doc,c.index))||items[0])?.index??null;
  const pos=items.findIndex(c=>c.index===curIndex);const cur=items[pos];
  const next=cont?items.find(c=>c.index===cont.queue[cont.pos+1]):items[pos+1];
  const abort=useRef(false);const optsRef=useRef(opts);optsRef.current=opts;
  const startPictureRef=useRef<((q:number[],single:boolean)=>Promise<void>)|null>(null);
  const shown=(idx:number)=>cues.find(c=>c.index===idx);
  const focus=useCallback((idx:number)=>{setSelectedCue(idx);const c=cues.find(x=>x.index===idx);if(c)seek(c.start);},[cues,seek,setSelectedCue]);

  const begin=useCallback(async(idx:number,withCountdown:boolean)=>{
    if(optsRef.current.picture){void startPictureRef.current?.([idx],true);return;}
    setPlaying(false);abort.current=false;
    if(!rec.ready&&!(await rec.open()))return;
    focus(idx);
    if(withCountdown){setPhase('countdown');for(let n=3;n>=1;n--){if(abort.current){setPhase('idle');return;}setCount(n);rec.beep(n===1);await sleep(1000);}if(abort.current){setPhase('idle');return;}}
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
      commit(p=>{const n=setTakeForCue(p,take);return optsRef.current.autoFit?fitTimelineToTakes(n):n;});
      const after=items[items.findIndex(c=>c.index===idx)+1];
      if(mode==='next'&&after){void begin(after.index,false);return;}
      if(optsRef.current.autoNext&&after){void begin(after.index,optsRef.current.countdown);return;}
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
      if(takes.length)commit(p=>{let n=p;for(const t of takes)n=setTakeForCue(n,t);return optsRef.current.autoFit?fitTimelineToTakes(n):n;});
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
    if(optsRef.current.countdown){setPhase('countdown');for(let n=3;n>=1;n--){if(abort.current){setPhase('idle');setCont(null);return;}setCount(n);rec.beep(n===1);await sleep(1000);}if(abort.current){setPhase('idle');setCont(null);return;}}
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
    const tEnd=picNow(p);setClock(null);stopMusic.current?.();stopMusic.current=null;
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
      if(takes.length)commit(d=>{let n=d;for(const t of takes)n=setTakeForCue(n,t);return n;});
      const last=p.windows[p.windows.length-1].index;const after=items[items.findIndex(x=>x.index===last)+1];
      const all=tEnd>=p.windows[p.windows.length-1].end-.01;
      if(p.single&&all&&takes.length&&optsRef.current.autoNext&&after){void startPicture([after.index],true);return;}
      if(after&&all)focus(after.index);
      setPhase('idle');
      toast(takes.length?`문장 ${takes.length}개를 영상에 맞춰 저장했어요.${silent?` 목소리가 거의 없는 ${silent}개는 건너뛰었어요.`:''}`:'저장할 목소리가 없었어요. 마이크 입력을 확인해 주세요.',takes.length?'success':'error');
    }catch(e){setPhase('idle');toast(e instanceof Error?e.message:String(e),'error');}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[rec,commit,items,cues,focus,toast]);
  const startPicture=useCallback(async(queue:number[],single:boolean)=>{
    const q=items.filter(x=>queue.includes(x.index)).map(x=>x.index);if(!q.length)return;
    setPlaying(false);abort.current=false;
    if(!rec.ready&&!(await rec.open()))return;
    const windows=dubWindows(cues,q);if(!windows.length)return;
    const T0=windows[0].start;const from=Math.max(0,T0-(optsRef.current.countdown?3:1));
    const startedAt=performance.now();
    picRef.current={queue:q,windows,from,startedAt,T0,recT0:null,pos:0,single,lastCount:-1};
    setSelectedCue(q[0]);setCont(single?null:{queue:q,pos:0});setClock({from,startedAt});setPhase('countdown');setCount(0);
    if(optsRef.current.listenBgm){const c={from,startedAt};stopMusic.current=playMusicLayers(doc,urls,()=>picNow(c));}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[items,cues,rec,setPlaying,setSelectedCue,doc,urls]);
  startPictureRef.current=startPicture;
  // 화면 시계에 맞춰: 카운트다운 → 녹음 시작 → 자막 시간에 따라 문장 넘기기 → 마지막 문장 뒤에 끝내기
  useEffect(()=>{if(!clock)return;let raf=0;
    const tick=()=>{const p=picRef.current;if(!p)return;const t=picNow(p);
      if(p.recT0==null){const remain=p.T0-t;
        if(remain>0){const n=Math.ceil(remain);if(optsRef.current.countdown&&n!==p.lastCount&&n<=3){p.lastCount=n;setCount(n);rec.beep(n===1);}}
        else{rec.start();p.recT0=t;setPhase('recording');}}
      else{
        let k=p.windows.findIndex(w=>t<w.end);if(k<0){void finishPicture('save');return;}
        if(k!==p.pos){p.pos=k;if(!p.single)setCont({queue:p.queue,pos:k});setSelectedCue(p.windows[k].index);}
      }
      raf=requestAnimationFrame(tick);};
    raf=requestAnimationFrame(tick);return()=>cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[clock]);
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
    if(k==='r'){e.preventDefault();if(phase==='recording')void finish(curIndex!,'stop');else if(phase==='idle'&&curIndex!=null)void begin(curIndex,opts.countdown);}
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
  :<div className="editor-stack">
    <div className="mic-bar">
      <Mic2 size={16}/>
      <select aria-label="마이크 선택" value={rec.deviceId} onChange={e=>rec.choose(e.target.value)} disabled={busy}>{!rec.devices.length&&<option value="">기본 마이크</option>}{rec.devices.map(d=><option key={d.id} value={d.id}>{d.label}</option>)}</select>
      <LevelMeter db={rec.level} active={rec.ready}/>
      {rec.ready?<span className="mic-state on">마이크 켜짐</span>:<Button size="sm" kind="outline" onClick={()=>void rec.open()}>마이크 켜기</Button>}
      <span className="mic-progress">녹음 {recorded} / {items.length}</span>
    </div>
    {rec.error&&<div className="inline-notice error-notice">{rec.error}</div>}
    {opts.picture&&<div className={`dub-picture phase-${phase}`}>
      <DubMonitor clock={clock} idle={(cur?shown(cur.index)?.start??0:0)+.05}/>
      {clock&&phase==='countdown'&&count>0&&<div className="pic-countdown" aria-live="assertive"><b key={count}>{count}</b><span>화면이 문장에 닿으면 녹음이 시작돼요</span></div>}
      {clock&&phase==='recording'&&<span className="pic-rec"><i/>녹음 중 {elapsed.toFixed(1)}초</span>}
    </div>}
    <div className={`prompter phase-${phase} ${opts.picture?'compact':''}`}>
      {!opts.picture&&sc&&urls[sc.clip.file]&&sc.clip.type==='image'&&<img className="prompter-scene" src={urls[sc.clip.file]} alt=""/>}
      <div className="prompter-head"><span className="tag tag-accent">문장 {pos+1} / {items.length}</span>{cont&&<span className="tag tag-warning"><Repeat size={11}/> 연속 녹음 {cont.pos+1} / {cont.queue.length}</span>}{sc&&<span>장면 {sc.index+1}</span>}
        {phase==='recording'&&<span className="rec-badge"><i/>녹음 중 {elapsed.toFixed(1)}초</span>}
        {phase==='saving'&&<span className="tag">저장 중…</span>}
        {phase==='idle'&&cur&&takeForCue(doc,cur.index)&&<span className="tag tag-success">녹음됨 {takeLength(takeForCue(doc,cur.index)!).toFixed(1)}초</span>}</div>
      <p className="prompter-current">{cur?.text?.trim()||<em>(빈 문장 — 자막 단계에서 문구를 넣어 주세요)</em>}</p>
      <div className="prompter-next"><small>다음 문장</small><p>{next?next.text||'(빈 문장)':'마지막 문장이에요'}</p></div>
      {phase==='countdown'&&!clock&&<div className="countdown" aria-live="assertive"><b key={count}>{count}</b><span>준비하세요</span></div>}
    </div>
    <div className="dub-controls">
      <IconButton label="이전 문장" disabled={busy||pos<=0} onClick={()=>focus(items[pos-1].index)}><ChevronLeft size={18}/></IconButton>
      {clock
        ?<><button type="button" className="rec-button stop" onClick={()=>void finishPicture('save')} title="여기까지 저장하고 끝내기 (R)"><Square size={18}/> 끝내고 저장</button>
           <Button kind="ghost" onClick={cancel} title="저장하지 않고 취소 (Esc)"><X size={15}/> 취소</Button>
           <span className="pic-hint">자막 시간에 맞춰 다음 문장으로 넘어가요</span></>
        :phase==='recording'&&cont
        ?<><Button onClick={()=>advanceCont()} title="이 문장을 끝내고 다음 문장으로 — 녹음은 계속돼요 (N · Space · Enter)">{cont.pos+1<cont.queue.length?<>다음 문장 <ChevronRight size={16}/></>:'마지막 문장 끝내기'}</Button>
           <button type="button" className="rec-button stop" onClick={()=>void finishCont('save')} title="여기까지 저장하고 끝내기 (R)"><Square size={18}/> 끝내고 저장</button>
           <Button kind="ghost" onClick={cancel} title="모두 저장하지 않고 취소 (Esc)"><X size={15}/> 취소</Button></>
        :phase==='recording'
        ?<><button type="button" className="rec-button stop" onClick={()=>void finish(cur.index,'stop')} title="정지하고 저장 (R)"><Square size={18}/> 정지</button>
           <Button kind="secondary" disabled={!next} onClick={()=>void finish(cur.index,'next')} title="저장하고 바로 다음 문장 녹음 (N)">저장하고 다음 문장 <ChevronRight size={16}/></Button>
           <Button kind="ghost" onClick={cancel} title="저장하지 않고 취소 (Esc)"><X size={15}/> 취소</Button></>
        :phase==='countdown'?<Button kind="ghost" onClick={cancel}><X size={15}/> 취소</Button>
        :<button type="button" className="rec-button" disabled={busy||!cur} onClick={()=>void begin(cur.index,opts.countdown)} title="녹음 시작 (R)"><Circle size={16} fill="currentColor"/> {cur&&takeForCue(doc,cur.index)?'다시 녹음':'녹음 시작'}</button>}
      <IconButton label="다음 문장" disabled={busy||!next} onClick={()=>next&&focus(next.index)}><ChevronRight size={18}/></IconButton>
    </div>
    <div className="dub-options">
      <Toggle label="3초 카운트다운" checked={opts.countdown} onChange={v=>setOpt('countdown',v)}/>
      <Toggle label="다음 문장 이어서 녹음" checked={opts.autoNext} onChange={v=>setOpt('autoNext',v)}/>
      <Toggle label="앞뒤 무음 자동 자르기" checked={opts.autoTrim} onChange={v=>setOpt('autoTrim',v)}/>
      <Toggle label="영상 보며 녹음" checked={opts.picture} onChange={v=>setOpt('picture',v)} description={opts.picture?'자막 시간에 맞춰 문장이 넘어가고, 말한 위치 그대로 저장돼요':undefined}/>
      {opts.picture&&<Toggle label="배경음악 들으며 녹음 (헤드폰)" checked={opts.listenBgm} onChange={v=>setOpt('listenBgm',v)}/>}
      {!opts.picture&&<Toggle label="녹음 길이에 장면·자막 맞추기" checked={opts.autoFit} onChange={v=>setOpt('autoFit',v)}/>}
      {!opts.picture&&<Toggle label="연속 녹음: 쉬면 자동으로 다음 문장" checked={opts.pauseNext} onChange={v=>setOpt('pauseNext',v)}/>}
      {!opts.picture&&opts.pauseNext&&<span className="pause-pick"><small>쉬는 시간</small><Segmented label="쉬는 시간" value={opts.pauseSec} options={PAUSES} onChange={v=>setOpt('pauseSec',v)}/></span>}
      <span className="key-hint">{opts.picture?'단축키 R 녹음 시작·끝내고 저장 · Esc 취소':`단축키 R 녹음·정지 · N 다음 문장 · Esc 취소${cont?' · 연속 녹음 중 Space/Enter 다음 문장':''}`}</span>
    </div>
    <Timeline/>
  </div>;
  return <StepLayout header={header} actionBar={actionBar} panel={items.length?<DubbingPanel busy={busy} curIndex={curIndex} onRecord={idx=>void begin(idx,opts.countdown)} onFocus={focus} checked={checked} setChecked={setChecked} onRecordMany={q=>void startCont(q)}/>:undefined}>{main}</StepLayout>;
}

function DubbingPanel({busy,curIndex,onRecord,onFocus,checked,setChecked,onRecordMany}:{busy:boolean;curIndex:number|null;onRecord:(idx:number)=>void;onFocus:(idx:number)=>void;
  checked:number[];setChecked:(v:number[]|((c:number[])=>number[]))=>void;onRecordMany:(queue:number[])=>void}){
  const {doc,commit,urls,toast}=useEditor();
  const items=sortCues(doc.subtitle.items||[]);
  const anchor=useRef<number|null>(null);
  const sel=new Set(checked);
  /** 체크: 그냥 누르면 하나 켜고 끄기, Shift 를 누르고 누르면 앞에 누른 곳부터 여기까지 한 번에 */
  const toggle=(idx:number,shift:boolean)=>{
    const k=items.findIndex(c=>c.index===idx);
    if(shift&&anchor.current!=null){const a=items.findIndex(c=>c.index===anchor.current);if(a>=0){const [lo,hi]=a<k?[a,k]:[k,a];const range=items.slice(lo,hi+1).map(c=>c.index);const on=!sel.has(idx);
      setChecked(c=>on?[...new Set([...c,...range])]:c.filter(x=>!range.includes(x)));anchor.current=idx;return;}}
    anchor.current=idx;setChecked(c=>c.includes(idx)?c.filter(x=>x!==idx):[...c,idx]);
  };
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
    <div className="cue-select-bar">
      <span className="cue-select-count"><ListChecks size={14}/> {checked.length?`${checked.length}개 선택`:'문장을 체크해 여러 개 고르세요'}</span>
      <Button size="sm" kind="ghost" disabled={busy} onClick={()=>setChecked(items.map(c=>c.index))}>전체</Button>
      <Button size="sm" kind="ghost" disabled={busy} onClick={()=>setChecked(items.filter(c=>!takeForCue(doc,c.index)).map(c=>c.index))}>미녹음만</Button>
      <Button size="sm" kind="ghost" disabled={busy||!checked.length} onClick={()=>setChecked([])}>해제</Button>
    </div>
    {checked.length>0&&<div className="cue-select-actions">
      <Button size="sm" disabled={busy} onClick={()=>onRecordMany(checked)} title="마이크를 멈추지 않고 고른 문장을 차례로 녹음해요. 문장 사이에서 쉬거나 N·Space를 누르면 다음 문장으로 넘어가요"><Repeat size={14}/> 선택한 {checked.length}개 연속 녹음</Button>
      <Button size="sm" kind="danger" disabled={busy||!checkedTakes.length} onClick={removeChecked} title="선택한 문장의 녹음 연결을 지워요 (파일은 남겨 둬요)"><Trash2 size={14}/> 녹음 {checkedTakes.length}개 지우기</Button>
    </div>}
    <ol className="cue-list">{items.map((c,k)=>{const t=takeForCue(doc,c.index);const on=sel.has(c.index);return <li key={c.index} className={`${c.index===curIndex?'selected':''} ${on?'checked':''}`}>
      <label className="cue-check" title="여러 개 고르기 (Shift: 범위)" onClick={e=>{e.preventDefault();if(!busy)toggle(c.index,e.shiftKey);}}><input type="checkbox" checked={on} readOnly disabled={busy} aria-label={`문장 ${k+1} 고르기`}/></label>
      <button type="button" disabled={busy} onClick={e=>{if(e.ctrlKey||e.metaKey||e.shiftKey){toggle(c.index,e.shiftKey);return;}onFocus(c.index);}}>
      <span className="cue-num">{k+1}</span><span className="cue-text">{c.text||<em>(빈 문장)</em>}</span>{t?<span className="tag tag-success">{takeLength(t).toFixed(1)}초</span>:<span className="tag">미녹음</span>}</button></li>;})}</ol>
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
