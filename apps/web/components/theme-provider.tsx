"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { apiFetch } from "@/lib/api";
import { applyTheme, DEFAULT_BASE_ID, DEFAULT_ACCENT_ID } from "@/lib/themes";

interface ThemeContextValue {
  baseId: string;
  accentId: string;
  setBaseId: (id: string) => void;
  setAccentId: (id: string) => void;
  saveTheme: () => Promise<void>;
  saving: boolean;
  saved: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
  baseId: DEFAULT_BASE_ID,
  accentId: DEFAULT_ACCENT_ID,
  setBaseId: () => {},
  setAccentId: () => {},
  saveTheme: async () => {},
  saving: false,
  saved: false
});

/** Migrate old single-ID themes to base:accent */
function migrateLegacyTheme(raw: string): { base: string; accent: string } {
  if (raw.includes(":")) {
    const [base, accent] = raw.split(":");
    return { base: base || DEFAULT_BASE_ID, accent: accent || DEFAULT_ACCENT_ID };
  }
  const legacyMap: Record<string, { base: string; accent: string }> = {
    "claude-warm": { base: "warm", accent: "green" },
    "midnight": { base: "midnight", accent: "blue" },
    "pure-dark": { base: "obsidian", accent: "blue" },
    "forest": { base: "forest", accent: "teal" },
    "sunset": { base: "warm", accent: "orange" },
    "ocean": { base: "midnight", accent: "cyan" },
    "lavender": { base: "midnight", accent: "violet" },
    "rose": { base: "midnight", accent: "rose" },
    "slate": { base: "slate", accent: "indigo" },
    "nordic": { base: "slate", accent: "cyan" }
  };
  return legacyMap[raw] ?? { base: DEFAULT_BASE_ID, accent: DEFAULT_ACCENT_ID };
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [baseId, setBaseIdState] = useState(DEFAULT_BASE_ID);
  const [accentId, setAccentIdState] = useState(DEFAULT_ACCENT_ID);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Load saved theme on mount
  useEffect(() => {
    apiFetch<{ data: { themeId: string } }>("admin/preferences")
      .then((res) => {
        const raw = res.data?.themeId ?? "";
        const { base, accent } = migrateLegacyTheme(raw);
        setBaseIdState(base);
        setAccentIdState(accent);
        applyTheme(base, accent);
      })
      .catch(() => {
        applyTheme(DEFAULT_BASE_ID, DEFAULT_ACCENT_ID);
      });
  }, []);

  const setBaseId = (id: string) => {
    setBaseIdState(id);
    setSaved(false);
    applyTheme(id, accentId);
  };

  const setAccentId = (id: string) => {
    setAccentIdState(id);
    setSaved(false);
    applyTheme(baseId, id);
  };

  const saveTheme = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await apiFetch("admin/preferences", {
        method: "PUT",
        body: JSON.stringify({ themeId: `${baseId}:${accentId}` })
      });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ThemeContext.Provider value={{ baseId, accentId, setBaseId, setAccentId, saveTheme, saving, saved }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
