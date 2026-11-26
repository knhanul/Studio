import {useCallback,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {Captions,ChevronLeft,ChevronRight,Circle,FileAudio,Mic2,Play,RefreshCw,Scissors,Square,Trash2,Wand2,X} from 'lucide-react';
import {detectVoiceBounds,encodeWav,meterFraction,waveformPeaks} from '../../shared/audio';
import {applyTrim,fitTimelineToTakes,removeTakeForCue,round,setTakeForCue,sortCues,takeForCue,takeLength,timeline} from '../../shared/project';
import type {DubbingTake,StepId} from '../../shared/types';
import {SidePanel,StepLayout} from '../components/Shell';
import {Timeline} from '../components/Timeline';
import {Button,Empty,Field,IconButton,Section,Slider,Toggle} from '../components/UI';
import {useEditor} from '../editor';
import {loadBuffer,playTake} from '../hooks/usePreviewAudio';
import {useRecorder} from '../hooks/useRecorder';

type Phase='idle'|'countdown'|'recording'|'saving';
interface Opts{countdown:boolean;autoNext:boolean;autoTrim:boolean;autoFit:boolean}
const OPTS_KEY='studio-dub-options';
const loadOpts=():Opts=>{try{return {countdown:true,autoNext:true,autoTrim:true,autoFit:true,...JSON.parse(localStorage.getItem(OPTS_KEY)||'{}')};}catch{return {countdown:true,autoNext:true,autoTrim:true,autoFit:true};}};
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
  const setOpt=(k:keyof Opts,v:boolean)=>setOpts(o=>{const n={...o,[k]:v};localStorage.setItem(OPTS_KEY,JSON.stringify(n));return n;});
  const items=useMemo(()=>sortCues(doc.subtitle.items||[]),[doc.subtitle.items]);
  const curIndex=selectedCue!=null&&items.some(c=>c.index===selectedCue)?selectedCue:(items.find(c=>!takeForCue(doc,c.index))||items[0])?.index??null;
  const pos=items.findIndex(c=>c.index===curIndex);const cur=items[pos];const next=items[pos+1];
  const abort=useRef(false);const optsRef=useRef(opts);optsRef.current=opts;
  const shown=(idx:number)=>cues.find(c=>c.index===idx);
  const focus=useCallback((idx:number)=>{setSelectedCue(idx);const c=cues.find(x=>x.index===idx);if(c)seek(c.start);},[cues,seek,setSelectedCue]);

  const begin=useCallback(async(idx:number,withCountdown:boolean)=>{
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
  const cancel=()=>{abort.current=true;if(phase==='recording')void finish(curIndex!,'discard');else setPhase('idle');};
  useEffect(()=>{if(phase!=='recording')return;let raf=0;const t=()=>{setElapsed(rec.elapsed());raf=requestAnimationFrame(t);};raf=requestAnimationFrame(t);return()=>cancelAnimationFrame(raf);},[phase,rec]);
  // 키보드: R = 녹음/정지, N = 저장하고 다음 문장, Esc = 취소
  useEffect(()=>{const fn=(e:KeyboardEvent)=>{if((e.target as HTMLElement)?.closest('input,textarea,select'))return;const k=e.key.toLowerCase();
    if(k==='r'){e.preventDefault();if(phase==='recording')void finish(curIndex!,'stop');else if(phase==='idle'&&curIndex!=null)void begin(curIndex,opts.countdown);}
    else if(k==='n'&&phase==='recording'){e.preventDefault();void finish(curIndex!,'next');}
    else if(k==='escape'&&(phase==='recording'||phase==='countdown')){e.preventDefault();cancel();}};
    window.addEventListener('keydown',fn);return()=>window.removeEventListener('keydown',fn);});
  useEffect(()=>()=>{abort.current=true;},[]);

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
    <div className={`prompter phase-${phase}`}>
      {sc&&urls[sc.clip.file]&&sc.clip.type==='image'&&<img className="prompter-scene" src={urls[sc.clip.file]} alt=""/>}
      <div className="prompter-head"><span className="tag tag-accent">문장 {pos+1} / {items.length}</span>{sc&&<span>장면 {sc.index+1}</span>}
        {phase==='recording'&&<span className="rec-badge"><i/>녹음 중 {elapsed.toFixed(1)}초</span>}
        {phase==='saving'&&<span className="tag">저장 중…</span>}
        {phase==='idle'&&cur&&takeForCue(doc,cur.index)&&<span className="tag tag-success">녹음됨 {takeLength(takeForCue(doc,cur.index)!).toFixed(1)}초</span>}</div>
      <p className="prompter-current">{cur?.text?.trim()||<em>(빈 문장 — 자막 단계에서 문구를 넣어 주세요)</em>}</p>
      <div className="prompter-next"><small>다음 문장</small><p>{next?next.text||'(빈 문장)':'마지막 문장이에요'}</p></div>
      {phase==='countdown'&&<div className="countdown" aria-live="assertive"><b key={count}>{count}</b><span>준비하세요</span></div>}
    </div>
    <div className="dub-controls">
      <IconButton label="이전 문장" disabled={busy||pos<=0} onClick={()=>focus(items[pos-1].index)}><ChevronLeft size={18}/></IconButton>
      {phase==='recording'
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
      <Toggle label="녹음 길이에 장면·자막 맞추기" checked={opts.autoFit} onChange={v=>setOpt('autoFit',v)}/>
      <span className="key-hint">단축키 R 녹음·정지 · N 다음 문장 · Esc 취소</span>
    </div>
    <Timeline/>
  </div>;
  return <StepLayout header={header} actionBar={actionBar} panel={items.length?<DubbingPanel busy={busy} curIndex={curIndex} onRecord={idx=>void begin(idx,opts.countdown)} onFocus={focus}/>:undefined}>{main}</StepLayout>;
}

function DubbingPanel({busy,curIndex,onRecord,onFocus}:{busy:boolean;curIndex:number|null;onRecord:(idx:number)=>void;onFocus:(idx:number)=>void}){
  const {doc,commit,urls,toast}=useEditor();
  const items=sortCues(doc.subtitle.items||[]);
  const take=curIndex!=null?takeForCue(doc,curIndex):undefined;
  const stopRef=useRef<(()=>void)|null>(null);
  const listen=async(t:DubbingTake)=>{stopRef.current?.();try{stopRef.current=await playTake(urls[t.file],Number(t.trim_start)||0,t.trim_end??null,t.volume==null?1:Number(t.volume));}catch(e){toast(e instanceof Error?e.message:String(e),'error');}};
  const patchTake=(x:Partial<DubbingTake>)=>{if(curIndex==null||!take)return;commit(p=>setTakeForCue(p,{...take,...x}));};
  const autoTrim=async()=>{if(!take)return;const b=await loadBuffer(urls[take.file]);if(!b)return toast('녹음 파일을 읽지 못했어요.','error');const r=detectVoiceBounds(b.getChannelData(0),b.sampleRate);if(!r)return toast('목소리 구간을 찾지 못했어요.','error');commit(p=>setTakeForCue(p,applyTrim({...take,duration:take.duration??round(b.duration)},r.start,r.end)));toast('앞뒤 무음을 잘라냈어요.','success');};
  const importFile=async()=>{if(curIndex==null)return;const r=await window.compose.take.import(curIndex);if(!r)return;commit(p=>setTakeForCue(p,{file:r.file,subtitle:curIndex,offset:0,volume:1,duration:r.duration?round(r.duration):null}));toast('음성 파일을 이 문장에 연결했어요.','success');};
  return <SidePanel title="문장별 녹음" className="wide-panel" head={<Button size="sm" kind="ghost" title="녹음된 길이에 맞춰 이미지 장면 길이와 자막 시간을 다시 계산해요" onClick={()=>{commit(p=>fitTimelineToTakes(p));toast('녹음 길이에 맞춰 장면과 자막 시간을 맞췄어요.','success');}}><Wand2 size={14}/> 길이 맞추기</Button>}>
    <ol className="cue-list">{items.map((c,k)=>{const t=takeForCue(doc,c.index);return <li key={c.index} className={c.index===curIndex?'selected':''}><button type="button" disabled={busy} onClick={()=>onFocus(c.index)}>
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
