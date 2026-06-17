export interface ThemeColors {
  bgBase: string;
  bgSurface: string;
  bgElevated: string;
  bgInput: string;
  borderSubtle: string;
  borderDefault: string;
  borderStrong: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentHover: string;
  accentText: string;
  danger: string;
  warning: string;
  info: string;
}

export interface ThemePreset {
  id: string;
  name: string;
  description: string;
  colors: ThemeColors;
}

export const DEFAULT_THEME_ID = "claude-warm";

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "claude-warm",
    name: "Claude Warm",
    description: "Warm charcoal mit Sage Green",
    colors: {
      bgBase: "#1a1a19", bgSurface: "#232220", bgElevated: "#2a2825", bgInput: "#1f1e1c",
      borderSubtle: "rgba(255,255,255,0.06)", borderDefault: "rgba(255,255,255,0.08)", borderStrong: "rgba(255,255,255,0.12)",
      textPrimary: "#ece9e4", textSecondary: "#b8b3a8", textMuted: "#807a6f",
      accent: "#7aab5e", accentHover: "#8fc068", accentText: "#9bc480",
      danger: "#d65d5d", warning: "#e0a83e", info: "#6ba4d0"
    }
  },
  {
    id: "midnight",
    name: "Midnight",
    description: "Deep Navy mit Blue",
    colors: {
      bgBase: "#0f1729", bgSurface: "#162038", bgElevated: "#1d2a45", bgInput: "#131c30",
      borderSubtle: "rgba(255,255,255,0.06)", borderDefault: "rgba(255,255,255,0.08)", borderStrong: "rgba(255,255,255,0.12)",
      textPrimary: "#e2e8f0", textSecondary: "#94a3b8", textMuted: "#64748b",
      accent: "#3b82f6", accentHover: "#60a5fa", accentText: "#93c5fd",
      danger: "#ef4444", warning: "#f59e0b", info: "#38bdf8"
    }
  },
  {
    id: "pure-dark",
    name: "Pure Dark",
    description: "True Black mit White",
    colors: {
      bgBase: "#0a0a0a", bgSurface: "#141414", bgElevated: "#1c1c1c", bgInput: "#0f0f0f",
      borderSubtle: "rgba(255,255,255,0.05)", borderDefault: "rgba(255,255,255,0.08)", borderStrong: "rgba(255,255,255,0.12)",
      textPrimary: "#fafafa", textSecondary: "#a3a3a3", textMuted: "#737373",
      accent: "#e5e5e5", accentHover: "#ffffff", accentText: "#d4d4d4",
      danger: "#dc2626", warning: "#facc15", info: "#60a5fa"
    }
  },
  {
    id: "forest",
    name: "Forest",
    description: "Dark Green mit Emerald",
    colors: {
      bgBase: "#0d1a12", bgSurface: "#13251a", bgElevated: "#1a3022", bgInput: "#101e15",
      borderSubtle: "rgba(255,255,255,0.06)", borderDefault: "rgba(255,255,255,0.08)", borderStrong: "rgba(255,255,255,0.12)",
      textPrimary: "#e8f5e9", textSecondary: "#a5d6a7", textMuted: "#66bb6a",
      accent: "#10b981", accentHover: "#34d399", accentText: "#6ee7b7",
      danger: "#ef4444", warning: "#f59e0b", info: "#38bdf8"
    }
  },
  {
    id: "sunset",
    name: "Sunset",
    description: "Warm Dark mit Orange",
    colors: {
      bgBase: "#1c1410", bgSurface: "#281c16", bgElevated: "#33251d", bgInput: "#221814",
      borderSubtle: "rgba(255,255,255,0.06)", borderDefault: "rgba(255,255,255,0.08)", borderStrong: "rgba(255,255,255,0.12)",
      textPrimary: "#fef3e2", textSecondary: "#fcd9b6", textMuted: "#d4a574",
      accent: "#f97316", accentHover: "#fb923c", accentText: "#fdba74",
      danger: "#ef4444", warning: "#eab308", info: "#0ea5e9"
    }
  },
  {
    id: "ocean",
    name: "Ocean",
    description: "Dark Teal mit Cyan",
    colors: {
      bgBase: "#0a1a1e", bgSurface: "#102530", bgElevated: "#16303d", bgInput: "#0c1e24",
      borderSubtle: "rgba(255,255,255,0.06)", borderDefault: "rgba(255,255,255,0.08)", borderStrong: "rgba(255,255,255,0.12)",
      textPrimary: "#e0f7fa", textSecondary: "#b2ebf2", textMuted: "#80cbc4",
      accent: "#06b6d4", accentHover: "#22d3ee", accentText: "#67e8f9",
      danger: "#ef4444", warning: "#f59e0b", info: "#818cf8"
    }
  },
  {
    id: "lavender",
    name: "Lavender",
    description: "Dark Purple mit Violet",
    colors: {
      bgBase: "#161024", bgSurface: "#1f1830", bgElevated: "#2a2140", bgInput: "#1a1428",
      borderSubtle: "rgba(255,255,255,0.06)", borderDefault: "rgba(255,255,255,0.08)", borderStrong: "rgba(255,255,255,0.12)",
      textPrimary: "#f3e8ff", textSecondary: "#d8b4fe", textMuted: "#a78bfa",
      accent: "#8b5cf6", accentHover: "#a78bfa", accentText: "#c4b5fd",
      danger: "#ef4444", warning: "#f59e0b", info: "#60a5fa"
    }
  },
  {
    id: "rose",
    name: "Rose",
    description: "Dark Wine mit Rose",
    colors: {
      bgBase: "#1a0e12", bgSurface: "#26161c", bgElevated: "#321e26", bgInput: "#1e1116",
      borderSubtle: "rgba(255,255,255,0.06)", borderDefault: "rgba(255,255,255,0.08)", borderStrong: "rgba(255,255,255,0.12)",
      textPrimary: "#ffe4e6", textSecondary: "#fda4af", textMuted: "#f472b6",
      accent: "#f43f5e", accentHover: "#fb7185", accentText: "#fda4af",
      danger: "#dc2626", warning: "#f59e0b", info: "#60a5fa"
    }
  },
  {
    id: "slate",
    name: "Slate",
    description: "Cool Gray mit Steel",
    colors: {
      bgBase: "#1a1d23", bgSurface: "#252a33", bgElevated: "#2f3640", bgInput: "#1e222a",
      borderSubtle: "rgba(255,255,255,0.06)", borderDefault: "rgba(255,255,255,0.08)", borderStrong: "rgba(255,255,255,0.12)",
      textPrimary: "#e2e8f0", textSecondary: "#94a3b8", textMuted: "#64748b",
      accent: "#64748b", accentHover: "#94a3b8", accentText: "#cbd5e1",
      danger: "#ef4444", warning: "#f59e0b", info: "#60a5fa"
    }
  },
  {
    id: "nordic",
    name: "Nordic",
    description: "Nord-inspired mit Frost",
    colors: {
      bgBase: "#1e222a", bgSurface: "#2a2f3a", bgElevated: "#363c49", bgInput: "#232831",
      borderSubtle: "rgba(255,255,255,0.06)", borderDefault: "rgba(255,255,255,0.08)", borderStrong: "rgba(255,255,255,0.12)",
      textPrimary: "#e5e9f0", textSecondary: "#b8bfd0", textMuted: "#8b95a8",
      accent: "#88c0d0", accentHover: "#a3d1e0", accentText: "#9ec4d4",
      danger: "#bf616a", warning: "#ebcb8b", info: "#81a1c1"
    }
  }
];

