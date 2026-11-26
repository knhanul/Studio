export type ClipType='image'|'video';
export type Transition={type:string;duration:number};
export interface Clip {
  file:string;type:ClipType;duration?:number|null;fit_duration?:number|null;trim_start?:number;trim_end?:number|null;speed?:number;mute?:boolean;volume?:number;label?:string;
  motion?:string;motion_strength?:number;look?:string;brightness?:number;contrast?:number;saturation?:number;transition?:Transition|null;
  /** 고모 편집실이 FFmpeg로 읽어 둔 원본 영상 길이(초). 영상 합성기는 이 값을 몰라도 된다. */
  source_duration?:number|null;
  [key:string]:unknown
}
export interface SubtitleItem {index:number;start:number;end:number;text:string;style?:Record<string,unknown>|null}
export interface SubtitleStyle {font?:string;size?:number;color?:string;outline_color?:string;position?:string;outline?:number;bold?:boolean;margin_v?:number;box?:boolean;box_color?:string;box_opacity?:number;[key:string]:unknown}
export interface Subtitle {file?:string|null;items?:SubtitleItem[]|null;offset?:number;burn_in?:boolean;style?:SubtitleStyle;[key:string]:unknown}
export interface DubbingTake {file:string;subtitle?:number|null;offset?:number;volume?:number;trim_start?:number;trim_end?:number|null;/** 녹음 파일 전체 길이(초, 고모 편집실 기록용) */duration?:number|null;[key:string]:unknown}
export interface Bgm {file?:string|null;volume?:number;loop?:boolean;duck_under_voice?:boolean;duck_ratio?:number;fade_in?:number;fade_out?:number;start_offset?:number;file_start?:number;[key:string]:unknown}
export interface ComposerProject {
  version:number;title:string;clips:Clip[];output:{width:number;height:number;fps:number;fit:string;file:string;background?:string;[key:string]:unknown};
  transition:Transition;subtitle:Subtitle;bgm:Bgm;
  dubbing:{folder?:string;takes:DubbingTake[];volume?:number;latency_ms?:number;[key:string]:unknown};tracks?:Record<string,unknown>;[key:string]:unknown;
}
export interface ProjectState {path:string;data:ComposerProject;updatedAt:string;/** 창작실 패키지에서 불러온 경우 안내 문구 */notice?:string}
export interface RecentProject {path:string;title:string;openedAt:string}
export interface EngineStatus {connected:boolean;repo:string;python:string;message:string}
export interface EngineEvent {event:string;progress?:number;message?:string;duration?:number;path?:string}
export interface FfmpegStatus {ok:boolean;path:string;source:'custom'|'bundled'|'system'|'none';version:string;message:string}
export interface RenderEvent {phase:'progress'|'done'|'error'|'cancelled';progress:number;message:string;output?:string}
export type StepId='scenes'|'dubbing'|'subtitles'|'music'|'export';
export type View='home'|StepId|'settings';
