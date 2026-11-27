export type ClipType='image'|'video';
export type Transition={type:string;duration:number;/** 창작실 표시용 전환 이름 */effect?:string};
export interface Clip {
  file:string;type:ClipType;duration?:number|null;fit_duration?:number|null;trim_start?:number;trim_end?:number|null;speed?:number;mute?:boolean;volume?:number;label?:string;
  motion?:string;motion_strength?:number;look?:string;brightness?:number;contrast?:number;saturation?:number;transition?:Transition|null;
  /** 고모 편집실이 FFmpeg로 읽어 둔 원본 영상 길이(초). 영상 합성기는 이 값을 몰라도 된다. */
  source_duration?:number|null;
  /** 창작실 장면 ID (S04 등) — 같은 장면의 다른 미디어(이미지·영상·다시 만든 버전)를 찾을 때 쓴다 */
  scene_id?:string|null;
  /** 영상 장면의 기준 이미지(창작실 이미지→동영상). 썸네일·대체 화면·앞 장면 넣기에 쓴다 */
  poster?:string|null;
  /** 창작실 효과 규격(gomo.effects.v1): 장면 안 샷 순서(0부터) */
  shot_index?:number;
  /** 초점 다가가기·물러나기의 목표 위치 (0~1, 왼쪽 위 기준) */
  motion_focus?:{x:number;y:number}|null;
  /** 분위기 효과 · 세기(0~1) · 색감 */
  overlay?:string|null;overlay_strength?:number;tone?:string|null;
  [key:string]:unknown
}
export interface SubtitleItem {index:number;start:number;end:number;text:string;style?:Record<string,unknown>|null}
export interface SubtitleStyle {font?:string;size?:number;color?:string;outline_color?:string;position?:string;outline?:number;bold?:boolean;margin_v?:number;box?:boolean;box_color?:string;box_opacity?:number;[key:string]:unknown}
export interface Subtitle {file?:string|null;items?:SubtitleItem[]|null;offset?:number;burn_in?:boolean;style?:SubtitleStyle;[key:string]:unknown}
export interface DubbingTake {file:string;subtitle?:number|null;offset?:number;volume?:number;trim_start?:number;trim_end?:number|null;/** 녹음 파일 전체 길이(초, 고모 편집실 기록용) */duration?:number|null;[key:string]:unknown}
export interface Bgm {file?:string|null;volume?:number;loop?:boolean;duck_under_voice?:boolean;duck_ratio?:number;fade_in?:number;fade_out?:number;start_offset?:number;file_start?:number;
  /** 배경음악이 끝나는 타임라인 시각(초). 비우면 영상 끝까지 — 중간에 다른 음악으로 바꿀 때 쓴다 */
  end?:number|null;[key:string]:unknown}
export type MediaKind='image'|'video'|'audio';
/** 미디어 보관함 항목의 쓰임새: 장면에 연결됨 · 영상 장면의 기준 이미지 · 같은 장면의 다른 버전 · 배경음악 · 그 밖의 소리 · 장면과 상관없는 파일 */
export type MediaRole='scene'|'reference'|'alternate'|'bgm'|'audio'|'extra';
export interface MediaItem {
  /** 프로젝트 기준 상대 경로 (항목 구분 키) */
  file:string;kind:MediaKind;name:string;role:MediaRole;
  scene_id?:string|null;scene_title?:string|null;scene_order?:number|null;
  /** 다시 만든 버전 번호 (S04_image_v2 → 2, 원본 1) */
  version?:number;
  /** 창작실 패키지 · 폴더에서 찾음 · 직접 가져옴 */
  source?:'creator'|'folder'|'import';
  duration?:number|null;
  [key:string]:unknown
}
/** 배경음악 말고 타임라인 원하는 위치에 놓는 소리 (장면별 음악 바꾸기·효과음) */
export interface AudioCue {
  id:string;file:string;label?:string;kind:'music'|'effect';
  /** 타임라인 시작 시각(초) */start:number;
  /** 타임라인 끝 시각(초). 비우면 파일 길이만큼(반복이면 영상 끝까지) */end?:number|null;
  file_start?:number;volume?:number;loop?:boolean;fade_in?:number;fade_out?:number;duck_under_voice?:boolean;
  /** 파일 길이(초, 기록용) */duration?:number|null;
  [key:string]:unknown
}
export interface ComposerProject {
  version:number;title:string;clips:Clip[];output:{width:number;height:number;fps:number;fit:string;file:string;background?:string;[key:string]:unknown};
  transition:Transition;subtitle:Subtitle;bgm:Bgm;
  /** 창작실 효과 규격 이름 (gomo.effects.v1) */
  effects_spec?:string;
  dubbing:{folder?:string;takes:DubbingTake[];volume?:number;latency_ms?:number;[key:string]:unknown};tracks?:Record<string,unknown>;
  /** 미디어 보관함: 창작실 패키지에 들어 있는 모든 이미지·영상·음악 (편집실 확장 — 영상 합성기는 무시) */
  media_library?:MediaItem[];
  /** 추가 소리: 장면별 음악 바꾸기·효과음 (편집실 확장) */
  audio_cues?:AudioCue[];
  [key:string]:unknown;
}
export interface ProjectState {path:string;data:ComposerProject;updatedAt:string;/** 창작실 패키지에서 불러온 경우 안내 문구 */notice?:string}
export interface RecentProject {path:string;title:string;openedAt:string}
export interface EngineStatus {connected:boolean;repo:string;python:string;message:string}
export interface EngineEvent {event:string;progress?:number;message?:string;duration?:number;path?:string}
export interface FfmpegStatus {ok:boolean;path:string;source:'custom'|'bundled'|'system'|'none';version:string;message:string}
export interface RenderEvent {phase:'progress'|'done'|'error'|'cancelled';progress:number;message:string;output?:string}
export type StepId='scenes'|'dubbing'|'subtitles'|'music'|'export';
export type View='home'|StepId|'settings';
