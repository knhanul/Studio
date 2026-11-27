/** 분위기 효과(overlay) — 창작실 효과 규격 gomo.effects.v1 의 overlay 값.
 *
 *  빛·입자 효과는 이 파일의 drawOverlay 가 프레임마다 그린다. 내보내기는 이 프레임을 FFmpeg 에 그대로 넘겨
 *  장면 위에 섞고(screen: 밝은 부분만 더해짐 / alpha: 꽃잎처럼 덮음), 편집 화면 미리보기는 같은 함수로 캔버스에 그린다.
 *  → 미리보기와 완성 영상이 같은 모양·같은 움직임.
 *
 *  - 시간 t 는 영상 전체 시각(초)을 쓴다: 같은 효과가 이어지는 장면 사이 전환에서 입자가 튀지 않는다.
 *  - 입자 위치는 번호마다 정해진 난수 + t 의 매끄러운 함수: 프레임마다 깜박이지 않는다.
 *  - glow(빛 번짐)·vignette(가장자리 어둡게)는 그림 자체를 다루므로 FFmpeg 필터 / CSS 로 만든다(mode 'filter'). */

export type OverlayMode='screen'|'alpha'|'filter';
export const OVERLAY_LABELS:Record<string,string>={none:'없음',light_rays:'빛줄기',glow:'은은한 빛 번짐',sparkle:'반짝임',dust:'떠다니는 먼지빛',petals:'꽃잎',
  snow:'눈',rain:'비',fog:'안개',stars:'별빛',fireflies:'반딧불',vignette:'가장자리 어둡게'};
export const OVERLAY_KINDS=Object.keys(OVERLAY_LABELS).filter(k=>k!=='none');
const MODES:Record<string,OverlayMode>={light_rays:'screen',sparkle:'screen',dust:'screen',snow:'screen',rain:'screen',fog:'screen',stars:'screen',fireflies:'screen',petals:'alpha',glow:'filter',vignette:'filter'};
export const isOverlay=(k:unknown):k is string=>typeof k==='string'&&k in MODES;
export const overlayMode=(k:string):OverlayMode|null=>MODES[k]??null;

/** 그리는 해상도: 입자는 640px 너비(미리보기 영상은 절반), 빛줄기 320, 안개 160 — 부드러운 효과라 키워도 티가 안 난다 */
export function overlaySize(kind:string,aspect:number,draft=false):{w:number;h:number}|null{
  const m=overlayMode(kind);if(!m||m==='filter')return null;
  const base=kind==='fog'?160:kind==='light_rays'?320:draft?320:640;
  const a=Math.max(.3,Math.min(3.5,aspect||16/9));
  const w=a>=1?base:Math.round(base*a/2)*2;const h=Math.max(2,Math.round(w/a/2)*2);
  return {w,h};
}

// ── 정해진 난수 ──
const frac=(x:number)=>x-Math.floor(x);
export const rnd=(i:number,k:number)=>frac(Math.sin(i*12.9898+k*78.233+k*k*.137)*43758.5453);
const clamp=(v:number,a:number,b:number)=>v<a?a:v>b?b:v;

