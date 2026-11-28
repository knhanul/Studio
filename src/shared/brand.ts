/** 브랜드: 「고모 편집실」 또는 「누니 편집실」. 빌드·테스트할 때 정해지며 기본은 누니.
 *  - 빌드 때 electron.vite.config.ts 가 __BRAND_ID__ 를 넣는다 (BRAND_ID=gomo 로 고모, 그 밖은 누니)
 *  - 화면 표시 이름·아이콘·설치 파일 이름만 바뀐다. 프로젝트 파일 형식·저장 형식은 두 브랜드가 같다.
 *  - 고모 편집실은 예전과 같은 식별자(appId·저장 폴더)를 그대로 쓰고, 누니 편집실은 따로 설치·저장된다.
 */
declare const __BRAND_ID__: string | undefined;
export type BrandId = 'gomo' | 'nuni';

export const BRANDS = {
  gomo: {
    id: 'gomo', nameKo: '고모 편집실', nameEn: 'GOMO Studio', appName: '고모 편집실',
    suiteKo: '고모 미디어공방', suiteEn: 'GOMO Media Workshop', mark: 'GOMO',
    accent: '#ef845e', accentHover: '#ffa17e', subtitle: '목소리를 더해, 작품을 완성하다',
    appId: 'com.gomoworkshop.compose', iconDir: 'resources/brands/gomo'
  },
  nuni: {
    id: 'nuni', nameKo: '누니 편집실', nameEn: 'NUNI Studio', appName: '누니 편집실',
    suiteKo: '누니 미디어공방', suiteEn: 'NUNI Media Workshop', mark: 'NUNI',
    accent: '#FC6719', accentHover: '#FF7A2E', subtitle: '목소리를 더해, 작품을 완성하다',
    appId: 'com.nunistudio.compose', iconDir: 'resources/brands/nuni'
  }
} as const;

export const BRAND_ID: BrandId = typeof __BRAND_ID__ === 'string' && __BRAND_ID__ === 'gomo' ? 'gomo' : 'nuni';
export const BRAND = BRANDS[BRAND_ID];

export const INTERNAL = {schemaVersion:2, storageKey:'composer-project-v2', appId:'com.gomoworkshop.compose'} as const;
