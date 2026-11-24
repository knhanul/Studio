export type ClipType='image'|'video';
export type Transition={type:string;duration:number};
export interface Clip {file:string;type:ClipType;duration?:number|null;fit_duration?:number|null;trim_start?:number;trim_end?:number|null;speed?:number;mute?:boolean;volume?:number;label?:string;motion?:string;motion_strength?:number;look?:string;brightness?:number;contrast?:number;saturation?:number;transition?:Transition|null;[key:string]:unknown}
export interface SubtitleItem {index:number;start:number;end:number;text:string;style?:Record<string,unknown>|null}
export interface Subtitle {file?:string|null;items?:SubtitleItem[]|null;offset?:number;burn_in?:boolean;style?:{font?:string;size?:number;color?:string;position?:string;outline?:number;box?:boolean;[key:string]:unknown};[key:string]:unknown}
export interface DubbingTake {file:string;subtitle?:number|null;offset?:number;volume?:number;trim_start?:number;trim_end?:number|null;[key:string]:unknown}
export interface ComposerProject {
  version:number;title:string;clips:Clip[];output:{width:number;height:number;fps:number;fit:string;file:string;[key:string]:unknown};
  transition:Transition;subtitle:Subtitle;bgm:{file?:string|null;volume?:number;loop?:boolean;duck_under_voice?:boolean;[key:string]:unknown};
  dubbing:{folder?:string;takes:DubbingTake[];[key:string]:unknown};tracks?:Record<string,unknown>;[key:string]:unknown;
}
export interface ProjectState {path:string;data:ComposerProject;updatedAt:string}
export interface EngineStatus {connected:boolean;repo:string;python:string;message:string}
export interface EngineEvent {event:string;progress?:number;message?:string;duration?:number;path?:string}
export type EditorMode='media'|'subtitles'|'recording'|'effects'|'export'|'settings';