type Buf=Uint8ClampedArray|Uint8Array;
/** 밝기를 더한다 (screen 효과: 검은 바탕 위 빛) */
function addPx(b:Buf,w:number,x:number,y:number,r:number,g:number,bl:number,v:number){
  const i=(y*w+x)*4;b[i]=Math.min(255,b[i]+r*v);b[i+1]=Math.min(255,b[i+1]+g*v);b[i+2]=Math.min(255,b[i+2]+bl*v);
}
/** 부드러운 빛 점 */
function glowDot(b:Buf,w:number,h:number,cx:number,cy:number,rad:number,col:[number,number,number],a:number){
  if(a<=0)return;const R=Math.max(.8,rad);const x0=Math.max(0,Math.floor(cx-R)),x1=Math.min(w-1,Math.ceil(cx+R)),y0=Math.max(0,Math.floor(cy-R)),y1=Math.min(h-1,Math.ceil(cy+R));
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const d=Math.hypot(x+.5-cx,y+.5-cy)/R;if(d>=1)continue;const f=(1-d)*(1-d);addPx(b,w,x,y,col[0],col[1],col[2],a*f);}
}
/** 가는 빛 선 (반짝임 십자, 빗줄기) */
function glowLine(b:Buf,w:number,h:number,x0:number,y0:number,x1:number,y1:number,col:[number,number,number],a:number){
  const n=Math.max(1,Math.ceil(Math.hypot(x1-x0,y1-y0)*1.5));
  for(let s=0;s<=n;s++){const u=s/n;const x=Math.round(x0+(x1-x0)*u),y=Math.round(y0+(y1-y0)*u);if(x<0||y<0||x>=w||y>=h)continue;
    const taper=1-Math.abs(u-.5)*2*.7;addPx(b,w,x,y,col[0],col[1],col[2],a*taper);}
}
/** 덮어 그리는 타원 (꽃잎, alpha 모드) */
function petal(b:Buf,w:number,h:number,cx:number,cy:number,rx:number,ry:number,ang:number,col:[number,number,number],a:number){
  const R=Math.max(rx,ry)+1;const c=Math.cos(ang),s=Math.sin(ang);
  const x0=Math.max(0,Math.floor(cx-R)),x1=Math.min(w-1,Math.ceil(cx+R)),y0=Math.max(0,Math.floor(cy-R)),y1=Math.min(h-1,Math.ceil(cy+R));
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
    const dx=x+.5-cx,dy=y+.5-cy;const u=(dx*c+dy*s)/rx,v=(-dx*s+dy*c)/ry;const d=u*u+v*v;if(d>=1)continue;
    const al=a*Math.min(1,(1-d)*3);const i=(y*w+x)*4;const shade=.85+.15*(1-Math.abs(v));
    const oa=b[i+3]/255;const na=al+oa*(1-al);if(na<=0)continue;
    for(let k=0;k<3;k++)b[i+k]=(col[k]*shade*al+b[i+k]*oa*(1-al))/na;b[i+3]=na*255;
  }
}
// 빛줄기용 각도·거리 표 (크기마다 한 번)
const rayCache=new Map<string,{ang:Float32Array;dist:Float32Array}>();
function rayTable(w:number,h:number){
  const key=`${w}x${h}`;let t=rayCache.get(key);if(t)return t;
  const ox=-.12*w,oy=-.2*h;const diag=Math.hypot(w-ox,h-oy);const ang=new Float32Array(w*h),dist=new Float32Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;ang[i]=Math.atan2(y+.5-oy,x+.5-ox);dist[i]=Math.hypot(x+.5-ox,y+.5-oy)/diag;}
  t={ang,dist};rayCache.set(key,t);return t;
}
// 안개용 매끄러운 값 잡음
function vnoise(x:number,y:number,seed:number){
  const xi=Math.floor(x),yi=Math.floor(y),xf=x-xi,yf=y-yi;const s=(v:number)=>v*v*(3-2*v);
  const h=(a:number,b:number)=>rnd(a*57+b*131+seed*17,seed);
  const a=h(xi,yi),b=h(xi+1,yi),c=h(xi,yi+1),d=h(xi+1,yi+1);const u=s(xf),v=s(yf);
  return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;
}

