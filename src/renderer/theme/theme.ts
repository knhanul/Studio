export type ThemeId = 'light-blue' | 'warm-cream' | 'silver-light' | 'dark';

export const THEME_IDS: ThemeId[] = ['light-blue', 'warm-cream', 'silver-light', 'dark'];

export const THEMES: Record<ThemeId, { name: string; description: string; preview: string }> = {
  'light-blue': {
    name: '화이트 블루',
    description: '깨끗하고 전문적인 Windows 스타일',
    preview: '#427db6'
  },
  'warm-cream': {
    name: '웜 크림',
    description: '따뜻하고 감성적인 창작 환경',
    preview: '#c57a38'
  },
  'silver-light': {
    name: '실버 라이트',
    description: '차분하고 정돈된 전문가용',
    preview: '#61768b'
  },
  dark: {
    name: '다크',
    description: '기존 고모 편집실 어두운 디자인',
    preview: '#ef845e'
  }
};

export const DEFAULT_THEME: ThemeId = 'light-blue';
export const THEME_STORAGE_KEY = 'gomo-compose-theme';
export const AUTO_THEME_STORAGE_KEY = 'gomo-compose-auto-theme';

export function isValidTheme(id: string): id is ThemeId {
  return THEME_IDS.includes(id as ThemeId);
}
