import React, { createContext, useContext, useState, useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { ThemeColors, darkColors, lightColors, terminalPalettes, TerminalPalette } from './colors';
import { AppSettings, HostStorageService } from '../services/persistence/HostStorageService';

interface ThemeContextType {
  isDark: boolean;
  colors: ThemeColors;
  terminalPalette: TerminalPalette;
  terminalThemeName: TerminalThemeName;
  themePreference: ThemePreference;
  setThemePreference: (pref: ThemePreference) => Promise<void>;
  setTerminalThemeName: (name: TerminalThemeName) => Promise<void>;
}

type ThemePreference = AppSettings['theme'];
type TerminalThemeName = AppSettings['terminalTheme'];

const ThemeContext = createContext<ThemeContextType>({
  isDark: true,
  colors: darkColors,
  terminalPalette: terminalPalettes.nord,
  terminalThemeName: 'nord',
  themePreference: 'system',
  setThemePreference: async () => {},
  setTerminalThemeName: async () => {},
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const systemScheme = useColorScheme();
  const [themePreference, setThemePref] = useState<ThemePreference>('system');
  const [terminalThemeName, setTermThemeName] = useState<TerminalThemeName>('nord');

  useEffect(() => {
    HostStorageService.getSettings().then(settings => {
      setThemePref(settings.theme);
      setTermThemeName(settings.terminalTheme);
    });
  }, []);

  const isDark = themePreference === 'system' ? systemScheme !== 'light' : themePreference === 'dark';
  const colors = isDark ? darkColors : lightColors;
  const terminalPalette = terminalPalettes[terminalThemeName] || terminalPalettes.nord;

  const setThemePreference = async (pref: ThemePreference) => {
    setThemePref(pref);
    await HostStorageService.updateSettings({ theme: pref });
  };

  const setTerminalThemeName = async (name: TerminalThemeName) => {
    setTermThemeName(name);
    await HostStorageService.updateSettings({ terminalTheme: name });
  };

  return (
    <ThemeContext.Provider
      value={{
        isDark,
        colors,
        terminalPalette,
        terminalThemeName,
        themePreference,
        setThemePreference,
        setTerminalThemeName,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
