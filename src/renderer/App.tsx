import {useCallback,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {Captions,Check,ChevronDown,Clapperboard,Film,FolderInput,Home as HomeIcon,Info,Library,Mic2,Music2,Plus,Settings2,Sparkles,X} from 'lucide-react';
import {BRAND} from '../shared/brand';
import {projectCues,selectCues,sortCues,timeline,totalDuration} from '../shared/project';
import {STEP_HINTS,STEP_TITLES,STEPS,stepDone,stepGuide} from '../shared/steps';
import type {ComposerProject,FfmpegStatus,ProjectState,StepId,View} from '../shared/types';
import {ActionBar,DocHeader,SidePanel,StepLayout,type SaveState} from './components/Shell';
import {Button} from './components/UI';
import {EditorContext,type EditorState,type LibraryMode} from './editor';
import {MediaLibrary} from './components/MediaLibrary';
import {librarySummary} from '../shared/media';
import {usePreviewAudio} from './hooks/usePreviewAudio';
import brandLogoGomo from './assets/brand-logo-gomo.svg';
import brandLogoNuni from './assets/brand-logo-nuni.svg';
import {DubbingStep} from './pages/Dubbing';
import {ExportStep,type RenderState} from './pages/Export';
import {Home} from './pages/Home';
import {MusicStep} from './pages/Music';
import {ScenesMain,ScenesPanel,useAddScenes} from './pages/Scenes';
import {Settings} from './pages/Settings';
import {SubtitlesStep} from './pages/Subtitles';

type History={present:ComposerProject;past:ComposerProject[];future:ComposerProject[]};
const clone=<T,>(v:T):T=>JSON.parse(JSON.stringify(v)) as T;
const ICONS:Record<StepId,typeof Film>={scenes:Film,dubbing:Mic2,subtitles:Captions,music:Music2,export:Clapperboard};
const IDLE_RENDER:RenderState={busy:false,draft:false,progress:0,message:'',output:'',error:'',phase:'idle'};
const brandLogo=BRAND.id==='gomo'?brandLogoGomo:brandLogoNuni;
function BrandIcon({size=28}:{size?:number}){return <div className="brand-icon" style={{width:size,height:size}} aria-hidden="true"><img src={brandLogo} alt="" width={size} height={size}/></div>;}

function ScenesStep({header,actionBar}:{header:ReactNode;actionBar:ReactNode}){return <StepLayout header={header} actionBar={actionBar} panel={<ScenesPanel/>}><ScenesMain/></StepLayout>;}
function AddScenesButton(){const add=useAddScenes();return <Button size="sm" kind="outline" onClick={()=>void add()}><Plus size={14}/> 장면 추가</Button>;}
function LibraryButton({doc,onOpen}:{doc:ComposerProject;onOpen:()=>void}){const n=doc.media_library?.length||0;return <Button size="sm" kind="outline" onClick={onOpen} title={n?`미디어 보관함 · ${librarySummary(doc.media_library||[])}`:'미디어 보관함'}><Library size={14}/> 미디어 보관함{n?` ${n}`:''}</Button>;}

export default function App(){
  const [view,setView]=useState<View>('home');
  useEffect(()=>{document.title=BRAND.nameKo;},[]);
  const [opened,setOpened]=useState<ProjectState|null>(null);
  const [history,setHistory]=useState<History|null>(null);
  const [saveState,setSaveState]=useState<SaveState>('saved');
  const [urls,setUrls]=useState<Record<string,string>>({});
  const [playhead,setPlayhead]=useState(0);const playheadRef=useRef(0);
  const [playing,setPlayingState]=useState(false);const [startKey,setStartKey]=useState(0);const [startAt,setStartAt]=useState(0);
  const [selectedClip,setSelectedClip]=useState<number|null>(null);
  const [selectedCue,setSelectedCue]=useState<number|null>(null);
  const [selectedAudio,setSelectedAudio]=useState<string|null>(null);
  const [checkedCues,setCheckedCues]=useState<number[]>([]);const cueAnchor=useRef<number|null>(null);
  const [library,setLibrary]=useState<LibraryMode|null>(null);
  const [toastMsg,setToastMsg]=useState<{text:string;type:'info'|'error'|'success'}|null>(null);
  const [ffmpeg,setFfmpeg]=useState<FfmpegStatus|null>(null);
  const [render,setRender]=useState<RenderState>(IDLE_RENDER);
  const [version,setVersion]=useState('');
  const toastTimer=useRef(0);const saveTimer=useRef(0);const dirtyRef=useRef(false);const savingRef=useRef(false);
  const doc=history?.present||null;
  const docRef=useRef(doc);docRef.current=doc;
  const toast=useCallback((text:string,type:'info'|'error'|'success'='info')=>{setToastMsg({text,type});window.clearTimeout(toastTimer.current);toastTimer.current=window.setTimeout(()=>setToastMsg(null),type==='error'?7000:3800);},[]);
  const tracks=useMemo(()=>doc?timeline(doc):[],[doc]);
  const total=useMemo(()=>doc?totalDuration(doc):0,[doc]);
  const cues=useMemo(()=>doc?projectCues(doc):[],[doc]);

  // ── 저장 (창작실처럼 자동 저장) ──
  const saveNow=useCallback(async()=>{const d=docRef.current;if(!d||savingRef.current)return;savingRef.current=true;setSaveState('saving');
    try{const s=await window.compose.project.save(d);dirtyRef.current=docRef.current!==d;setOpened(o=>o?{...o,path:s.path,updatedAt:s.updatedAt}:s);setSaveState(dirtyRef.current?'pending':'saved');}
    catch(e){setSaveState('pending');toast(`저장하지 못했어요: ${e instanceof Error?e.message:String(e)}`,'error');}finally{savingRef.current=false;}},[toast]);
  const scheduleSave=useCallback(()=>{dirtyRef.current=true;setSaveState('pending');window.clearTimeout(saveTimer.current);saveTimer.current=window.setTimeout(()=>void saveNow(),900);},[saveNow]);
  const commit=useCallback((change:(p:ComposerProject)=>ComposerProject)=>{setHistory(prev=>{if(!prev)return prev;const next=change(clone(prev.present));return {present:next,past:[...prev.past.slice(-59),prev.present],future:[]};});scheduleSave();},[scheduleSave]);
  const undo=useCallback(()=>{setHistory(prev=>{if(!prev||!prev.past.length)return prev;const past=[...prev.past];const item=past.pop()!;return {present:item,past,future:[prev.present,...prev.future]};});scheduleSave();},[scheduleSave]);
  const redo=useCallback(()=>{setHistory(prev=>{if(!prev||!prev.future.length)return prev;const [item,...future]=prev.future;return {present:item,past:[...prev.past,prev.present],future};});scheduleSave();},[scheduleSave]);

  const load=useCallback((s:ProjectState)=>{setOpened(s);setHistory({present:clone(s.data),past:[],future:[]});dirtyRef.current=false;setSaveState('saved');setSelectedClip(s.data.clips.length?0:null);setSelectedCue(null);setSelectedAudio(null);setLibrary(null);setCheckedCues([]);cueAnchor.current=null;setPlayhead(0);playheadRef.current=0;setPlayingState(false);setRender(IDLE_RENDER);setView('scenes');toast(s.notice||`프로젝트를 열었어요: ${s.data.title}`,'success');},[toast]);
  const guard=async<T,>(op:()=>Promise<T>)=>{try{if(dirtyRef.current)await saveNow();return await op();}catch(e){toast(e instanceof Error?e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/,''):String(e),'error');return undefined;}};
  const openFolder=async()=>{const s=await guard(()=>window.compose.project.openFolder());if(s)load(s);};
  const openFile=async()=>{const s=await guard(()=>window.compose.project.open());if(s)load(s);};
  const openPath=async(p:string)=>{const s=await guard(()=>window.compose.project.openPath(p));if(s)load(s);};
  const newProject=async()=>{const s=await guard(()=>window.compose.project.create('새 편집 프로젝트'));if(s)load(s);};

  // ── 재생 ──
  const seek=useCallback((t:number)=>{const v=Math.max(0,Math.min(t,total));setPlayhead(v);playheadRef.current=v;if(playing){setStartAt(v);setStartKey(k=>k+1);}},[total,playing]);
  const setPlaying=useCallback((v:boolean)=>{if(v){let at=playheadRef.current;if(at>=total-.05)at=0;setPlayhead(at);playheadRef.current=at;setStartAt(at);setStartKey(k=>k+1);}setPlayingState(v);},[total]);
  useEffect(()=>{if(!playing||!total)return;let last=performance.now();let raf=0;const run=(now:number)=>{const dt=Math.min(.1,(now-last)/1000);last=now;const next=playheadRef.current+dt;if(next>=total){playheadRef.current=total;setPlayhead(total);setPlayingState(false);return;}playheadRef.current=next;setPlayhead(next);raf=requestAnimationFrame(run);};raf=requestAnimationFrame(run);return()=>cancelAnimationFrame(raf);},[playing,total]);
  usePreviewAudio({doc,urls,cues,playing,startAt,startKey,getPlayhead:()=>playheadRef.current});

  // ── 미디어 주소 ──
  const fileKey=doc?[...doc.clips.flatMap(c=>[c.file,c.poster||'']),doc.bgm.file||'',...doc.dubbing.takes.map(t=>t.file),...(doc.audio_cues||[]).map(c=>c.file),...(doc.media_library||[]).map(m=>m.file)].join('|'):'';
  useEffect(()=>{if(!opened||!fileKey)return;let dead=false;const files=[...new Set(fileKey.split('|').filter(Boolean))];void window.compose.media.urls(files).then(m=>{if(!dead)setUrls(m);}).catch(()=>{});return()=>{dead=true;};},[fileKey,opened?.path]);

  useEffect(()=>{void window.compose.ffmpeg.status().then(setFfmpeg).catch(()=>{});void window.compose.info().then(i=>setVersion(i.version)).catch(()=>{});},[]);
  useEffect(()=>window.compose.render.onEvent(ev=>{
    if(ev.phase==='progress')setRender(r=>({...r,busy:true,phase:'progress',progress:Math.max(r.progress,ev.progress),message:ev.message}));
    else if(ev.phase==='done'){setRender(r=>({...r,busy:false,phase:'done',progress:1,message:ev.message,output:ev.output||'',error:''}));toast('영상을 만들었어요!','success');}
    else setRender(r=>({...r,busy:false,phase:ev.phase,progress:0,message:ev.message,error:ev.phase==='error'?ev.message:''}));
  }),[toast]);
  const startRender=async(draft:boolean)=>{const d=docRef.current;if(!d)return;setPlayingState(false);setRender({...IDLE_RENDER,busy:true,draft,phase:'progress',message:'준비 중'});
    const r=await guard(()=>window.compose.render.start(d,draft));if(!r)setRender(IDLE_RENDER);};

  // ── 키보드 ──
  useEffect(()=>{const fn=(e:KeyboardEvent)=>{const inField=(e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]');const k=e.key.toLowerCase();
    if(e.ctrlKey&&k==='s'){e.preventDefault();void saveNow();}
    else if(e.ctrlKey&&k==='z'&&!inField){e.preventDefault();if(e.shiftKey)redo();else undo();}
    else if(e.ctrlKey&&k==='y'&&!inField){e.preventDefault();redo();}
    else if(e.key===' '&&!inField&&doc&&!library&&view!=='dubbing'&&view!=='export'&&view!=='home'&&view!=='settings'&&!(e.target as HTMLElement)?.closest('button')){e.preventDefault();setPlaying(!playing);}};
    window.addEventListener('keydown',fn);return()=>window.removeEventListener('keydown',fn);},[saveNow,undo,redo,doc,view,playing,setPlaying,library]);
  useEffect(()=>{const fn=(e:BeforeUnloadEvent)=>{if(dirtyRef.current){void saveNow();}void e;};window.addEventListener('beforeunload',fn);return()=>window.removeEventListener('beforeunload',fn);},[saveNow]);

  const go=(v:View)=>{if(v!=='home'&&v!=='settings'&&!doc){toast('먼저 창작실 작품이나 프로젝트를 열어 주세요.');return;}setPlayingState(false);setView(v);};
  const cueOrder=useMemo(()=>doc?sortCues(doc.subtitle.items||[]).map(c=>c.index):[],[doc]);
  useEffect(()=>{setCheckedCues(c=>{const n=c.filter(i=>cueOrder.includes(i));return n.length===c.length?c:n;});},[cueOrder]);
  const pickCue=useCallback((idx:number,mode:'toggle'|'range'|'anchor')=>{
    if(mode!=='anchor')setCheckedCues(c=>selectCues(cueOrder,c,idx,mode,cueAnchor.current));cueAnchor.current=idx;},[cueOrder]);
  const openLibrary=useCallback((mode:LibraryMode={kind:'browse'})=>{setPlayingState(false);setLibrary(mode);},[]);
  const editor:EditorState|null=doc?{doc,commit,tracks,total,cues,urls,playhead,seek,playing,setPlaying,selectedClip,setSelectedClip,selectedCue,setSelectedCue,toast,openLibrary,selectedAudio,setSelectedAudio,checkedCues,setCheckedCues,pickCue}:null;
  const projectTitle=doc?.title||'';
  const header=(step:StepId,actions?:ReactNode)=>{const Icon=ICONS[step];return <DocHeader icon={<Icon size={17}/>} title={STEP_TITLES[step]} projectTitle={projectTitle}
    chips={<span className="chip">{doc!.output.width}×{doc!.output.height}</span>} saveState={saveState} actions={actions}
    onUndo={undo} onRedo={redo} canUndo={!!history?.past.length} canRedo={!!history?.future.length} onOpenFolder={()=>void window.compose.project.reveal()}/>;};
  const bar=(step:StepId)=>{const g=stepGuide(doc!,step);
    if(step==='export')return <ActionBar guide={{...g,ready:g.ready&&!render.busy&&ffmpeg?.ok!==false}} busy={render.busy} primaryLabel="완성 영상 만들기" onNext={()=>void startRender(false)} secondary={<Button kind="outline" disabled={render.busy||!g.ready||ffmpeg?.ok===false} onClick={()=>void startRender(true)}>미리보기 영상 (빠르게)</Button>}/>;
    return <ActionBar guide={g} onNext={()=>g.next&&go(g.next)}/>;};

  let body:ReactNode;
  if(view==='home')body=<div className="step-layout"><DocHeader icon={<HomeIcon size={17}/>} title="시작하기"/><div className="workspace"><div className="workspace-main page-scroll"><Home onOpenFolder={()=>void openFolder()} onOpenFile={()=>void openFile()} onOpenPath={p=>void openPath(p)} onNew={()=>void newProject()}/></div></div></div>;
  else if(view==='settings')body=<div className="step-layout"><DocHeader icon={<Settings2 size={17}/>} title="환경 설정"/><div className="workspace"><div className="workspace-main page-scroll"><Settings ffmpeg={ffmpeg} onFfmpeg={setFfmpeg} toast={toast}/></div></div></div>;
  else if(!doc)body=<StepLayout header={<DocHeader icon={<Info size={17}/>} title="프로젝트 없음"/>} panel={<SidePanel title="안내"><p/></SidePanel>}><div/></StepLayout>;
  else if(view==='scenes')body=<ScenesStep header={header('scenes',<><LibraryButton doc={doc} onOpen={()=>openLibrary()}/><AddScenesButton/></>)} actionBar={bar('scenes')}/>;
  else if(view==='dubbing')body=<DubbingStep header={header('dubbing')} actionBar={bar('dubbing')} goto={s=>go(s)}/>;
  else if(view==='subtitles')body=<SubtitlesStep header={header('subtitles')} actionBar={bar('subtitles')}/>;
  else if(view==='music')body=<MusicStep header={header('music',<LibraryButton doc={doc} onOpen={()=>openLibrary({kind:'music'})}/>)} actionBar={bar('music')}/>;
  else body=<ExportStep header={header('export')} actionBar={bar('export')} render={render} onCancel={()=>void window.compose.render.cancel()} ffmpeg={ffmpeg} openSettings={()=>go('settings')}/>;

  const done=doc?STEPS.filter(s=>stepDone(doc,s)).length:0;
  return <EditorContext.Provider value={editor}>
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-area"><BrandIcon size={28}/><div><strong>{BRAND.nameKo}</strong><small>{BRAND.nameEn}</small></div></div>
        <div className="sidebar-project">
          <button className="current-project" onClick={()=>go('home')} title="다른 작품 열기"><FolderInput size={15}/><div><small>현재 작품</small><strong>{doc?projectTitle||'제목 없음':'열린 작품 없음'}</strong></div><ChevronDown size={14}/></button>
          <Button size="sm" onClick={()=>void openFolder()} title="고모 창작실에서 내보낸 제작 패키지 폴더를 엽니다"><FolderInput size={14}/> 창작실 작품 불러오기</Button>
        </div>
        <div className="nav-groups"><div className="nav-label">작업 공간</div>
          <button className={`nav-link ${view==='home'?'active':''}`} onClick={()=>go('home')}><HomeIcon size={17}/><span>시작하기</span></button>
          <div className="nav-label nav-separator">편집 단계</div>
          {STEPS.map((id,i)=>{const Icon=ICONS[id];const ok=!!doc&&stepDone(doc,id);return <button key={id} className={`nav-link step-link ${view===id?'active':''} ${!doc?'disabled-link':''} ${ok?'done':''}`} onClick={()=>go(id)} title={doc?STEP_HINTS[id]:'작품을 먼저 열어 주세요'}><span className="step-num">{ok?<Check size={12}/>:i+1}</span><Icon size={16}/><span>{STEP_TITLES[id]}</span></button>;})}
        </div>
        <div className="sidebar-bottom"><button className={`nav-link ${view==='settings'?'active':''}`} onClick={()=>go('settings')}><Settings2 size={17}/> <span>환경 설정</span></button></div>
      </aside>
      <div className="main-shell">
        <main className="main-content">{body}</main>
        <footer className="statusbar">
          <div className={`status-save save-${doc?saveState:'saved'}`}><span className="status-indicator"/>{doc?`${saveState==='saved'?'자동 저장됨':saveState==='saving'?'저장 중…':'저장 대기'} · ${opened?.path.split(/[\\/]/).pop()||''}`:'모든 작업은 이 컴퓨터에 저장돼요'}</div>
          {doc&&<div className="status-mid"><span>장면 {doc.clips.length}개</span><span>자막 {doc.subtitle.items?.length||0}개</span><span title="완료한 편집 단계">{done}/{STEPS.length-1} 단계</span></div>}
          <div className="status-right">{render.busy&&<button className="status-job" onClick={()=>go('export')}><Sparkles size={12}/> 영상 만드는 중 {Math.round(render.progress*100)}%</button>}<span>FFmpeg {ffmpeg?.ok?'준비됨':'확인 필요'}</span><span>{BRAND.nameKo} v{version||'—'}</span></div>
        </footer>
      </div>
      {library&&doc&&<MediaLibrary mode={library} onClose={()=>setLibrary(null)}/>}
      {toastMsg&&<div className={`toast toast-${toastMsg.type}`} role="status"><Info size={17}/><span>{toastMsg.text}</span><button className="icon-btn" onClick={()=>setToastMsg(null)} aria-label="닫기"><X size={16}/></button></div>}
    </div>
  </EditorContext.Provider>;
}
