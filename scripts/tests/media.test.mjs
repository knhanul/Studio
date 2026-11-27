import assert from 'node:assert/strict';
const p=__shared('project');const m=__shared('media');const r=__shared('render');
// 고모 창작실 project.json(creator.project.v1)과 같은 모양: 이미지 장면 · 이미지→동영상 장면 · 영상 없는 영상 장면 · 연결 안 된 장면 · 여러 BGM · 다시 만든 버전
const A=(id,kind,path)=>({id,kind,name:path.split('/').pop(),relativePath:path,bytes:1,importedAt:'2026-11-25T00:00:00Z'});
const creator={schema:'creator.project.v1',id:'x',brief:{title:'별 헤는 밤',aspectRatio:'16:9'},
  scenes:[
    {id:'S01',title:'하늘',narration:'계절이 지나가는 하늘에는',durationSec:5,kind:'image',assetId:'a1',referenceImageAssetId:'a1'},
    {id:'S02',title:'별',narration:'가을로 가득 차 있습니다',durationSec:6,kind:'video',assetId:'a3',referenceImageAssetId:'a2'},
    {id:'S03',title:'추억',narration:'별 하나에 추억과',durationSec:4,kind:'video',assetId:'a4',referenceImageAssetId:'a4'},
    {id:'S04',title:'사랑',narration:'별 하나에 사랑과',durationSec:4,kind:'image',assetId:null},
    {id:'S05',title:'빈',narration:'없음',durationSec:3,kind:'image',assetId:null}],
  assets:[A('a1','image','assets/image/S01_image.png'),A('a1b','image','assets/image/S01_image_v2.png'),A('a2','image','assets/image/S02_image.png'),A('a3','video','assets/video/S02_video.mp4'),
    A('a4','image','assets/image/S03_image.png'),A('a5','image','assets/image/S04_image_v2.png'),A('b1','audio','assets/audio/BGM_01.mp3'),A('b2','audio','assets/audio/BGM_02.mp3'),A('x1','image','assets/image/cover.png')],
  assembly:{clips:[{sceneId:'S01',durationSec:5,transition:'fade'},{sceneId:'S02',durationSec:6,transition:'dissolve'},{sceneId:'S03',durationSec:4,transition:'cut'},{sceneId:'S04',durationSec:4,transition:'fade'},{sceneId:'S05',durationSec:3,transition:'fade'}],subtitleMode:'original',transitionDefault:'fade',bgmAssetId:'b1'}};

await test('asset names: scene label, kind, version, bgm number',()=>{
  assert.deepEqual(m.parseAssetName('assets/image/S04_image_v2.png'),{label:'S04',tag:'image',version:2,bgm:null});
  assert.deepEqual(m.parseAssetName('assets/video/S02_video.mp4'),{label:'S02',tag:'video',version:1,bgm:null});
  assert.equal(m.parseAssetName('assets/audio/BGM_02.mp3').bgm,2);assert.equal(m.parseAssetName('cover.png').label,null);
  assert.equal(m.sceneFileLabel('장면1',2),'S03');assert.equal(m.sceneFileLabel('S07',0),'S07');});
await test('creator library: linked, reference image, alternate versions, bgm, extra',()=>{
  const lib=m.libraryFromCreator(creator);const by=f=>lib.find(x=>x.file===f);
  assert.equal(by('assets/image/S01_image.png').role,'scene');assert.equal(by('assets/image/S01_image_v2.png').role,'alternate');assert.equal(by('assets/image/S01_image_v2.png').version,2);
  assert.equal(by('assets/image/S02_image.png').role,'reference');assert.equal(by('assets/image/S02_image.png').scene_id,'S02');assert.equal(by('assets/video/S02_video.mp4').role,'scene');
  assert.equal(by('assets/image/S04_image_v2.png').scene_id,'S04');assert.equal(by('assets/audio/BGM_02.mp3').role,'bgm');assert.equal(by('assets/image/cover.png').role,'extra');
  assert.equal(lib.at(-1).kind,'audio','audio sorted last');assert.equal(m.librarySummary(lib),'이미지 6 · 영상 1 · 음악·소리 2');});
await test('creator project → v2: video poster, fallback from scene files, skipped empty scene',()=>{
  const {project:x,skipped,fallbacks}=m.fromCreatorProject(creator);
  assert.equal(x.clips.length,4);assert.deepEqual(skipped,['S05']);assert.deepEqual(fallbacks,['S04']);
  assert.equal(x.clips[1].type,'video');assert.equal(x.clips[1].poster,'assets/image/S02_image.png');assert.equal(x.clips[1].fit_duration,6);assert.equal(x.clips[1].transition.type,'crossfade');
  assert.equal(x.clips[2].type,'image','video scene without video uses its image');assert.equal(x.clips[2].transition.type,'none');
  assert.equal(x.clips[3].file,'assets/image/S04_image_v2.png');assert.equal(x.clips[3].scene_id,'S04');
  assert.equal(x.bgm.file,'assets/audio/BGM_01.mp3');assert.equal(x.subtitle.items.length,4);assert.equal(x.media_library.length,9);});
