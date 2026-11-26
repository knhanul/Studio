import type {ComposerProject,StepId} from './types';
import {takeForCue} from './project';

export const STEPS:StepId[]=['scenes','dubbing','subtitles','music','export'];
export const STEP_TITLES:Record<StepId,string>={scenes:'장면 구성',dubbing:'더빙 녹음',subtitles:'자막 다듬기',music:'배경음악',export:'영상 내보내기'};
export const STEP_HINTS:Record<StepId,string>={
  scenes:'장면 순서·길이·움직임을 확인해요',dubbing:'문장마다 목소리를 녹음해요',subtitles:'자막 문구와 시간, 모양을 다듬어요',
  music:'배경음악과 목소리 크기를 맞춰요',export:'완성 영상을 MP4로 만들어요'};
export interface StepGuide{step:StepId;ready:boolean;missing:string[];hint:string;next:StepId|null;nextLabel:string}
export function stepDone(d:ComposerProject,step:StepId):boolean{
  const cues=d.subtitle.items||[];
  if(step==='scenes')return d.clips.length>0&&d.clips.every(c=>!!c.file);
  if(step==='dubbing')return cues.length>0&&cues.every(c=>!!takeForCue(d,c.index));
  if(step==='subtitles')return cues.length>0&&cues.every(c=>c.text.trim()&&c.end>c.start);
  if(step==='music')return !!d.bgm.file;
  return false;
}
export function stepGuide(d:ComposerProject,step:StepId):StepGuide{
  const i=STEPS.indexOf(step);const next=STEPS[i+1]||null;
  const nextLabel=next?`다음: ${STEP_TITLES[next]}`:'영상 만들기';
  const cues=d.subtitle.items||[];
  if(step==='scenes'){
    const missing=[...(!d.clips.length?['장면 1개 이상']:[]),...(d.clips.some(c=>!c.file)?['비어 있는 장면 파일']:[])];
    return {step,ready:!missing.length,missing,next,nextLabel,hint:missing.length?'창작실 작품을 불러오거나 이미지·영상을 추가해 주세요.':`장면 ${d.clips.length}개가 준비됐어요. 순서와 길이를 확인한 뒤 더빙으로 넘어가세요.`};
  }
  if(step==='dubbing'){
    const done=cues.filter(c=>takeForCue(d,c.index)).length;
    return {step,ready:true,missing:[],next,nextLabel,hint:!cues.length?'자막(문장)이 없어요. 자막 단계에서 문장을 먼저 넣으면 문장별로 녹음할 수 있어요.':done===cues.length?`문장 ${cues.length}개 모두 녹음했어요.`:`문장 ${cues.length}개 중 ${done}개 녹음했어요. 녹음하지 않아도 다음으로 넘어갈 수 있어요.`};
  }
  if(step==='subtitles'){
    const empty=cues.filter(c=>!c.text.trim()).length;const bad=cues.filter(c=>c.end<=c.start).length;
    const missing=[...(empty?[`빈 자막 ${empty}개`]:[]),...(bad?[`시간이 잘못된 자막 ${bad}개`]:[])];
    return {step,ready:!missing.length,missing,next,nextLabel,hint:missing.length?'빈 자막이나 끝 시간이 시작보다 빠른 자막을 고쳐 주세요.':cues.length?`자막 ${cues.length}개 · ${d.subtitle.burn_in===false?'영상에 넣지 않음':'영상에 새겨 넣음'}`:'자막 없이 진행해도 돼요.'};
  }
  if(step==='music')return {step,ready:true,missing:[],next,nextLabel,hint:d.bgm.file?'배경음악과 목소리 크기를 들어 보며 맞춰 보세요.':'배경음악 없이 진행해도 돼요.'};
  return {step,ready:d.clips.length>0,missing:d.clips.length?[]:['장면 1개 이상'],next:null,nextLabel,hint:'미리보기용 빠른 영상으로 먼저 확인한 뒤 완성 영상을 만들어 보세요.'};
}
