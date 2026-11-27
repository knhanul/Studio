import {createContext,useContext} from 'react';
import type {ComposerProject,SubtitleItem} from '../shared/types';
import type {timeline} from '../shared/project';
export type Track=ReturnType<typeof timeline>[number];
export interface EditorState{
  doc:ComposerProject;
  commit:(change:(p:ComposerProject)=>ComposerProject,label?:string)=>void;
  tracks:Track[];total:number;cues:SubtitleItem[];
  urls:Record<string,string>;
  playhead:number;seek:(t:number)=>void;playing:boolean;setPlaying:(v:boolean)=>void;
  selectedClip:number|null;setSelectedClip:(i:number|null)=>void;
  selectedCue:number|null;setSelectedCue:(index:number|null)=>void;
  toast:(msg:string,type?:'info'|'error'|'success')=>void;
  /** 미디어 보관함 열기 — clip: 그 장면 미디어 바꾸기 · music/effect: 소리 고르기 */
  openLibrary:(mode?:LibraryMode)=>void;
  selectedAudio:string|null;setSelectedAudio:(id:string|null)=>void;
  /** 여러 문장 고르기 (더빙: 문장 목록 체크 · 타임라인 Ctrl/Shift 클릭) */
  checkedCues:number[];setCheckedCues:(v:number[]|((c:number[])=>number[]))=>void;
  /** toggle: 하나 켜고 끄기 · range: 앞에 누른 문장부터 여기까지 · anchor: 체크는 그대로 두고 기준만 옮기기 */
  pickCue:(idx:number,mode:'toggle'|'range'|'anchor')=>void;
}
export type LibraryMode={kind:'browse'}|{kind:'clip';index:number}|{kind:'bgm'}|{kind:'music'}|{kind:'effect'};
export const EditorContext=createContext<EditorState|null>(null);
export function useEditor(){const v=useContext(EditorContext);if(!v)throw new Error('EditorContext 없음');return v;}
export const fileName=(file:string)=>file.split(/[\\/]/).pop()||file;
export const sec1=(n:number)=>`${(Math.round(n*10)/10).toFixed(1)}초`;
