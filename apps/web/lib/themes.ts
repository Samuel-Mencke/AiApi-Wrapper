// ═══════════════════════════════════════════════════════════════════════
// THEME SYSTEM — lightweight, no CSS hacks
// Components use semantic Tailwind utilities (bg-canvas, text-ink, etc.)
// which reference CSS variables. Theme switching = swap variables.
// ═══════════════════════════════════════════════════════════════════════

export interface BaseColors {
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
}

export interface BaseTheme {
  id: string;
  name: string;
  colors: BaseColors;
}

export const BASE_THEMES: BaseTheme[] = [
  {
    id: "obsidian",
    name: "Obsidian",
    colors: {
      bgBase: "#0a0a0a", bgSurface: "#131313", bgElevated: "#1c1c1c", bgInput: "#0f0f0f",
      borderSubtle: "rgba(255,255,255,0.055)", borderDefault: "rgba(255,255,255,0.09)", borderStrong: "rgba(255,255,255,0.14)",
      textPrimary: "#f5f5f5", textSecondary: "#a3a3a3", textMuted: "#6b6b6b"
    }
  },
  {
    id: "midnight",
    name: "Midnight",
    colors: {
      bgBase: "#0c0e16", bgSurface: "#151824", bgElevated: "#1d212f", bgInput: "#10121a",
      borderSubtle: "rgba(255,255,255,0.05)", borderDefault: "rgba(255,255,255,0.08)", borderStrong: "rgba(255,255,255,0.12)",
      textPrimary: "#e2e8f0", textSecondary: "#94a3b8", textMuted: "#64748b"
    }
  },
  {
    id: "warm",
    name: "Warm",
    colors: {
      bgBase: "#141413", bgSurface: "#1f1e1c", bgElevated: "#282624", bgInput: "#181715",
      borderSubtle: "rgba(255,255,255,0.06)", borderDefault: "rgba(255,255,255,0.09)", borderStrong: "rgba(255,255,255,0.13)",
      textPrimary: "#ece9e4", textSecondary: "#b8b3a8", textMuted: "#807a6f"
    }
  },
  {
    id: "slate",
    name: "Slate",
    colors: {
      bgBase: "#181b22", bgSurface: "#222732", bgElevated: "#2c323e", bgInput: "#1c1f27",
      borderSubtle: "rgba(255,255,255,0.05)", borderDefault: "rgba(255,255,255,0.08)", borderStrong: "rgba(255,255,255,0.12)",
      textPrimary: "#e2e8f0", textSecondary: "#94a3b8", textMuted: "#64748b"
    }
  },
  {
    id: "forest",
    name: "Forest",
    colors: {
      bgBase: "#0d1a12", bgSurface: "#13251a", bgElevated: "#1a3022", bgInput: "#101e15",
      borderSubtle: "rgba(255,255,255,0.05)", borderDefault: "rgba(255,255,255,0.08)", borderStrong: "rgba(255,255,255,0.12)",
      textPrimary: "#e8f5e9", textSecondary: "#a5d6a7", textMuted: "#6b9b70"
    }
  }
];

export interface AccentColor {
  id: string;
  name: string;
  hex: string;
}

export const ACCENT_COLORS: AccentColor[] = [
  { id: "green",   name: "Green",   hex: "#7aab5e" },
  { id: "blue",    name: "Blue",    hex: "#3b82f6" },
  { id: "violet",  name: "Violet",  hex: "#8b5cf6" },
  { id: "orange",  name: "Orange",  hex: "#f97316" },
  { id: "cyan",    name: "Cyan",    hex: "#06b6d4" },
  { id: "rose",    name: "Rose",    hex: "#f43f5e" },
  { id: "amber",   name: "Amber",   hex: "#e0a83e" },
  { id: "indigo",  name: "Indigo",  hex: "#6366f1" },
  { id: "teal",    name: "Teal",    hex: "#10b981" },
  { id: "pink",    name: "Pink",    hex: "#ec4899" }
];

export const DEFAULT_BASE_ID = "obsidian";
export const DEFAULT_ACCENT_ID = "green";

export function getBaseTheme(id: string): BaseTheme {
  return BASE_THEMES.find((t) => t.id === id) ?? BASE_THEMES[0]!;
}

export function getAccentColor(id: string): AccentColor {
  return ACCENT_COLORS.find((a) => a.id === id) ?? ACCENT_COLORS[0]!;
}

export function isValidBaseId(id: string): boolean {
  return BASE_THEMES.some((t) => t.id === id);
}

export function isValidAccentId(id: string): boolean {
  return ACCENT_COLORS.some((a) => a.id === id);
}

// ── Color helpers ─────────────────────────────────────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16)
  };
}

function hexToRgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function lighten(hex: string, ratio: number): string {
  const { r, g, b } = hexToRgb(hex);
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return "#" + [r + (255 - r) * ratio, g + (255 - g) * ratio, b + (255 - b) * ratio]
    .map((n) => c(n).toString(16).padStart(2, "0")).join("");
}

// ── Theme application: set CSS variables on :root ─────────────────────────

const BASE_VAR_MAP: Record<keyof BaseColors, string> = {
  bgBase: "--bg-base",
  bgSurface: "--bg-surface",
  bgElevated: "--bg-elevated",
  bgInput: "--bg-input",
  borderSubtle: "--border-subtle",
  borderDefault: "--border-default",
  borderStrong: "--border-strong",
  textPrimary: "--text-primary",
  textSecondary: "--text-secondary",
  textMuted: "--text-muted"
};

export function applyTheme(baseId: string, accentId: string): void {
  const base = getBaseTheme(baseId);
  const accent = getAccentColor(accentId);
  const root = document.documentElement;

  // Base colors
  for (const [key, cssVar] of Object.entries(BASE_VAR_MAP)) {
    const value = base.colors[key as keyof BaseColors];
    if (value) root.style.setProperty(cssVar, value);
  }

  // Hover bg
  root.style.setProperty("--bg-hover", "rgba(255, 255, 255, 0.045)");

  // Accent + derived variants
  root.style.setProperty("--accent", accent.hex);
  root.style.setProperty("--accent-hover", lighten(accent.hex, 0.12));
  root.style.setProperty("--accent-text", lighten(accent.hex, 0.25));
  root.style.setProperty("--accent-muted", hexToRgba(accent.hex, 0.12));
  root.style.setProperty("--accent-subtle", hexToRgba(accent.hex, 0.06));
  root.style.setProperty("--accent-border", hexToRgba(accent.hex, 0.30));

  // Meta theme-color
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", base.colors.bgBase);
}
