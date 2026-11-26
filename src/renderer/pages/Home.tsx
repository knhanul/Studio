import {useEffect,useState,type DragEvent} from 'react';
import {Clapperboard,FileJson,FolderInput,Mic2,Music2,Plus,Captions,Film,Clock3} from 'lucide-react';
import type {RecentProject} from '../../shared/types';
import {Button} from '../components/UI';

const FLOW=[{icon:Film,t:'장면 구성',d:'창작실 장면의 순서·길이·움직임 확인'},{icon:Mic2,t:'더빙 녹음',d:'카운트다운 후 문장별 마이크 녹음'},{icon:Captions,t:'자막 다듬기',d:'문구·시간·모양 정리'},{icon:Music2,t:'배경음악',d:'목소리와 음악 크기 맞추기'},{icon:Clapperboard,t:'영상 내보내기',d:'완성 MP4 만들기'}];
export function Home({onOpenFolder,onOpenFile,onOpenPath,onNew}:{onOpenFolder:()=>void;onOpenFile:()=>void;onOpenPath:(p:string)=>void;onNew:()=>void}){
  const [recent,setRecent]=useState<RecentProject[]>([]);const [over,setOver]=useState(false);
  useEffect(()=>{void window.compose.project.recent().then(setRecent).catch(()=>setRecent([]));},[]);
  const drop=(e:DragEvent)=>{e.preventDefault();setOver(false);const f=e.dataTransfer.files[0];if(!f)return;const p=window.compose.project.pathOf(f);if(p)onOpenPath(p);};
  return <div className="home">
    <section className="home-hero">
      <div><div className="eyebrow">고모 미디어공방 · 고모 창작실과 한 세트</div><h1>창작실에서 만든 작품에<br/>목소리를 입혀 영상으로 완성해요</h1><p>장면·자막·배경음악이 담긴 창작실 제작 패키지를 불러와 더빙하고, 바로 MP4 영상으로 내보낼 수 있어요.</p></div>
      <div className={`drop-zone ${over?'is-over':''}`} onDragOver={e=>{e.preventDefault();setOver(true);}} onDragLeave={()=>setOver(false)} onDrop={drop}>
        <FolderInput size={30}/><strong>창작실 제작 패키지 폴더를 여기에 끌어다 놓으세요</strong><small>창작실 「더빙 전달」에서 내보낸 폴더 — 장면별 이미지·영상·여러 배경음악을 미디어 보관함으로 모두 불러와요</small>
        <div className="btn-row center"><Button onClick={onOpenFolder}><FolderInput size={16}/> 창작실 작품 불러오기</Button><Button kind="outline" onClick={onOpenFile}><FileJson size={16}/> 프로젝트 파일 열기</Button><Button kind="ghost" onClick={onNew}><Plus size={16}/> 빈 프로젝트</Button></div>
      </div>
    </section>
    <section className="home-flow">{FLOW.map((f,i)=><div key={f.t} className="flow-step"><span className="step-num">{i+1}</span><f.icon size={18}/><div><strong>{f.t}</strong><small>{f.d}</small></div></div>)}</section>
    <section className="panel home-recent"><h3>최근 작업</h3>{recent.length?<div className="project-list">{recent.map(r=><article className="project-row" key={r.path}><div className="row-icon"><Clock3 size={17}/></div><div className="row-primary"><h3>{r.title}</h3><p title={r.path}>{r.path}</p></div><span className="row-muted">{new Date(r.openedAt).toLocaleString('ko-KR',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span><Button size="sm" kind="secondary" onClick={()=>onOpenPath(r.path)}>열기</Button></article>)}</div>:<p className="muted-text">아직 연 프로젝트가 없어요.</p>}</section>
  </div>;
}
