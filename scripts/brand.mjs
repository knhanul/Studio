// 브랜드를 골라 실행한다. 기본은 누니 편집실, 「gomo」를 주면 고모 편집실.
//   npm run dev            → 누니 편집실 (개발 실행)
//   npm run dev -- gomo    → 고모 편집실
//   npm run build -- gomo / npm test -- gomo / npm run dist:win -- gomo ...
import {spawnSync} from 'node:child_process';

const BRANDS={
  gomo:{productName:'고모 편집실',appId:'com.gomoworkshop.compose',icon:'resources/brands/gomo/app.ico'},
  nuni:{productName:'누니 편집실',appId:'com.nunistudio.compose',icon:'resources/brands/nuni/app.ico'}
};
const [, , cmd = 'dev', given] = process.argv;
const brand = given ?? process.env.BRAND_ID ?? 'nuni';
if (!BRANDS[brand]) {
  console.error(`알 수 없는 브랜드: ${brand}  (gomo 또는 nuni 를 쓰세요. 예: npm run ${cmd} -- gomo)`);
  process.exit(1);
}
const b = BRANDS[brand];
const builder = `-c.productName="${b.productName}" -c.appId=${b.appId} -c.win.icon=${b.icon}`;
const STEPS = {
  'dev': ['electron-vite dev'],
  'build': ['electron-vite build'],
  'test': ['node scripts/test.mjs'],
  'test:render': ['node scripts/render-smoke.mjs'],
  'dist:dir': ['electron-vite build', `electron-builder --dir ${builder}`],
  'dist:win': ['electron-vite build', `electron-builder --win nsis portable --x64 ${builder}`]
};
if (!STEPS[cmd]) {
  console.error(`알 수 없는 명령: ${cmd}`);
  process.exit(1);
}
console.log(`[브랜드] ${b.productName} (${brand})`);
for (const step of STEPS[cmd]) {
  const r = spawnSync(step, {shell: true, stdio: 'inherit', env: {...process.env, BRAND_ID: brand}});
  if (r.status !== 0) process.exit(r.status ?? 1);
}
