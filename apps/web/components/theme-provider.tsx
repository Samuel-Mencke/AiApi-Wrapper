"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { apiFetch } from "@/lib/api";
import { applyTheme, DEFAULT_THEME_ID, THEME_PRESETS } from "@/lib/themes";

interface ThemeContextValue {
  themeId: string;
  setThemeId: (id: string) => void;
  saveTheme: (id: string) => Promise<void>;
  saving: boolean;
  saved: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
  themeId: DEFAULT_THEME_ID,
  setThemeId: () => {},
  saveTheme: async () => {},
  saving: false,
  saved: false
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeIdState] = useState(DEFAULT_THEME_ID);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Load saved theme on mount
  useEffect(() => {
    apiFetch<{ data: { themeId: string } }>("/admin/preferences")
      .then((res) => {
        const id = res.data?.themeId ?? DEFAULT_THEME_ID;
        setThemeIdState(id);
        applyTheme(id);
      })
      .catch(() => {
        applyTheme(DEFAULT_THEME_ID);
      });
  }, []);

  // Apply theme immediately when changed (live preview)
  const setThemeId = (id: string) => {
    setThemeIdState(id);
    setSaved(false);
    applyTheme(id);
  };

  const saveTheme = async (id: string) => {
    setSaving(true);
    setSaved(false);
    try {
      await apiFetch("/admin/preferences", {
        method: "PUT",
        body: JSON.stringify({ themeId: id })
      });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ThemeContext.Provider value={{ themeId, setThemeId, saveTheme, saving, saved }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

export { THEME_PRESETS };
