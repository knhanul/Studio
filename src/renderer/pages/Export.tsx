import {useEffect,useState,type ReactNode} from 'react';
import {AlertTriangle,CheckCircle2,Clapperboard,Clock3,ExternalLink,Film,FolderOpen,Loader2,Mic2,Music2,Captions,Settings2,X} from 'lucide-react';
import {fmt,round,takeForCue} from '../../shared/project';
import type {FfmpegStatus,RenderEvent} from '../../shared/types';
import {StepLayout} from '../components/Shell';
import {Button,Field,Toggle} from '../components/UI';
import {fileName,useEditor} from '../editor';

export interface RenderState{busy:boolean;draft:boolean;progress:number;message:string;output:string;error:string;phase:RenderEvent['phase']|'idle'}
const SIZES=[{id:'1920x1080',label:'가로 영상 1920×1080 (유튜브)'},{id:'1280x720',label:'가로 영상 1280×720 (가볍게)'},{id:'1080x1920',label:'세로 영상 1080×1920 (쇼츠·릴스)'},{id:'1080x1080',label:'정사각형 1080×1080'}];
function Kpi({icon,value,label,warn}:{icon:ReactNode;value:string;label:string;warn?:boolean}){return <div className={`kpi ${warn?'kpi-warn':''}`}><div className="kpi-icon">{icon}</div><div><strong>{value}</strong><span>{label}</span></div></div>;}
export function ExportStep({header,actionBar,render,onCancel,ffmpeg,openSettings}:{header:ReactNode;actionBar:ReactNode;render:RenderState;onCancel:()=>void;ffmpeg:FfmpegStatus|null;openSettings:()=>void}){
  const {doc,commit,total}=useEditor();
  const cues=doc.subtitle.items||[];const recorded=cues.filter(c=>takeForCue(doc,c.index)).length;
  const sizeId=`${doc.output.width}x${doc.output.height}`;
  const [resultUrl,setResultUrl]=useState('');
  useEffect(()=>{let dead=false;if(render.phase==='done'&&render.output)void window.compose.render.url(render.output).then(u=>{if(!dead)setResultUrl(u+'?t='+Date.now());});else if(render.busy)setResultUrl('');return()=>{dead=true;};},[render.phase,render.output,render.busy]);
  return <StepLayout header={header} actionBar={actionBar}>
    <div className="export-layout">
      <div className="export-main">
        <div className="dashboard-kpis export-kpis">
          <Kpi icon={<Clock3 size={18}/>} value={fmt(total)} label="영상 길이"/>
          <Kpi icon={<Film size={18}/>} value={`${doc.clips.length}개`} label="장면"/>
          <Kpi icon={<Mic2 size={18}/>} value={cues.length?`${recorded}/${cues.length}`:'없음'} label="녹음한 문장" warn={cues.length>0&&recorded<cues.length}/>
          <Kpi icon={<Captions size={18}/>} value={doc.subtitle.burn_in===false?'넣지 않음':cues.length?`${cues.length}개`:'없음'} label="자막"/>
          <Kpi icon={<Music2 size={18}/>} value={doc.bgm.file?'있음':'없음'} label="배경음악"/>
        </div>
        <div className="panel render-card">
          {render.phase==='idle'&&!render.busy&&<div className="render-empty"><Clapperboard size={30}/><div><strong>영상을 만들 준비가 됐어요</strong><p>먼저 아래 「미리보기 영상」으로 빠르게 확인하고, 괜찮으면 「완성 영상 만들기」를 눌러 주세요.</p></div></div>}
          {render.busy&&<div className="render-progress"><div className="render-progress-head"><Loader2 size={18} className="spin"/><strong>{render.draft?'미리보기 영상':'완성 영상'} 만드는 중</strong><span>{Math.round(render.progress*100)}%</span><Button size="sm" kind="ghost" onClick={onCancel}><X size={14}/> 취소</Button></div>
            <div className="progress-track"><span style={{width:`${Math.max(2,render.progress*100)}%`}}/></div><small>{render.message}</small></div>}
          {!render.busy&&render.phase==='done'&&<div className="render-done">
            <div className="render-done-head"><CheckCircle2 size={18}/><strong>{render.draft?'미리보기 영상':'완성 영상'}을 만들었어요</strong><span className="muted-text">{render.message}</span></div>
            {resultUrl&&<video className="result-video" src={resultUrl} controls preload="metadata"/>}
            <div className="btn-row"><Button size="sm" onClick={()=>void window.compose.render.open(render.output)}><ExternalLink size={14}/> 영상 열기</Button><Button size="sm" kind="outline" onClick={()=>void window.compose.render.reveal(render.output)}><FolderOpen size={14}/> 폴더에서 보기</Button><span className="path-text" title={render.output}>{fileName(render.output)}</span></div></div>}
          {!render.busy&&(render.phase==='error'||render.phase==='cancelled')&&<div className={`render-error ${render.phase}`}><AlertTriangle size={18}/><div><strong>{render.phase==='error'?'영상을 만들지 못했어요':'취소했어요'}</strong><pre>{render.error||render.message}</pre></div></div>}
        </div>
        {ffmpeg&&!ffmpeg.ok&&<div className="inline-notice error-notice"><AlertTriangle size={16}/><span>{ffmpeg.message}</span><Button size="sm" kind="outline" onClick={openSettings}><Settings2 size={14}/> 환경 설정</Button></div>}
      </div>
      <aside className="panel export-settings">
        <h3>출력 설정</h3>
        <Field label="화면 크기"><select value={SIZES.some(s=>s.id===sizeId)?sizeId:'custom'} disabled={render.busy} onChange={e=>{const [w,h]=e.target.value.split('x').map(Number);if(w&&h)commit(p=>{p.output.width=w;p.output.height=h;return p;});}}>{SIZES.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}{!SIZES.some(s=>s.id===sizeId)&&<option value="custom">지금 설정 {doc.output.width}×{doc.output.height}</option>}</select></Field>
        <Field label="초당 화면 수"><select value={String(doc.output.fps)} disabled={render.busy} onChange={e=>commit(p=>{p.output.fps=Number(e.target.value);return p;})}>{[24,25,30,60].map(f=><option key={f} value={f}>{f}fps{f===30?' (추천)':''}</option>)}</select></Field>
        <Field label="파일 이름" description="프로젝트 폴더 안에 저장돼요."><input value={doc.output.file} disabled={render.busy} onChange={e=>commit(p=>{p.output.file=e.target.value.replace(/[\\/:*?"<>|]/g,'');return p;})} onBlur={()=>{if(!/\.mp4$/i.test(doc.output.file))commit(p=>{p.output.file=(p.output.file||'output').replace(/\.[^.]*$/,'')+'.mp4';return p;});}}/></Field>
        <Toggle label="영상 처음에 서서히 밝아지기" checked={Number(doc.output.fade_in)>0} onChange={v=>commit(p=>{p.output.fade_in=v?1:0;return p;})}/>
        <Toggle label="영상 끝에 서서히 어두워지기" checked={Number(doc.output.fade_out)>0} onChange={v=>commit(p=>{p.output.fade_out=v?round(1.5,1):0;return p;})}/>
        <p className="muted-text small">미리보기 영상은 작은 화면으로 빠르게 만들어 「preview_gomo.mp4」로 저장해요.</p>
      </aside>
    </div>
  </StepLayout>;
}