await test('attach library to composer draft: scene ids and posters filled, existing kept',()=>{
  const draft=p.createProject('초안');draft.clips=[{file:'assets/image/S01_image.png',type:'image',duration:5},{file:'assets/video/S02_video.mp4',type:'video',fit_duration:6,poster:'keep.png'},{file:'assets/video/S02_video.mp4',type:'video',fit_duration:6}];
  const x=m.attachLibrary(draft,m.libraryFromCreator(creator));
  assert.equal(x.clips[0].scene_id,'S01');assert.equal(x.clips[1].poster,'keep.png');assert.equal(x.clips[2].poster,'assets/image/S02_image.png');
  const alts=m.sceneAlternatives(x,x.clips[0]);assert.deepEqual(alts.map(a=>a.file),['assets/image/S01_image_v2.png']);
  assert.deepEqual(m.sceneAlternatives(x,x.clips[2]).map(a=>a.file),['assets/image/S02_image.png']);});
await test('library from folder files and merge keeps creator roles',()=>{
  const files=m.libraryFromFiles(['assets/image/S01_image.png','assets/image/S09_image.png','media/rain.wav','assets/audio/BGM_03.mp3','assets/readme.txt'],[{id:'S01',title:'하늘'}]);
  assert.equal(files.length,4);assert.equal(files.find(f=>f.file==='assets/image/S09_image.png').scene_id,'S09');assert.equal(files.find(f=>f.file==='media/rain.wav').role,'audio');assert.equal(files.find(f=>f.file==='assets/audio/BGM_03.mp3').role,'bgm');
  const merged=m.mergeLibrary(m.libraryFromCreator(creator),files);assert.equal(merged.find(f=>f.file==='assets/image/S01_image.png').role,'scene');assert.equal(merged.length,12);});
await test('swap image ↔ video keeps on-screen length; poster kept from previous image',()=>{
  const img={file:'assets/image/S02_image.png',type:'image',duration:6,motion:'zoom_in',motion_strength:.1,label:'별',scene_id:'S02'};
  const v=m.swapClipMedia(img,{file:'assets/video/S02_video.mp4',kind:'video',duration:8},6);
  assert.equal(v.type,'video');assert.equal(v.fit_duration,6);assert.equal(v.source_duration,8);assert.equal(v.poster,'assets/image/S02_image.png');assert.equal(v.mute,true);assert.equal(v.label,'별');assert.equal(p.clipDuration(v),6);
  const back=m.swapClipMedia(v,{file:'assets/image/S02_image.png',kind:'image'},6);assert.equal(back.type,'image');assert.equal(back.duration,6);assert.equal(back.fit_duration,null);assert.equal(back.poster,undefined);assert.equal(p.clipDuration(back),6);});
await test('insert reference image before video scene with crossfade',()=>{
  const {project:x}=m.fromCreatorProject(creator);const y=m.insertPosterBefore(x,1,2);
  assert.equal(y.clips.length,5);assert.equal(y.clips[1].type,'image');assert.equal(y.clips[1].file,'assets/image/S02_image.png');assert.equal(y.clips[1].duration,2);assert.equal(y.clips[2].transition.type,'crossfade');
  assert.equal(m.insertPosterBefore(x,0),x,'image scene unchanged');});
await test('media usage lists scenes, poster, bgm and cues',()=>{
  const {project:x}=m.fromCreatorProject(creator);x.audio_cues=[{id:'c',file:'assets/audio/BGM_02.mp3',kind:'music',start:5}];
  assert.deepEqual(m.mediaUsage(x,'assets/image/S02_image.png'),['장면 2 기준']);assert.deepEqual(m.mediaUsage(x,'assets/audio/BGM_01.mp3'),['배경음악']);assert.deepEqual(m.mediaUsage(x,'assets/audio/BGM_02.mp3'),['추가 음악']);});
await test('switch music at a scene: bgm ends there, new music continues and later switch trims it',()=>{
  const {project:x}=m.fromCreatorProject(creator); // 총 19초
  const y=m.switchMusicAt(x,11,{file:'assets/audio/BGM_02.mp3',name:'BGM_02.mp3'});
  assert.equal(y.bgm.end,11);assert.equal(y.audio_cues.length,1);assert.equal(y.audio_cues[0].start,11);assert.equal(y.audio_cues[0].loop,true);
  const layers=m.musicLayers(y);assert.deepEqual(layers.map(l=>[l.kind,l.start,l.end]),[['bgm',0,11],['music',11,19]]);
  const z=m.switchMusicAt(y,15,{file:'assets/audio/BGM_01.mp3'});assert.equal(z.audio_cues[0].end,15);assert.equal(z.audio_cues[1].start,15);
  const w=m.switchMusicAt({...x,bgm:{...x.bgm,file:null}},5,{file:'assets/audio/BGM_02.mp3'});assert.equal(w.bgm.file,'assets/audio/BGM_02.mp3');assert.equal((w.audio_cues||[]).length,0);});
