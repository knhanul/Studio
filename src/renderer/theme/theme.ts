export type ThemeId = 'light-blue' | 'warm-cream' | 'silver-light' | 'dark';

export const THEME_IDS: ThemeId[] = ['light-blue', 'warm-cream', 'silver-light', 'dark'];

export const THEME_META: Record<ThemeId, { name: string; nameEn: string; description: string; preview: string }> = {
  'light-blue': { name: '화이트 블루', nameEn: 'White Blue', description: '깨끗하고 전문적인 기본 테마', preview: '#427DB6' },
  'warm-cream': { name: '웜 크림', nameEn: 'Warm Cream', description: '따뜻하고 편안한 창작 공간', preview: '#C57A38' },
  'silver-light': { name: '실버 라이트', nameEn: 'Silver Light', description: '절제된 고급 업무 스타일', preview: '#61768B' },
  dark: { name: '다크', nameEn: 'Dark', description: '기존 다크 테마 유지', preview: '#EF845E' },
};

export const DEFAULT_THEME: ThemeId = 'light-blue';
export const THEME_STORAGE_KEY = 'compose-theme';
export const AUTO_THEME_STORAGE_KEY = 'compose-theme-system-sync';

export function isValidTheme(id: string): id is ThemeId {
  return THEME_IDS.includes(id as ThemeId);
}
