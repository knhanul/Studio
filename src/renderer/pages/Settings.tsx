import {useEffect,useState} from 'react';
import {Check,Cpu,Palette,Plug} from 'lucide-react';
import type {EngineStatus,FfmpegStatus} from '../../shared/types';
import {Button,Field} from '../components/UI';
import {THEME_META,THEME_IDS,type ThemeId} from '../theme/theme';
import {useTheme} from '../theme/useTheme';

export function Settings({ffmpeg,onFfmpeg,toast}:{ffmpeg:FfmpegStatus|null;onFfmpeg:(s:FfmpegStatus)=>void;toast:(m:string,t?:'info'|'error'|'success')=>void}){
  const {theme,auto,setTheme,setAuto}=useTheme();
  const [engine,setEngine]=useState<EngineStatus|null>(null);const [repo,setRepo]=useState('');const [python,setPython]=useState('');
  useEffect(()=>{void window.compose.engine.status().then(s=>{setEngine(s);setRepo(s.repo);setPython(s.python);}).catch(()=>{});},[]);
  const pickFfmpeg=async()=>{const p=await window.compose.ffmpeg.pick();if(!p)return;const s=await window.compose.ffmpeg.configure(p);onFfmpeg(s);toast(s.ok?'FFmpeg를 연결했어요.':s.message,s.ok?'success':'error');};
  return <div className="settings-grid">
    <section className="panel"><div className="setting-head"><div className="setting-icon"><Cpu size={18}/></div><div><h3>영상 만들기 (FFmpeg)</h3><p>완성 영상을 만들 때 쓰는 프로그램이에요. 보통은 설치할 때 함께 들어와서 따로 할 일이 없어요.</p></div></div>
      <div className="setting-line"><strong>{ffmpeg?.ok?'사용 가능':'찾지 못함'}</strong><small>{ffmpeg?.message||'확인 중…'}</small></div>
      {ffmpeg?.ok&&<div className="setting-line"><strong>버전 {ffmpeg.version}</strong><small className="path-text">{ffmpeg.path}</small></div>}
      <div className="btn-row"><Button size="sm" kind="outline" onClick={()=>void pickFfmpeg()}>ffmpeg.exe 직접 지정</Button>{ffmpeg?.source==='custom'&&<Button size="sm" kind="ghost" onClick={()=>void window.compose.ffmpeg.configure('').then(onFfmpeg)}>기본값으로 되돌리기</Button>}<Button size="sm" kind="ghost" onClick={()=>void window.compose.ffmpeg.status().then(onFfmpeg)}>다시 확인</Button></div>
    </section>
    <section className="panel theme-settings-card"><div className="setting-head"><div className="setting-icon"><Palette size={18}/></div><div><h3>화면 테마</h3><p>고모 창작실과 같은 테마 4가지 중에서 고를 수 있어요.</p></div></div>
      <div className="theme-grid">{THEME_IDS.map((id:ThemeId)=><button type="button" key={id} className={`theme-card ${theme===id&&!auto?'selected':''}`} onClick={()=>{setAuto(false);setTheme(id);}}>
        <div className="theme-preview" data-theme={id}><div className="theme-preview-sidebar" style={{background:'var(--color-sidebar)'}}/><div className="theme-preview-main" style={{background:'var(--color-bg)'}}><div className="theme-preview-bar" style={{background:'var(--color-topbar)',borderColor:'var(--color-border)'}}/><div className="theme-preview-card" style={{background:'var(--color-surface)',borderColor:'var(--color-border)'}}/></div></div>
        <div className="theme-card-info"><strong>{THEME_META[id].name}</strong><span>{THEME_META[id].description}</span></div>{theme===id&&!auto&&<span className="theme-check"><Check size={12}/></span>}</button>)}</div>
      <label className="system-sync-row"><input type="checkbox" checked={auto} onChange={e=>setAuto(e.target.checked)}/> Windows 밝기 설정(라이트/다크)에 맞추기</label>
    </section>
    <details className="panel advanced-engine"><summary><Plug size={16}/> 고급: 기존 영상 합성기(Python) 연결 <small>필요할 때만</small></summary>
      <p className="muted-text">고모 편집실은 이제 혼자서 녹음하고 영상을 만들어요. 예전 영상 합성기(dubbing) 폴더를 연결하면 프로젝트 검사 같은 기존 기능을 함께 쓸 수 있어요.</p>
      <Field label="dubbing 소스 폴더"><div className="input-pick"><input value={repo} onChange={e=>setRepo(e.target.value)} placeholder="D:\projects\dubbing"/><Button size="sm" kind="outline" onClick={()=>void window.compose.engine.pickRepo().then(p=>p&&setRepo(p))}>찾기</Button></div></Field>
      <Field label="Python 실행 파일"><div className="input-pick"><input value={python} onChange={e=>setPython(e.target.value)} placeholder="D:\projects\dubbing\.venv\Scripts\python.exe"/><Button size="sm" kind="outline" onClick={()=>void window.compose.engine.pickPython().then(p=>p&&setPython(p))}>찾기</Button></div></Field>
      <div className="btn-row"><Button size="sm" onClick={()=>void window.compose.engine.configure({repo,python}).then(setEngine)}>저장</Button><Button size="sm" kind="outline" onClick={()=>void window.compose.engine.action('ping').then(()=>toast('기존 엔진과 연결됐어요.','success')).catch(e=>toast(e instanceof Error?e.message:String(e),'error'))}>연결 테스트</Button><small className="muted-text">{engine?.message}</small></div>
    </details>
  </div>;
}
