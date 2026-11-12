import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'dark');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('devcollab-theme', theme); } catch { /* Session preference still applies. */ }
  }, [theme]);

  const toggleTheme = useCallback(() => setTheme((current) => current === 'dark' ? 'light' : 'dark'), []);
  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, toggleTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider.');
  return value;
}