await test('cue span and fades: effect uses file length, loop runs to end',()=>{
  assert.deepEqual(m.cueSpan({id:'a',file:'s.wav',kind:'effect',start:3,duration:1.5},20),{start:3,end:4.5});
  assert.deepEqual(m.cueSpan({id:'a',file:'s.wav',kind:'music',start:3,loop:true,duration:1.5},20),{start:3,end:20});
  assert.deepEqual(m.cueSpan({id:'a',file:'s.wav',kind:'effect',start:3,end:30},20),{start:3,end:20});
  const l={start:10,end:20,fade_in:2,fade_out:4};assert.equal(m.layerFade(l,11),.5);assert.equal(m.layerFade(l,18),.5);assert.equal(m.layerFade(l,9),0);});
await test('render: bgm cut at end, music cue ducked together, effect mixed without ducking',()=>{
  const x=p.createProject('t');x.clips=[{file:'a.png',type:'image',duration:10},{file:'b.png',type:'image',duration:10,transition:{type:'none',duration:0}}];
  x.subtitle.items=[{index:1,start:1,end:3,text:'가'}];x.dubbing.takes=[{file:'takes/t.wav',subtitle:1,offset:0}];
  x.bgm={...x.bgm,file:'bgm1.mp3',end:10};x.audio_cues=[{id:'c1',file:'bgm2.mp3',kind:'music',start:10,loop:true,volume:.3},{id:'c2',file:'ding.wav',kind:'effect',start:4,duration:1,volume:.8}];
  const plan=r.buildRenderPlan(x,{draft:false,resolve:f=>'/p/'+f,info:()=>undefined,workFile:n=>'/w/'+n,output:'/p/o.mp4'});const g=plan.assembly.graph;const a=plan.assembly.args.join(' ');
  assert.match(g,/atrim=duration=10,afade=t=in:st=0:d=1,afade=t=out:st=8:d=2,volume=0.25,apad=whole_dur=20,atrim=duration=20\[bgm\]/);
  assert.match(g,/volume=0.3,adelay=delays=10000:all=1,apad=whole_dur=20,atrim=duration=20\[snd1\]/);
  assert.match(g,/atrim=duration=1,volume=0.8,adelay=delays=4000:all=1/);
  assert.match(g,/\[bgm\]\[snd1\]amix=inputs=2:normalize=0:duration=first\[musicbus\]/);assert.match(g,/\[musicbus\]\[voicesc\]sidechaincompress/);
  assert.match(g,/\[abase\]\[bgmd\]\[snd2\]\[voicemix\]amix=inputs=4/);assert.ok(a.includes('-stream_loop -1 -i /p/bgm2.mp3'));assert.ok(!a.includes('-stream_loop -1 -i /p/ding.wav'));});
await test('render without voice: music bus mixed directly',()=>{
  const x=p.createProject('t');x.clips=[{file:'a.png',type:'image',duration:5}];x.bgm.file='b.mp3';x.audio_cues=[{id:'c',file:'c.mp3',kind:'music',start:2}];
  const g=r.buildRenderPlan(x,{draft:true,resolve:f=>f,info:()=>undefined,workFile:n=>n,output:'o.mp4'}).assembly.graph;
  assert.ok(!g.includes('sidechaincompress'));assert.match(g,/\[abase\]\[musicbus\]amix=inputs=2/);});
await test('clip from library item: video gets poster of its scene',()=>{
  const {project:x}=m.fromCreatorProject(creator);const item=x.media_library.find(i=>i.file==='assets/video/S02_video.mp4');
  const c=m.clipFromItem(x,item,7.5);assert.equal(c.type,'video');assert.equal(c.poster,'assets/image/S02_image.png');assert.equal(c.source_duration,7.5);assert.equal(c.label,'별');
  assert.equal(m.clipFromItem(x,x.media_library.find(i=>i.kind==='audio')),null);});
await test('package bgm: chosen in creator, else latest generated BGM, else any audio',()=>{
  const lib=m.libraryFromCreator(creator);
  assert.equal(m.packageBgm(lib,creator),'assets/audio/BGM_01.mp3','편집안에서 고른 음악');
  const none={...creator,assembly:{...creator.assembly,bgmAssetId:null}};
  assert.equal(m.packageBgm(lib,none),'assets/audio/BGM_02.mp3','고르지 않았으면 가장 나중에 만든 BGM');
  assert.equal(m.fromCreatorProject(none).project.bgm.file,'assets/audio/BGM_02.mp3');
  const odd={...none,assets:[...creator.assets.filter(a=>a.kind!=='audio'),A('g1','audio','assets/audio/gemini_music.mp3')]};
  assert.equal(m.packageBgm(m.libraryFromCreator(odd),odd),'assets/audio/gemini_music.mp3','예전 이름의 음악');
  assert.equal(m.packageBgm(m.libraryFromFiles(['assets/audio/BGM_01.mp3','assets/audio/BGM_03.mp3','media/x.wav'])),'assets/audio/BGM_03.mp3','project.json 없이 폴더만');
  assert.equal(m.packageBgm([],null),null);});