const COLOR_TO_CSS: Record<keyof ThemeColors, string> = {
  bgBase: "--bg-base",
  bgSurface: "--bg-surface",
  bgElevated: "--bg-elevated",
  bgInput: "--bg-input",
  borderSubtle: "--border-subtle",
  borderDefault: "--border-default",
  borderStrong: "--border-strong",
  textPrimary: "--text-primary",
  textSecondary: "--text-secondary",
  textMuted: "--text-muted",
  accent: "--accent",
  accentHover: "--accent-hover",
  accentText: "--accent-text",
  danger: "--danger",
  warning: "--warning",
  info: "--info"
};

export function applyTheme(themeId: string): void {
  const preset = THEME_PRESETS.find((t) => t.id === themeId) ?? THEME_PRESETS[0]!;
  const root = document.documentElement;
  for (const [key, cssVar] of Object.entries(COLOR_TO_CSS)) {
    const value = preset.colors[key as keyof ThemeColors];
    if (value) root.style.setProperty(cssVar, value);
  }
  // Derived colors
  root.style.setProperty("--accent-muted", preset.colors.accent + "1f");
  root.style.setProperty("--accent-subtle", preset.colors.accent + "0f");
  root.style.setProperty("--bg-hover", "rgba(255, 255, 255, 0.05)");
  root.style.setProperty("--danger-muted", preset.colors.danger + "1f");
  root.style.setProperty("--warning-muted", preset.colors.warning + "1f");
  root.style.setProperty("--info-muted", preset.colors.info + "1f");
  // Meta theme-color
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", preset.colors.bgBase);
}

export function isValidThemeId(id: string): boolean {
  return THEME_PRESETS.some((t) => t.id === id);
}