/** 효과 한 프레임을 buf(RGBA, w×h)에 그린다. strength 0~1. screen 효과는 검은 바탕 위 빛(알파 255), alpha 효과는 투명 바탕 위 그림 */
export function drawOverlay(kind:string,buf:Buf,w:number,h:number,t:number,strength:number):void{
  const mode=overlayMode(kind);buf.fill(0);if(!mode||mode==='filter')return;
  const s=clamp(Number.isFinite(strength)?strength:.5,0,1);const A=.35+.65*s;const k=w/640; // 크기 배율 (640 기준)
  // 개수는 그리는 크기와 상관없이 같게 (미리보기는 작게 그려도 완성 영상과 같은 입자) — 화면 비율만 반영
  const count=(base:number)=>Math.max(1,Math.round(base*(.5+s)*Math.max(.6,Math.min(1.6,(w/h)/(16/9)))));
  switch(kind){
    case 'dust':{const n=count(60);for(let i=0;i<n;i++){
      const x=frac(rnd(i,1)+.012*t*(rnd(i,3)-.5)*2+.015*Math.sin(t*.3+rnd(i,4)*6.28))*w;
      const y=frac(rnd(i,2)-.007*t*(.4+rnd(i,3))+.01*Math.cos(t*.25+rnd(i,5)*6.28))*h;
      const tw=.55+.45*Math.sin(t*(.5+rnd(i,6))+rnd(i,7)*6.28);glowDot(buf,w,h,x,y,(1.8+3*rnd(i,8))*k,[255,238,205],.9*A*tw);}break;}
    case 'sparkle':{const n=count(34);for(let i=0;i<n;i++){
      const x=frac(rnd(i,1)+.004*t*(rnd(i,9)-.5))*w,y=frac(rnd(i,2)+.003*t*(rnd(i,10)-.5))*h;
      const p=Math.pow(Math.max(0,Math.sin(t*(1.1+rnd(i,3)*1.6)+rnd(i,4)*40)),6);if(p<.02)continue;
      const L=(5+9*rnd(i,5))*k*p;const col:[number,number,number]=rnd(i,6)>.5?[255,244,214]:[255,255,255];
      glowDot(buf,w,h,x,y,(2+2*rnd(i,7))*k,col,A*p);glowLine(buf,w,h,x-L,y,x+L,y,col,.9*A*p);glowLine(buf,w,h,x,y-L,x,y+L,col,.9*A*p);}break;}
    case 'fireflies':{const n=count(16);for(let i=0;i<n;i++){
      const x=(rnd(i,1)+.06*Math.sin(t*.37*(.5+rnd(i,3))+rnd(i,4)*6.28)+.03*Math.sin(t*1.1*(.5+rnd(i,11))))*w;
      const y=(.32+.62*rnd(i,2)+.05*Math.cos(t*.31*(.5+rnd(i,5))+rnd(i,6)*6.28))*h;
      const p=Math.max(0,.15+.85*Math.sin(t*(.7+rnd(i,7)*.9)+rnd(i,8)*6.28));
      glowDot(buf,w,h,x,y,(11+7*rnd(i,9))*k,[180,255,90],.8*A*p);glowDot(buf,w,h,x,y,3.2*k,[250,255,210],1.3*A*p);}break;}
    case 'stars':{const n=count(90);for(let i=0;i<n;i++){
      const x=rnd(i,1)*w,y=Math.pow(rnd(i,2),1.4)*h*.65;const tw=.55+.45*Math.sin(t*(1+2.2*rnd(i,3))+rnd(i,4)*6.28);
      const big=rnd(i,5)>.9;glowDot(buf,w,h,x,y,(big?3.6:1.8+1.2*rnd(i,6))*k,[230,238,255],(big?1.4:1)*A*tw);}break;}
    case 'snow':{const n=count(100);for(let i=0;i<n;i++){
      const v=.035+.07*rnd(i,3);const y=frac(rnd(i,2)+v*t)*(h+12*k)-6*k;
      const x=frac(rnd(i,1)+.025*Math.sin(t*(.4+rnd(i,4))+rnd(i,5)*6.28)+.01*t*(rnd(i,6)-.3))*w;
      glowDot(buf,w,h,x,y,(1.3+2.7*rnd(i,7))*k,[255,255,255],(.55+.4*rnd(i,8))*A);}break;}
    case 'rain':{const n=count(130);for(let i=0;i<n;i++){
      const v=.9+.6*rnd(i,3);const len=(12+12*rnd(i,4))*k;const yy=frac(rnd(i,2)+v*t)*(h+len*2)-len;const x=frac(rnd(i,1)+.18*yy/h)*w;
      glowLine(buf,w,h,x,yy,x-len*.22,yy-len,[195,212,235],.38*A*(.6+.4*rnd(i,5)));}break;}
    case 'petals':{const n=count(20);for(let i=0;i<n;i++){
      const v=.045+.05*rnd(i,3);const y=frac(rnd(i,2)+v*t)*(h+24*k)-12*k;
      const x=frac(rnd(i,1)+.04*Math.sin(t*(.5+rnd(i,4))+rnd(i,5)*6.28)+.02*t*(rnd(i,6)-.2))*w;
      const ang=t*(.6+rnd(i,7))*1.6+rnd(i,8)*6.28;const flip=.45+.55*Math.abs(Math.sin(t*(.8+rnd(i,9))+rnd(i,10)*6.28));
      const col:[number,number,number]=rnd(i,11)>.4?[247,184,201]:[252,214,222];petal(buf,w,h,x,y,(5+3*rnd(i,12))*k,(3+1.6*rnd(i,12))*k*flip,ang,col,.9*A);}break;}
    case 'light_rays':{const {ang,dist}=rayTable(w,h);const beams=[0,1,2,3,4].map(b=>({a:.42+b*.14+.05*rnd(b,1)+.02*Math.sin(t*.15+b*1.7),wd:.025+.03*rnd(b,2),p:.55+.45*Math.sin(t*(.35+.2*rnd(b,3))+b*2.1)}));
      for(let i=0;i<w*h;i++){let v=0;const th=ang[i];for(const bm of beams){const d=(th-bm.a)/bm.wd;if(d>-3&&d<3)v+=Math.exp(-d*d)*bm.p;}
        if(v<=.002)continue;const f=Math.max(0,1-dist[i]*1.05);const val=v*f*f*.5*A;const j=i*4;
        buf[j]=Math.min(255,255*val);buf[j+1]=Math.min(255,236*val);buf[j+2]=Math.min(255,196*val);}break;}
    case 'fog':{for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const u=x/w*4,vv=y/h*2.4;const n=.6*vnoise(u+.05*t,vv+.01*t,3)+.4*vnoise(u*2.1-.08*t,vv*2.1+.02*t,7);
      const low=.55+.45*(y/h);const val=Math.max(0,n-.35)*1.4*low*.55*A;const j=(y*w+x)*4;buf[j]=Math.min(255,236*val);buf[j+1]=Math.min(255,239*val);buf[j+2]=Math.min(255,244*val);}break;}
  }
  if(mode==='screen')for(let i=3;i<buf.length;i+=4)buf[i]=255;
}

/** 빛 번짐(glow) 세기 → 번지는 정도·섞는 양 (렌더·미리보기 공용) */
export function glowParams(strength:number,height:number){const s=clamp(Number.isFinite(strength)?strength:.5,0,1);return {sigma:Math.max(2,height/60*(.7+.6*s)),opacity:.22+.4*s,lift:.04+.06*s};}
