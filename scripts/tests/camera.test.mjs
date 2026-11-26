import assert from 'node:assert/strict';
const p=__shared('project');const c=__shared('camera');const r=__shared('render');
const opts=(draft=false,info={})=>({draft,resolve:f=>'/proj/'+f,info:f=>info[f],workFile:n=>'/work/'+n,output:'/proj/out.mp4'});
/** 창작실 gomo.effects.v1 모양: S01 샷 3개(장면 안 fade 0.5) → S02 fade 0.8 → S03 기준 이미지 정지 샷 → 영상 샷 → S04 fadeblack */
function fx(){const x=p.createProject('fx');x.effects_spec='gomo.effects.v1';x.output={...x.output,width:1280,height:720,fps:30};
  const im=(file,scene,k,d,motion,s,tr,extra={})=>({file,type:'image',duration:d,scene_id:scene,shot_index:k,motion,motion_strength:s,transition:tr,...extra});
  x.clips=[im('a.png','S01',0,2.4,'zoom_in',.08,{type:'none',duration:0}),im('a.png','S01',1,2.2,'pan_right',.1,{type:'fade',duration:.5}),im('a.png','S01',2,2.4,'focus_in',.1,{type:'fade',duration:.5},{motion_focus:{x:.7,y:.4}}),
    im('b.png','S02',0,2.5,'zoom_out',.1,{type:'fade',duration:.8,effect:'fade'},{tone:'warm'}),im('b.png','S02',1,2.5,'drift',.12,{type:'fade',duration:.5},{tone:'warm'}),
    im('c.png','S03',0,1.5,'static',0,{type:'dissolve',duration:.8}),{file:'c.mp4',type:'video',fit_duration:3.5,mute:true,scene_id:'S03',shot_index:1,transition:{type:'fade',duration:.5}},
    im('d.png','S04',0,2.5,'pan_left',.12,{type:'fadeblack',duration:1.2,effect:'fade_black'},{overlay:'sparkle',overlay_strength:.4})];
  x.subtitle.items=[{index:1,start:.6,end:6.7,text:'하나'},{index:2,start:7.6,end:11.7,text:'둘'}];return x;}

await test('transition names: crossfade/dissolve → smooth fade, fade = black only in old projects, unknown → fade',()=>{
  assert.equal(c.resolveTransition('fade',true),'fade');assert.equal(c.resolveTransition('fade',false),'fadeblack');assert.equal(c.resolveTransition('crossfade',false),'fade');
  assert.equal(c.resolveTransition('dissolve',true),'fade');assert.equal(c.resolveTransition('fadeblack',true),'fadeblack');assert.equal(c.resolveTransition('wipeleft',true),'wipeleft');
  assert.equal(c.resolveTransition('none',true),'none');assert.equal(c.resolveTransition('sparkly',true),'fade');assert.equal(c.resolveTransition(undefined,true),'none');
  assert.equal(c.isEffectsProject(fx()),true);assert.equal(c.isEffectsProject(p.createProject()),false);});
await test('segments: same-scene image shots form one segment; frames add up to total; still→video joined by short fade',()=>{
  const x=fx();const segs=c.buildSegments(x);
  assert.deepEqual(segs.map(s=>s.clips),[[0,1,2],[3,4],[5],[6],[7]]);
  assert.equal(segs.reduce((n,s)=>n+s.frames,0),Math.round(p.totalDuration(x)*30));
  assert.deepEqual(segs.map(s=>s.startFrame),[0,210,360,405,510]);
  assert.deepEqual(segs.map(s=>s.transition.type),['none','fade','fade','fade','fadeblack']);
  assert.equal(segs[3].transition.frames,15,'still→video: 0.3~0.5s dissolve');assert.equal(segs[2].transition.frames,22,'dissolve 0.8s limited to half of 1.5s still (22 frames)');
  assert.equal(segs[1].transition.frames,24);assert.equal(segs[0].renderFrames,210+24,'previous segment extended by next transition');
  assert.equal(segs[4].renderFrames,segs[4].frames);assert.equal(segs[1].tone,'warm');assert.equal(segs[2].camera.kind,'static','still before its video stays still');});
await test('camera rules: relative moves, pan makes room by zooming, clamps keep picture inside',()=>{
  const z=c.nextCam(c.CAM0,{motion:'zoom_in',motion_strength:.1});assert.ok(Math.abs(z.z-1.1)<1e-9);
  const pr=c.nextCam(c.CAM0,{motion:'pan_right',motion_strength:.1});assert.ok(pr.z>=1.1-1e-9&&pr.cx>.5);assert.ok(pr.cx<=1-.5/pr.z+1e-9);
  const fi=c.nextCam(z,{motion:'focus_in',motion_strength:.1,motion_focus:{x:.9,y:.1}});assert.ok(Math.abs(fi.z-1.3)<1e-9);assert.ok(Math.abs(fi.cx-(1-.5/1.3))<1e-9,'focus clamped inside');
  const big=c.nextCam({z:1.55,cx:.5,cy:.5},{motion:'zoom_in',motion_strength:.3});assert.equal(big.z,1.6);
  const out=c.nextCam({z:1.05,cx:.52,cy:.5},{motion:'zoom_out',motion_strength:.1});assert.equal(out.z,1);assert.equal(out.cx,.5);
  assert.deepEqual(c.nextCam(pr,{motion:'static'}),pr);});
