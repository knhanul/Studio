// 실제 FFmpeg로 짧은 예시 프로젝트(이미지 움직임·전환·영상·자막·더빙·배경음악 덕킹)를 렌더해 결과를 검사한다.
// 사용: npm run test:render  (FFmpeg: ffmpeg-static 또는 PATH)
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const req=createRequire(import.meta.url);const ts=req('typescript');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'gomo-smoke-'));
for(const dir of ['shared','main']){fs.mkdirSync(path.join(tmp,dir));for(const n of fs.readdirSync(path.join('src',dir)).filter(n=>n.endsWith('.ts'))){
  if(dir==='main'&&n!=='ffmpeg.ts')continue;
  const js=ts.transpileModule(fs.readFileSync(path.join('src',dir,n),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  fs.writeFileSync(path.join(tmp,dir,n.replace(/\.ts$/,'.js')),js.replace("require('ffmpeg-static')",`require(${JSON.stringify(req.resolve('ffmpeg-static'))})`));}}
const ff=req(path.join(tmp,'main','ffmpeg.js'));const project=req(path.join(tmp,'shared','project.js'));
const st=ff.resolveFfmpeg(process.env.FFMPEG||'');if(!st.ok){console.log('FFmpeg 없음 — 건너뜀');process.exit(0);}
console.log('FFmpeg:',st.source,st.version);
const base=path.join(tmp,'proj');fs.mkdirSync(path.join(base,'assets'),{recursive:true});fs.mkdirSync(path.join(base,'takes'));
const run=a=>execFileSync(st.path,['-hide_banner','-loglevel','error','-y',...a]);
run(['-f','lavfi','-i','testsrc2=s=1280x720:d=1','-frames:v','1',path.join(base,'assets','S01_image.png')]);
run(['-f','lavfi','-i','smptebars=s=800x800:d=1','-frames:v','1',path.join(base,'assets','S02_image.png')]);
run(['-f','lavfi','-i','testsrc=s=640x360:d=4:r=25','-f','lavfi','-i','sine=f=330:d=4','-shortest','-c:v','libx264','-pix_fmt','yuv420p',path.join(base,'assets','S03_video.mp4')]);
run(['-f','lavfi','-i','sine=f=220:d=2','-ar','48000',path.join(base,'takes','line_0001_v1.wav')]);
run(['-f','lavfi','-i','sine=f=440:d=3','-ar','44100',path.join(base,'assets','BGM_01.mp3')]);
run(['-f','lavfi','-i','sine=f=660:d=2','-ar','44100',path.join(base,'assets','BGM_02.mp3')]);
run(['-f','lavfi','-i','sine=f=990:d=0.4','-ar','48000',path.join(base,'assets','ding.wav')]);
const p=project.createProject('스모크');
p.output={...p.output,width:640,height:360,fps:25};
p.clips=[{file:'assets/S01_image.png',type:'image',duration:2.5,motion:'zoom_in',motion_strength:.15,overlay:'sparkle',overlay_strength:.6},{file:'assets/S02_image.png',type:'image',duration:2,motion:'pan_left',motion_strength:.1,overlay:'glow',transition:{type:'fade',duration:.5}},
  {file:'assets/S03_video.mp4',type:'video',fit_duration:2,mute:false,transition:{type:'none',duration:0}}];
p.subtitle.items=[{index:1,start:.3,end:2.2,text:'안녕하세요 {고모}'},{index:2,start:2.6,end:4.3,text:'두 번째\n줄입니다'}];
p.dubbing.takes=[{file:'takes/line_0001_v1.wav',subtitle:1,offset:-.2,trim_start:.2,trim_end:1.8,volume:.8,duration:2}];
p.bgm={...p.bgm,file:'assets/BGM_01.mp3',volume:.3,loop:true,duck_under_voice:true,fade_in:.5,fade_out:1,end:4.5};
// 장면 3부터 다른 음악 + 효과음 (창작실 패키지의 여러 BGM 활용)
p.audio_cues=[{id:'m2',file:'assets/BGM_02.mp3',kind:'music',start:4.5,loop:true,volume:.3,fade_in:.3,fade_out:.5},{id:'fx',file:'assets/ding.wav',kind:'effect',start:2.4,volume:.9,duration:.4}];
const expected=project.totalDuration(p);
for(const draft of [true,false]){
  const out=path.join(base,draft?'preview.mp4':'final.mp4');let last=0;
  const t0=Date.now();
  const r=await ff.renderProject(p,{ffmpeg:st.path,baseDir:base,output:out,draft,onProgress:(x)=>{if(x+1e-9<last)throw new Error('진행률 역행');last=x;}});
  const info=await ff.probeMedia(st.path,out);
  console.log(`${draft?'미리보기':'완성'}: ${r.bytes} bytes, ${info.duration}s (기대 ${expected}s), 소리 ${info.hasAudio}, ${Date.now()-t0}ms`);
  if(!info.hasAudio||Math.abs(info.duration-expected)>.15)throw new Error('길이/소리 불일치');
  if(process.env.KEEP_FRAMES){run(['-ss','1.0','-i',out,'-frames:v','1',process.env.KEEP_FRAMES+(draft?'-draft':'-final')+'.png']);}
}
const ac=new AbortController();setTimeout(()=>ac.abort(),300);
await ff.renderProject(p,{ffmpeg:st.path,baseDir:base,output:path.join(base,'cancel.mp4'),draft:false,signal:ac.signal}).then(()=>console.log('(취소 전에 끝남)'),e=>{if(!/취소/.test(e.message))throw e;console.log('취소 동작 확인');});
fs.rmSync(tmp,{recursive:true,force:true});console.log('render smoke OK');
