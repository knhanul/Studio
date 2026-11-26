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
}
export const EditorContext=createContext<EditorState|null>(null);
export function useEditor(){const v=useContext(EditorContext);if(!v)throw new Error('EditorContext 없음');return v;}
export const fileName=(file:string)=>file.split(/[\\/]/).pop()||file;
export const sec1=(n:number)=>`${(Math.round(n*10)/10).toFixed(1)}초`;
