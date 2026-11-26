import {type ReactNode} from 'react';
import {ArrowRight,CheckCircle2,FolderOpen,Loader2,Redo2,ShieldAlert,Undo2} from 'lucide-react';
import type {StepGuide} from '../../shared/steps';
import {Button} from './UI';

export type SaveState='saved'|'saving'|'pending';
export const SAVE_LABEL:Record<SaveState,string>={saved:'자동 저장됨',saving:'저장 중…',pending:'변경됨'};

/** 화면 맨 위 한 줄: 화면 이름 · 프로젝트 이름 · 저장 상태 · 화면별 버튼 · 작업 폴더 (창작실 DocHeader와 같은 틀) */
export function DocHeader({icon,title,projectTitle,chips,saveState,actions,onUndo,onRedo,canUndo,canRedo,onOpenFolder}:{
  icon:ReactNode;title:string;projectTitle?:string;chips?:ReactNode;saveState?:SaveState;actions?:ReactNode;
  onUndo?:()=>void;onRedo?:()=>void;canUndo?:boolean;canRedo?:boolean;onOpenFolder?:()=>void;
}){
  return <header className="doc-header">
    <div className="doc-title">
      <span className="doc-icon">{icon}</span><strong>{title}</strong>
      {projectTitle!=null&&<><span className="doc-sep">/</span><span className="doc-project">{projectTitle}</span>{chips}</>}
    </div>
    <div className="doc-actions">
      {actions}
      {onUndo&&<button type="button" className="icon-btn" title="실행 취소 (Ctrl+Z)" aria-label="실행 취소" disabled={!canUndo} onClick={onUndo}><Undo2 size={16}/></button>}
      {onRedo&&<button type="button" className="icon-btn" title="다시 실행 (Ctrl+Y)" aria-label="다시 실행" disabled={!canRedo} onClick={onRedo}><Redo2 size={16}/></button>}
      {saveState&&<span className={`save-state save-${saveState}`} aria-live="polite">{saveState==='saving'?<Loader2 size={13} className="spin"/>:saveState==='saved'?<CheckCircle2 size={13}/>:<span className="dot"/>}{SAVE_LABEL[saveState]}</span>}
      {onOpenFolder&&<Button kind="outline" size="sm" title="이 프로젝트 파일이 있는 폴더를 엽니다" onClick={onOpenFolder}><FolderOpen size={14}/> 작업 폴더</Button>}
    </div>
  </header>;
}

/** 단계 화면 아래 고정 줄: 왼쪽 = 지금 할 일, 오른쪽 = 다음 단계 버튼 하나 (이동 버튼은 여기 한 곳뿐) */
export function ActionBar({guide,onNext,primaryLabel,secondary,busy=false}:{guide:StepGuide;onNext:()=>void;primaryLabel?:string;secondary?:ReactNode;busy?:boolean}){
  const tip=guide.ready?'':`아직 필요한 것: ${guide.missing.join(', ')}`;
  return <footer className={`action-bar ${guide.ready?'is-ready':''}`}>
    <div className="action-hint">{guide.ready?<CheckCircle2 size={16}/>:<ShieldAlert size={16}/>}<span>{guide.hint}</span>{!guide.ready&&guide.missing.length>0&&<small>필요: {guide.missing.join(' · ')}</small>}</div>
    <div className="action-buttons">
      {secondary}
      <span title={tip} className="action-primary-wrap"><Button onClick={onNext} disabled={!guide.ready||busy}>{primaryLabel||guide.nextLabel} {guide.next&&<ArrowRight size={16}/>}</Button></span>
    </div>
  </footer>;
}

export function StepLayout({header,panel,actionBar,children,fill=false}:{header:ReactNode;panel?:ReactNode;actionBar?:ReactNode;children:ReactNode;fill?:boolean}){
  return <div className="step-layout">{header}<div className="workspace"><div className={`workspace-main ${fill?'is-fill':''}`}>{children}</div>{panel}</div>{actionBar}</div>;
}
export function SidePanel({title,children,className='',head}:{title:string;children:ReactNode;className?:string;head?:ReactNode}){
  return <aside className={`side-panel ${className}`} aria-label={title}><div className="side-panel-head"><strong>{title}</strong>{head}</div><div className="side-panel-body">{children}</div></aside>;
}
