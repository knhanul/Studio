// 클립 경계 깜박임 검사: 테스트 프로젝트를 실제 FFmpeg로 렌더링한 뒤, 클립 경계 앞뒤 ±0.5초 프레임마다
// 평균 밝기 · 앞 프레임과의 차이 · 해상도 · pts 를 기록하고 깜박임 증상을 찾는다.
//
// 사용: node scripts/boundary-check.mjs [--src 다른/소스/폴더] [--out 결과폴더] [--size 1280x720] [--draft] [--frames] [--only A,B,C]
//   --src    렌더 코드를 읽을 src 폴더 (수정 전 코드와 비교할 때: git worktree 의 src)
//   --frames 경계 앞뒤 프레임을 PNG로 저장
// 결과: <out>/report-<이름>.json, 화면에 요약 표
import {createRequire} from 'node:module';
import {execFileSync,spawnSync} from 'node:child_process';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const req=createRequire(import.meta.url);const ts=req('typescript');
const arg=(k,d)=>{const i=process.argv.indexOf(k);return i>0?process.argv[i+1]:d;};
const SRC=path.resolve(arg('--src','src'));
const OUT=path.resolve(arg('--out',path.join(os.tmpdir(),'gomo-boundary')));
const [W,H]=arg('--size','1280x720').split('x').map(Number);
const DRAFT=process.argv.includes('--draft');const FRAMES=process.argv.includes('--frames');
const ONLY=(arg('--only','A,B,C')).split(',');
fs.mkdirSync(OUT,{recursive:true});

