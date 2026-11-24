import { createContext, useCallback, useEffect, useState, type ReactNode } from 'react';
import { DEFAULT_THEME, THEME_STORAGE_KEY, AUTO_THEME_STORAGE_KEY, isValidTheme, type ThemeId } from './theme';

type ThemeContextValue = {
  theme: ThemeId;
  auto: boolean;
  setTheme: (id: ThemeId) => void;
  setAuto: (enabled: boolean) => void;
};

export const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyTheme(id: ThemeId) {
  document.documentElement.setAttribute('data-theme', id);
  document.documentElement.style.colorScheme = id === 'dark' ? 'dark' : 'light';
}

function readStored(): { theme: ThemeId; auto: boolean } {
  try {
    const rawTheme = localStorage.getItem(THEME_STORAGE_KEY);
    const rawAuto = localStorage.getItem(AUTO_THEME_STORAGE_KEY);
    const theme = rawTheme && isValidTheme(rawTheme) ? rawTheme : DEFAULT_THEME;
    const auto = rawAuto === '1';
    return { theme, auto };
  } catch {
    return { theme: DEFAULT_THEME, auto: false };
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [{ theme, auto }, setState] = useState(readStored);

  const setTheme = useCallback((id: ThemeId) => {
    setState(s => ({ ...s, theme: id }));
    localStorage.setItem(THEME_STORAGE_KEY, id);
    applyTheme(id);
  }, []);

  const setAuto = useCallback((enabled: boolean) => {
    setState(s => ({ ...s, auto: enabled }));
    localStorage.setItem(AUTO_THEME_STORAGE_KEY, enabled ? '1' : '0');
    if (enabled) {
      // System theme will be applied via effect / IPC if available
      const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
      const next = prefersDark ? 'dark' : 'light-blue';
      applyTheme(next);
      setState(s => ({ ...s, theme: next }));
    } else {
      applyTheme(theme);
    }
  }, [theme]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (!auto) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => {
      const next: ThemeId = e.matches ? 'dark' : 'light-blue';
      applyTheme(next);
      setState(s => ({ ...s, theme: next }));
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [auto]);

  // Optional: Electron nativeTheme via compose if exposed later
  useEffect(() => {
    // Placeholder for future IPC system theme sync
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, auto, setTheme, setAuto }}>
      {children}
    </ThemeContext.Provider>
  );
}
