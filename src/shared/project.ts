import type {Clip,ComposerProject,SubtitleItem} from './types';
export function createProject(title='제목 없음'):ComposerProject{return {version:2,title,output:{width:1920,height:1080,fps:30,fit:'cover',file:'output.mp4'},transition:{type:'crossfade',duration:.5},clips:[],subtitle:{offset:0,burn_in:true,items:[],style:{font:'Malgun Gothic',size:52,color:'#FFFFFF',position:'bottom',outline:2.5,box:false}},bgm:{file:null,volume:.25,loop:true,duck_under_voice:true},dubbing:{folder:'takes',takes:[]},tracks:{}};}
export function normalizeProject(raw:unknown):ComposerProject{
 if(!raw||typeof raw!=='object')throw new Error('올바른 프로젝트 JSON이 아닙니다.');
 const d=raw as Partial<ComposerProject>;
 if(d.version!==2&&d.version!==1)throw new Error('지원되지 않는 프로젝트 버전입니다. (v1 / v2만 열 수 있음)');
 const base=createProject(d.title||'제목 없음');
 return {...base,...d,version:d.version,clips:Array.isArray(d.clips)?d.clips:[],output:{...base.output,...d.output},transition:{...base.transition,...d.transition},subtitle:{...base.subtitle,...d.subtitle},bgm:{...base.bgm,...d.bgm},dubbing:{...base.dubbing,...d.dubbing,takes:Array.isArray(d.dubbing?.takes)?d.dubbing.takes:[]}};
}
export function clipDuration(c:Clip):number{
 if(typeof c.fit_duration==='number'&&c.fit_duration>0)return c.fit_duration;
 if(c.type==='image')return Math.max(.1,Number(c.duration)||4);
 if(c.trim_end!=null){const start=Number(c.trim_start)||0;return Math.max(.1,(c.trim_end-start)/Math.max(.1,Number(c.speed)||1));}
 return Math.max(.1,Number(c.duration)||4); // 원본 길이를 알 수 없는 영상: 추정값, 렌더링 전 실제 길이 검사 필요
}
export function timeline(data:ComposerProject){let offset=0;return data.clips.map((clip,index)=>{const start=offset;const duration=clipDuration(clip);offset+=duration;return {clip,index,start,duration,end:offset};});}
export function totalDuration(data:ComposerProject){return timeline(data).reduce((n,c)=>n+c.duration,0);}
export const fmt=(sec:number)=>`${Math.floor(Math.max(sec,0)/60).toString().padStart(2,'0')}:${(Math.max(sec,0)%60).toFixed(1).padStart(4,'0')}`;
const tc=(seconds:number)=>{const ms=Math.round(seconds*1000);const h=Math.floor(ms/3600000),m=Math.floor(ms%3600000/60000),s=Math.floor(ms%60000/1000),re=ms%1000;return `${[h,m,s].map(n=>String(n).padStart(2,'0')).join(':')},${String(re).padStart(3,'0')}`;};
export function toSrt(items:SubtitleItem[]):string{return items.map((it,i)=>`${i+1}\n${tc(it.start)} --> ${tc(it.end)}\n${it.text}`).join('\n\n')+'\n';}
export function fromSrt(text:string):SubtitleItem[]{return text.replace(/\r/g,'').replace(/^\uFEFF/,'').trim().split(/\n\s*\n/).map((block,i)=>{const m=block.match(/(?:^|\n)(\d\d:\d\d:\d\d[,.]\d{1,3})\s*-->\s*(\d\d:\d\d:\d\d[,.]\d{1,3})/);if(!m)return null;const time=(v:string)=>{const [h,mi,rest]=v.replace(',','.').split(':');return (+h)*3600+(+mi)*60+parseFloat(rest);};return {index:i+1,start:time(m[1]),end:time(m[2]),text:block.slice((m.index||0)+m[0].length).trim()};}).filter((it):it is SubtitleItem=>Boolean(it));}
export function validProject(d:ComposerProject):string[]{const warnings:string[]=[];if(!d.clips.length)warnings.push('클립이 없습니다.');d.clips.forEach((c,i)=>{if(!c.file)warnings.push(`${i+1}번 클립 파일 경로 없음`);if(clipDuration(c)<=0)warnings.push(`${i+1}번 클립 길이 오류`);});return warnings;}