// ── src/shared + src/main/ffmpeg.ts 를 CommonJS로 ──
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'gomo-bc-'));
for(const dir of ['shared','main']){fs.mkdirSync(path.join(tmp,dir));for(const n of fs.readdirSync(path.join(SRC,dir)).filter(n=>n.endsWith('.ts'))){
  if(dir==='main'&&n!=='ffmpeg.ts')continue;
  const js=ts.transpileModule(fs.readFileSync(path.join(SRC,dir,n),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  fs.writeFileSync(path.join(tmp,dir,n.replace(/\.ts$/,'.js')),js.replace("require('ffmpeg-static')",`require(${JSON.stringify(req.resolve('ffmpeg-static'))})`));}}
const ff=req(path.join(tmp,'main','ffmpeg.js'));const P=req(path.join(tmp,'shared','project.js'));
const CAM=fs.existsSync(path.join(tmp,'shared','camera.js'))?req(path.join(tmp,'shared','camera.js')):null;
const st=ff.resolveFfmpeg(process.env.FFMPEG||'');if(!st.ok){console.log('FFmpeg 없음');process.exit(1);}
const run=a=>execFileSync(st.path,['-hide_banner','-loglevel','error','-y',...a],{maxBuffer:1<<30});

// ── 테스트 미디어 (무늬가 많은 그림 → 움직임이 프레임 차이로 잘 보임) ──
const media=path.join(OUT,'media');fs.mkdirSync(path.join(media,'assets'),{recursive:true});
const SRCS=['mandelbrot=s=1600x900:start_scale=2.5','testsrc2=s=1600x900','cellauto=s=1600x900:rule=110:random_seed=4','life=s=1600x900:mold=10:ratio=.4:seed=3:life_color=#c08040:death_color=#203050','mandelbrot=s=1600x900:start_x=-0.75:start_y=0.1:start_scale=0.4:inner=period','smptehdbars=s=1600x900'];
SRCS.forEach((s,i)=>{const f=path.join(media,'assets',`S0${i+1}_image.png`);if(!fs.existsSync(f))run(['-f','lavfi','-i',s,'-frames:v','1',...(s.startsWith('cellauto')||s.startsWith('life')?['-vf','scale=1600:900:flags=neighbor']:[]),f]);});
const vid=path.join(media,'assets','S02_video.mp4');
// 영상: 첫 0.1초 검은 화면 + 기준 이미지와 같은 그림이 천천히 움직이는 영상 (창작실 이미지→동영상 흉내)
if(!fs.existsSync(vid))run(['-f','lavfi','-i','color=c=black:s=1600x900:r=24:d=0.12','-loop','1','-framerate','24','-t','4','-i',path.join(media,'assets','S02_image.png'),
  '-filter_complex','[1:v]scale=1600:900,zoompan=z=\'1+0.0006*on\':d=1:s=1600x900:fps=24,setsar=1[m];[0:v]setsar=1[b];[b][m]concat=n=2:v=1[v]','-map','[v]','-c:v','libx264','-g','48','-pix_fmt','yuv420p',vid]);
const sine=path.join(media,'assets','BGM_01.mp3');if(!fs.existsSync(sine))run(['-f','lavfi','-i','sine=f=330:d=60',sine]);

// ── 테스트 프로젝트 ──
const IMG=i=>`assets/S0${i}_image.png`;
function projectA(){ // 이미지 6장면 × 샷 2~3개, 전환을 섞음 (창작실 gomo.effects.v1 모양)
  const x=P.createProject('경계 검사 A');x.effects_spec='gomo.effects.v1';x.output={...x.output,width:W,height:H,fps:30};
  const scenes=[
    {tr:{type:'none',duration:0},tone:'warm',shots:[['zoom_in',.08,2.4],['pan_right',.1,2.2],['focus_in',.1,2.4,{x:.7,y:.4}]]},
    {tr:{type:'fade',duration:.8,effect:'dissolve'},tone:'cool',shots:[['zoom_out',.1,2.5],['drift',.12,2.5]]},
    {tr:{type:'dissolve',duration:.8,effect:'dissolve'},shots:[['pan_left',.12,2.2],['zoom_in',.1,2.2],['static',0,1.8]]},
    {tr:{type:'fadeblack',duration:1.2,effect:'fade_black'},tone:'night',shots:[['focus_in',.12,2.6,{x:.3,y:.6}],['focus_out',.12,2.4]]},
    {tr:{type:'wipeleft',duration:.7,effect:'wipe_left'},tone:'golden',overlay:'sparkle',shots:[['pan_up',.1,2.3],['pan_down',.1,2.3]]},
    {tr:{type:'none',duration:0,effect:'cut'},shots:[['zoom_in',.06,2.5],['drift',.1,2.5],['zoom_out',.1,2.2]]}];
  let t=0;scenes.forEach((sc,i)=>{sc.shots.forEach(([m,s,d,focus],k)=>{
    const c={file:IMG(i+1),type:'image',duration:d,label:`S0${i+1} (${k+1}/${sc.shots.length})`,scene_id:`S0${i+1}`,shot_index:k,motion:m,motion_strength:s,
      transition:k===0?sc.tr:{type:'fade',duration:.5,effect:'dissolve'}};
    if(focus)c.motion_focus=focus;if(sc.tone)c.tone=sc.tone;if(sc.overlay){c.overlay=sc.overlay;c.overlay_strength=.4;}
    x.clips.push(c);});
    const dur=sc.shots.reduce((n,s)=>n+s[2],0);x.subtitle.items.push({index:i+1,start:+(t+.6).toFixed(2),end:+(t+dur-.3).toFixed(2),text:`장면 ${i+1} 자막`});t+=dur;});
  x.bgm={...x.bgm,file:'assets/BGM_01.mp3'};return x;
}
function projectB(){ // 영상 장면 포함: 이미지 장면 → (기준 이미지 정지 샷 → 영상 샷) → 이미지 장면
  const x=P.createProject('경계 검사 B');x.effects_spec='gomo.effects.v1';x.output={...x.output,width:W,height:H,fps:30};
  x.clips=[
    {file:IMG(1),type:'image',duration:2.5,scene_id:'S01',shot_index:0,motion:'zoom_in',motion_strength:.08,transition:{type:'none',duration:0}},
    {file:IMG(1),type:'image',duration:2.5,scene_id:'S01',shot_index:1,motion:'pan_left',motion_strength:.1,transition:{type:'fade',duration:.5}},
    {file:IMG(2),type:'image',duration:1.5,scene_id:'S02',shot_index:0,motion:'static',motion_strength:0,transition:{type:'fade',duration:.8,effect:'dissolve'}},
    {file:'assets/S02_video.mp4',type:'video',fit_duration:3.5,mute:true,scene_id:'S02',shot_index:1,transition:{type:'fade',duration:.5}},
    {file:IMG(3),type:'image',duration:2.5,scene_id:'S03',shot_index:0,motion:'drift',motion_strength:.1,transition:{type:'fadeblack',duration:1,effect:'fade_black'}},
    {file:IMG(3),type:'image',duration:2.5,scene_id:'S03',shot_index:1,motion:'zoom_out',motion_strength:.1,transition:{type:'fade',duration:.5}}];
  x.subtitle.items=[{index:1,start:.6,end:4.6,text:'하나'},{index:2,start:5.6,end:9.6,text:'둘'},{index:3,start:10.6,end:14.6,text:'셋'}];return x;
}
function projectC(){ // 효과 필드가 없는 예전 프로젝트 (fixtures/demo_video_composer_v2.json 모양)
  const x=P.createProject('예전 프로젝트');x.output={...x.output,width:W,height:H,fps:30};
  x.clips=[{file:IMG(1),type:'image',duration:3,motion:'zoom_in',motion_strength:.15},{file:IMG(2),type:'image',duration:3,motion:'pan_left',motion_strength:.1,transition:{type:'fade',duration:.5}},
    {file:IMG(3),type:'image',duration:3,motion:'zoom_out',transition:{type:'crossfade',duration:.6}},{file:'assets/S02_video.mp4',type:'video',fit_duration:3,mute:true,transition:{type:'none',duration:0}}];
  x.subtitle.items=[{index:1,start:.5,end:2.5,text:'예전'},{index:2,start:6.5,end:8.5,text:'프로젝트'}];return x;
}

// ── 분석 ──
const AW=160,AH=90;
function decodeGray(file){const buf=execFileSync(st.path,['-hide_banner','-loglevel','error','-i',file,'-vf',`scale=${AW}:${AH}:flags=area,format=gray`,'-f','rawvideo','-'],{maxBuffer:1<<30});
  const n=Math.floor(buf.length/(AW*AH));const frames=[];for(let i=0;i<n;i++)frames.push(buf.subarray(i*AW*AH,(i+1)*AW*AH));return frames;}
function showinfo(file){const r=spawnSync(st.path,['-hide_banner','-i',file,'-vf','showinfo','-f','null','-'],{encoding:'utf8',maxBuffer:1<<30});
  const rows=[];for(const m of r.stderr.matchAll(/n:\s*(\d+)\s+pts:\s*(-?\d+)\s+pts_time:([-\d.]+).*?s:(\d+)x(\d+)/g))rows.push({n:+m[1],pts:+m[2],t:+m[3],w:+m[4],h:+m[5]});return rows;}
const mean=a=>a.reduce((n,v)=>n+v,0)/Math.max(1,a.length);
const median=a=>{const s=[...a].sort((x,y)=>x-y);return s.length?s[Math.floor(s.length/2)]:0;};
function luma(fr){let s=0;for(let i=0;i<fr.length;i++)s+=fr[i];return s/fr.length;}
function diff(a,b){let s=0;for(let i=0;i<a.length;i++)s+=Math.abs(a[i]-b[i]);return s/a.length;}

function boundaries(p){const out=[];let t=0;p.clips.forEach((c,i)=>{if(i>0){const prev=p.clips[i-1];
  const same=c.scene_id!=null&&c.scene_id===prev.scene_id;out.push({index:i,time:+t.toFixed(4),kind:same?(c.type!==prev.type?'still→video':'shot'):'scene',transition:c.transition?.type||'(기본)',effect:c.transition?.effect||''});}
  t+=P.clipDuration(c);});return out;}

async function check(name,proj){
  const dir=path.join(media);const out=path.join(OUT,`${name}${DRAFT?'-draft':''}.mp4`);
  fs.writeFileSync(path.join(media,`project-${name}.json`),JSON.stringify(proj,null,1)); // 편집 화면 미리보기 검사용
  const t0=Date.now();
  await ff.renderProject(proj,{ffmpeg:st.path,baseDir:dir,output:out,draft:DRAFT});
  const ms=Date.now()-t0;
  const fps=Number(proj.output.fps)||30;const frames=decodeGray(out);const info=showinfo(out);
  const L=frames.map(luma);const D=frames.map((f,i)=>i?diff(f,frames[i-1]):0);
  const dt=1/fps;const ptsBreaks=info.slice(1).filter((r,i)=>Math.abs(r.t-info[i].t-dt)>dt*.05).map(r=>r.t);
  const sizes=[...new Set(info.map(r=>`${r.w}x${r.h}`))];
  const expected=P.totalDuration(proj);const lastSub=Math.max(...proj.subtitle.items.map(s=>s.end));
  const globalMedianDiff=median(D.slice(1));
  const report={name,draft:DRAFT,renderMs:ms,frames:frames.length,expectedFrames:Math.round(expected*fps),duration:+(info.length?info.at(-1).t+dt:0).toFixed(3),expectedDuration:expected,lastSubtitleEnd:lastSub,sizes,ptsBreaks:ptsBreaks.length,
    firstFrameLuma:+L[0].toFixed(1),globalMedianDiff:+globalMedianDiff.toFixed(2),boundaries:[]};
  for(const b of boundaries(proj)){
    const c=Math.round(b.time*fps);const lo=Math.max(1,c-Math.round(.5*fps)),hi=Math.min(frames.length-1,c+Math.round(.5*fps));
    const idx=[];for(let i=lo;i<=hi;i++)idx.push(i);
    const lw=idx.map(i=>L[i]),dw=idx.map(i=>D[i]);
    const edge=mean([...lw.slice(0,3),...lw.slice(-3)]);const minL=Math.min(...lw);const dip=edge>0?(edge-minL)/edge*100:0;
    // 평소 움직임 수준: 경계 창 밖(앞뒤 1초)의 프레임 차이 중앙값
    const around=[];for(let i=Math.max(1,c-fps*1.5);i<Math.min(frames.length,c+fps*1.5);i++)if(i<lo||i>hi)around.push(D[i]);
    const typical=Math.max(median(around),.25);const maxD=Math.max(...dw);
    const stalls=idx.filter(i=>i>1&&i<frames.length-1&&D[i]<.02&&D[i-1]>.3&&D[i+1]>.3).length;
    const black=idx.filter(i=>L[i]<18).length;
    // 경계 바로 앞뒤(±1프레임) 차이가 창 안 평소 차이(중앙값)의 몇 배인가 — 1~2배면 평소 움직임 수준
    const edgeD=Math.max(D[c-1]||0,D[c]||0,D[c+1]||0);const edgeRatio=+(edgeD/Math.max(median(dw),.1)).toFixed(2);
    // 카메라 모델로 본 경계 앞뒤 속도(배율·중심, 초당) — 같은 장면 샷 경계에서 값이 이어져야 한다
    let cam=null;
    if(CAM&&b.kind==='shot'){const segs=CAM.buildSegments(proj);const sg=segs.find(x=>x.clips.includes(b.index));
      if(sg&&sg.clips[0]!==b.index){const tl=b.time-sg.start;const at=t=>CAM.cameraAt(sg.camera,t);const e=1/fps;
        const v=(t0,t1)=>{const a=at(t0),q=at(t1);return {z:(q.z-a.z)/(t1-t0),cx:(q.cx-a.cx)/(t1-t0),cy:(q.cy-a.cy)/(t1-t0)};};
        const vb=v(tl-2*e,tl-e),va=v(tl+e,tl+2*e);const p0=at(tl-e/2),p1=at(tl+e/2);
        cam={posJump:+Math.max(Math.abs(p1.z-p0.z),Math.abs(p1.cx-p0.cx),Math.abs(p1.cy-p0.cy)).toFixed(5),velBefore:[vb.z,vb.cx,vb.cy].map(x=>+x.toFixed(4)),velAfter:[va.z,va.cx,va.cy].map(x=>+x.toFixed(4)),
          velJump:+Math.max(Math.abs(va.z-vb.z),Math.abs(va.cx-vb.cx),Math.abs(va.cy-vb.cy)).toFixed(4)};}}
    report.boundaries.push({...b,frame:c,lumaBefore:+mean(lw.slice(0,5)).toFixed(1),lumaMin:+minL.toFixed(1),lumaAfter:+mean(lw.slice(-5)).toFixed(1),dipPct:+dip.toFixed(1),
      maxDiff:+maxD.toFixed(2),typicalDiff:+typical.toFixed(2),spike:+(maxD/typical).toFixed(2),edge:edgeRatio,stalls,blackFrames:black,cam,
      luma:lw.map(v=>+v.toFixed(1)),diff:dw.map(v=>+v.toFixed(2))});
    if(FRAMES){const fd=path.join(OUT,'frames');fs.mkdirSync(fd,{recursive:true});
      for(const k of [-6,-1,0,1,6]){const fi=Math.min(frames.length-1,Math.max(0,c+k));run(['-i',out,'-vf',`select=eq(n\\,${fi}),scale=480:-2`,'-frames:v','1',path.join(fd,`${name}${DRAFT?'-draft':''}_b${String(b.index).padStart(2,'0')}_${k>=0?'+':''}${k}.png`)]);}}
  }
  fs.writeFileSync(path.join(OUT,`report-${name}${DRAFT?'-draft':''}.json`),JSON.stringify(report,null,1));
  return report;
}
function print(r){
  console.log(`\n■ ${r.name}${r.draft?' (미리보기)':''} — ${r.renderMs}ms · 프레임 ${r.frames}/${r.expectedFrames} · 길이 ${r.duration}s (기대 ${r.expectedDuration}s) · 마지막 자막 ${r.lastSubtitleEnd}s · 크기 ${r.sizes.join(',')} · pts 끊김 ${r.ptsBreaks} · 첫 프레임 밝기 ${r.firstFrameLuma} · 평소 차이 ${r.globalMedianDiff}`);
  console.log('  경계  시각    종류         전환        밝기(앞→최저→뒤)      밝기하락%  최대차이/평소  창최대배수 경계배수 멈춤 검은  카메라(위치튐/속도튐)');
  for(const b of r.boundaries)console.log(`  #${String(b.index).padStart(2)} ${b.time.toFixed(2).padStart(6)}s ${b.kind.padEnd(12)} ${String(b.transition).padEnd(10)} ${String(b.lumaBefore).padStart(6)}→${String(b.lumaMin).padStart(6)}→${String(b.lumaAfter).padEnd(6)} ${String(b.dipPct).padStart(8)} ${String(b.maxDiff).padStart(8)}/${String(b.typicalDiff).padEnd(6)} ${String(b.spike).padStart(8)} ${String(b.edge).padStart(8)} ${String(b.stalls).padStart(4)} ${String(b.blackFrames).padStart(4)}  ${b.cam?`${b.cam.posJump}/${b.cam.velJump}`:''}`);
}
const projects={A:projectA,B:projectB,C:projectC};
// --dump: 렌더링하지 않고 테스트 프로젝트(composer_project.json 형식)만 media 폴더에 저장 — 편집 화면 미리보기 검사용
if(process.argv.includes('--dump')){for(const k of ONLY)fs.writeFileSync(path.join(media,`project-${k}.json`),JSON.stringify(projects[k](),null,1));console.log('저장:',media);fs.rmSync(tmp,{recursive:true,force:true});process.exit(0);}
for(const k of ONLY){const r=await check(k,projects[k]());print(r);}
fs.rmSync(tmp,{recursive:true,force:true});
console.log(`\n결과 폴더: ${OUT}`);