await test('camera path: continuous position and speed at shot joins, still at segment start and end',()=>{
  const x=fx();const seg=c.buildSegments(x)[0];const at=t=>c.cameraAt(seg.camera,t);const e=1e-4;
  assert.deepEqual(at(0),c.CAM0);
  for(const t of [2.4,4.6]){const a=at(t-e),b=at(t+e);for(const k of ['z','cx','cy'])assert.ok(Math.abs(a[k]-b[k])<1e-3,`position ${k} at ${t}`);
    const va=(at(t-e)[ 'z']-at(t-2*e).z)/e,vb=(at(t+2*e).z-at(t+e).z)/e;assert.ok(Math.abs(va-vb)<.01,`zoom speed continuous at ${t}`);}
  const end=seg.renderFrames/30;const v0=(at(1e-3).z-at(0).z)/1e-3,v1=(at(end).z-at(end-1e-3).z)/1e-3;assert.ok(Math.abs(v0)<.01&&Math.abs(v1)<.01,'ease only at segment ends');
  // 매듭 값이 규칙대로
  seg.camera.keys.forEach((k,i)=>{const v=at(seg.camera.times[i]);assert.ok(Math.abs(v.z-k.z)<1e-6);});});
await test('FFmpeg expression equals the preview spline',()=>{
  const s=c.monotoneSpline([0,2,3.5,6],[1,1.1,1.1,1.3]);const expr=c.splineExpr(s,'T');
  const js=new Function('T',`const IF=(a,b,d)=>a?b:d,LT=(a,b)=>a<b?1:0;return ${expr.replace(/if\(/g,'IF(').replace(/lt\(/g,'LT(')};`);
  for(const t of [0,.3,1.9,2,2.7,3.5,4.2,5.99,6,7])assert.ok(Math.abs(js(t)-c.evalSpline(s,t))<1e-5,`t=${t}`);});
await test('render: one job per segment, no xfade between shots, offsets on frame grid, black fade only where asked',()=>{
  const x=fx();const plan=r.buildRenderPlan(x,opts(false,{'/proj/c.mp4':{duration:5,hasAudio:false,lead:.12}}));const g=plan.assembly.graph;
  assert.equal(plan.clipJobs.length,5);assert.equal((g.match(/xfade=/g)||[]).length,4);
  assert.match(g,/xfade=transition=fade:duration=0.8:offset=7\[/);assert.match(g,/xfade=transition=fade:duration=0.5:offset=13.5\[/);assert.match(g,/xfade=transition=fadeblack:duration=1.2:offset=17\[/);
  assert.ok(!/fade=t=(in|out)/.test(g),'no per-clip fades');assert.ok(!g.includes('dissolve'));
  const j0=plan.clipJobs[0].args.join(' ');assert.match(j0,/perspective=x0='/);assert.match(j0,/trim=end_frame=234/);assert.match(j0,/-frames:v 234/);assert.match(j0,/setsar=1,format=yuv420p/);
  assert.match(plan.clipJobs[1].args.join(' '),/colorchannelmixer=rr=1.06/);
  const jv=plan.clipJobs[3].args.join(' ');assert.match(jv,/-ss 0.12 -t 4.88 -i \/proj\/c.mp4/,'black lead trimmed');
  assert.deepEqual(plan.ignored,['overlay=sparkle']);assert.equal(plan.total,19.5);assert.ok(plan.assembly.args.join(' ').includes('-frames:v 585'));});
await test('old project without effect fields still renders the same way (one job per clip, legacy motion)',()=>{
  const x=p.createProject('old');x.clips=[{file:'a.png',type:'image',duration:4,motion:'zoom_in',motion_strength:.1},{file:'b.png',type:'image',duration:3,transition:{type:'fade',duration:.5}},{file:'c.png',type:'image',duration:3,transition:{type:'crossfade',duration:.5}}];
  const segs=c.buildSegments(x);assert.equal(segs.length,3);assert.equal(segs[0].camera.kind,'legacy');
  const plan=r.buildRenderPlan(x,opts());assert.match(plan.assembly.graph,/xfade=transition=fadeblack:duration=0.5:offset=4\[/);assert.match(plan.assembly.graph,/xfade=transition=fade:duration=0.5:offset=7\[/);
  assert.equal(plan.ignored.length,0);});
await test('black lead detection from signalstats',()=>{
  const txt=['frame:0 pts:0 pts_time:0','lavfi.signalstats.YAVG=16.2','frame:1 pts:1 pts_time:0.041667','lavfi.signalstats.YAVG=16','frame:2 pts:2 pts_time:0.083333','lavfi.signalstats.YAVG=16.1','frame:3 pts:3 pts_time:0.125','lavfi.signalstats.YAVG=96'].join('\n');
  assert.equal(r.leadFromStats(txt),.125);assert.equal(r.leadFromStats('frame:0 pts_time:0\nlavfi.signalstats.YAVG=80\nframe:1 pts_time:0.04\nlavfi.signalstats.YAVG=81'),0);
  assert.equal(r.leadFromStats('frame:0 pts_time:0\nlavfi.signalstats.YAVG=10\nframe:1 pts_time:0.04\nlavfi.signalstats.YAVG=12'),0,'all-dark clip kept');});
