import assert from 'node:assert/strict';
const o=__shared('overlays');const p=__shared('project');const r=__shared('render');const c=__shared('camera');
const opts=(draft=false)=>({draft,resolve:f=>'/proj/'+f,info:()=>undefined,workFile:n=>'/work/'+n,output:'/proj/out.mp4'});
const sum=b=>{let s=0;for(let i=0;i<b.length;i+=4)s+=b[i]+b[i+1]+b[i+2];return s;};
const alpha=b=>{let s=0;for(let i=3;i<b.length;i+=4)s+=b[i];return s;};
const diff=(a,b)=>{let s=0;for(let i=0;i<a.length;i++)s+=Math.abs(a[i]-b[i]);return s/a.length;};

await test('every creator overlay is supported (nothing ignored)',()=>{
  for(const k of ['light_rays','glow','sparkle','dust','petals','snow','rain','fog','stars','fireflies','vignette'])assert.ok(c.OVERLAYS_SUPPORTED.has(k),k);
  const x=p.createProject();x.clips=[{file:'a.png',type:'image',duration:2,overlay:'fireflies'},{file:'b.png',type:'image',duration:2,overlay:'aurora'}];
  assert.deepEqual(c.ignoredEffects(x),['overlay=aurora']);});
await test('drawn effects: visible, deterministic, and smooth from frame to frame (no flicker)',()=>{
  for(const k of ['light_rays','sparkle','dust','petals','snow','rain','fog','stars','fireflies']){
    const s=o.overlaySize(k,16/9,true);const a=new Uint8Array(s.w*s.h*4),b=new Uint8Array(s.w*s.h*4),a2=new Uint8Array(s.w*s.h*4);
    o.drawOverlay(k,a,s.w,s.h,3,.6);o.drawOverlay(k,a2,s.w,s.h,3,.6);assert.deepEqual(a,a2,`${k} deterministic`);
    assert.ok((o.overlayMode(k)==='alpha'?alpha(a):sum(a))>0,`${k} draws something`);
    o.drawOverlay(k,b,s.w,s.h,3+1/30,.6);const d=diff(a,b);assert.ok(d<6,`${k} next frame changes little (${d.toFixed(2)})`);}
  });
await test('strength scales the effect, sizes follow the picture shape',()=>{
  const s=o.overlaySize('snow',16/9);assert.deepEqual(s,{w:640,h:360});assert.deepEqual(o.overlaySize('snow',9/16),{w:360,h:640});assert.equal(o.overlaySize('glow',16/9),null);
  const lo=new Uint8Array(640*360*4),hi=new Uint8Array(640*360*4);o.drawOverlay('snow',lo,640,360,2,.1);o.drawOverlay('snow',hi,640,360,2,1);assert.ok(sum(hi)>sum(lo)*1.5);});
await test('render: drawn effects come in as a frame pipe and are mixed per scene before transitions',()=>{
  const x=p.createProject('fx');x.effects_spec='gomo.effects.v1';x.output={...x.output,width:1280,height:720,fps:30};
  x.clips=[{file:'a.png',type:'image',duration:2,scene_id:'S1',shot_index:0,overlay:'sparkle',overlay_strength:.4},{file:'b.png',type:'image',duration:2,scene_id:'S2',shot_index:0,overlay:'petals',transition:{type:'fade',duration:.5}},
    {file:'c.png',type:'image',duration:2,scene_id:'S3',shot_index:0,overlay:'glow',overlay_strength:.5,transition:{type:'fade',duration:.5}}];
  const plan=r.buildRenderPlan(x,opts());const [j0,j1,j2]=plan.clipJobs;const a0=j0.args.join(' ');
  assert.deepEqual(j0.overlay,{kind:'sparkle',w:640,h:360,frames:75,fps:30,t0:0,strength:.4});assert.equal(j1.overlay.t0,2,'whole-video time so effects continue across scenes');
  assert.match(a0,/-f rawvideo -pix_fmt rgba -s 640x360 -framerate 30 -i pipe:0/);assert.ok(!j0.args.includes('-nostdin'));
  assert.match(a0,/\[2:v\]scale=1280:720:flags=bicubic,setsar=1,format=gbrp\[ovl\];\[ovb\]\[ovl\]blend=all_mode=screen/);
  assert.match(j1.args.join(' '),/\[ovb\]\[ovl\]overlay=format=auto/,'petals cover (alpha)');
  const a2=j2.args.join(' ');assert.equal(j2.overlay,undefined);assert.match(a2,/split\[gl2a\]\[gl2b\];\[gl2b\]gblur=sigma=/);assert.match(a2,/blend=all_mode=screen:all_opacity=/);assert.ok(j2.args.includes('-nostdin'));
  assert.ok(!plan.assembly.graph.includes('pipe'),'effects are inside scene clips, not the final mix');});
await test('preview (small) and export (full) draw the same particles',()=>{
  const S=o.overlaySize('fireflies',16/9),s=o.overlaySize('fireflies',16/9,true);assert.notEqual(S.w,s.w);
  const big=new Uint8Array(S.w*S.h*4),sm=new Uint8Array(s.w*s.h*4);o.drawOverlay('fireflies',big,S.w,S.h,5,.6);o.drawOverlay('fireflies',sm,s.w,s.h,5,.6);
  const blobs=(b,w,h)=>{let n=0;for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=(y*w+x)*4+1;const v=b[i];if(v>40&&v>=b[i-4]&&v>=b[i+4]&&v>=b[i-w*4]&&v>b[i+w*4])n++;}return n;};
  const a=blobs(big,S.w,S.h),c=blobs(sm,s.w,s.h);assert.ok(Math.abs(a-c)<=Math.max(2,a*.3),`same number of glows (${a} vs ${c})`);});
