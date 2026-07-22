import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const ThemeContext = createContext(null);
const THEME_STORAGE_KEY = 'hcw-theme';

function getSystemTheme() {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getInitialTheme() {
  if (typeof window === 'undefined') return 'dark';
  try {
    const savedTheme = window.localStorage?.getItem(THEME_STORAGE_KEY);
    if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme;
  } catch {
    // Ignore storage access issues and fall back to the OS preference.
  }
  return getSystemTheme();
}

function hasUserPreference() {
  if (typeof window === 'undefined') return false;
  try {
    const saved = window.localStorage?.getItem(THEME_STORAGE_KEY);
    return saved === 'light' || saved === 'dark';
  } catch {
    return false;
  }
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(getInitialTheme);
  const [userOverride, setUserOverride] = useState(hasUserPreference);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;
  }, [theme]);

  // Track OS preference changes; only follow them if the user hasn't picked.
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (event) => {
      if (!userOverride) {
        setThemeState(event.matches ? 'dark' : 'light');
      }
    };
    media.addEventListener?.('change', handler);
    return () => media.removeEventListener?.('change', handler);
  }, [userOverride]);

  const setTheme = (next) => {
    setThemeState(next);
    setUserOverride(true);
    try {
      window.localStorage?.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Ignore storage access issues.
    }
  };

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      toggleTheme: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
      resetToSystem: () => {
        try {
          window.localStorage?.removeItem(THEME_STORAGE_KEY);
        } catch {
          // Ignore storage access issues.
        }
        setUserOverride(false);
        setThemeState(getSystemTheme());
      },
    }),
    [theme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider.');
  }
  return context;
}
