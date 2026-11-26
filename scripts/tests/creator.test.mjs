import assert from 'node:assert/strict';
const p=__shared('project');
const handoff={schema:'creator.handoff.v1',title:'토끼와 거북이',output:{ratio:'9:16'},
  scenes:[{id:'s1',title:'출발',narration:'옛날 옛적에',durationSec:5,asset:'assets/image/S01_image.png'},{id:'s2',title:'달리기',narration:'',durationSec:6,asset:'assets/video/S02_video.mp4'},{id:'s3',title:'빈 장면',narration:'없음',durationSec:4,asset:null}],
  assembly:{clips:[{sceneId:'s1',durationSec:5,transition:'fade'},{sceneId:'s2',durationSec:6,transition:'cut'},{sceneId:'s3',durationSec:4}],subtitleMode:'original',transitionDefault:'fade',bgmAssetId:'m1'},
  media:[{id:'m1',kind:'audio',path:'assets/audio/BGM_01.mp3'}]};
await test('detects creator handoff',()=>{assert.ok(p.isCreatorHandoff(handoff));assert.ok(!p.isCreatorHandoff({version:2}));});
await test('handoff converts to v2 project with scenes, subtitles, bgm, ratio',()=>{const x=p.fromCreatorHandoff(handoff);assert.equal(x.version,2);assert.equal(x.output.width,1080);assert.equal(x.output.height,1920);
  assert.equal(x.clips.length,2,'scene without media skipped');assert.equal(x.clips[0].type,'image');assert.equal(x.clips[0].duration,5);assert.equal(x.clips[0].transition.type,'fade');
  assert.equal(x.clips[1].type,'video');assert.equal(x.clips[1].fit_duration,6);assert.equal(x.clips[1].mute,true);assert.equal(x.clips[1].transition.type,'none');
  assert.equal(x.subtitle.items.length,1,'empty narration skipped');assert.equal(x.subtitle.items[0].text,'옛날 옛적에');assert.equal(x.bgm.file,'assets/audio/BGM_01.mp3');});
await test('handoff without assembly falls back to scene order',()=>{const x=p.fromCreatorHandoff({...handoff,assembly:undefined});assert.equal(x.clips.length,2);assert.equal(x.bgm.file,null);});
await test('creator composer draft opens as-is',()=>{const draft={version:2,title:'초안',output:{width:1920,height:1080,fps:30,fit:'cover',file:'output.mp4'},transition:{type:'crossfade',duration:.5},clips:[{file:'assets/image/S01_image.png',type:'image',duration:5,label:'출발',transition:{type:'fade',duration:.5}}],subtitle:{file:'captions.srt',burn_in:true,offset:0,items:[],style:{font:'Malgun Gothic',size:52,color:'#FFFFFF',outline:2.5,position:'bottom',margin_v:70}},bgm:{file:'assets/audio/BGM_01.mp3',volume:.25,fade_in:1,fade_out:2,loop:true,duck_under_voice:true},dubbing:{folder:'takes',takes:[]}};
  const n=p.normalizeProject(draft);assert.equal(n.bgm.fade_out,2);assert.equal(n.subtitle.file,'captions.srt');assert.equal(n.dubbing.takes.length,0);});
