// ── Base themes: background, surface, text, borders ──────────────────────
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
      bgBase: "#0a0a0a", bgSurface: "#141414", bgElevated: "#1c1c1c", bgInput: "#0f0f0f",
      borderSubtle: "rgba(255,255,255,0.05)", borderDefault: "rgba(255,255,255,0.08)", borderStrong: "rgba(255,255,255,0.12)",
      textPrimary: "#fafafa", textSecondary: "#a3a3a3", textMuted: "#737373"
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
      bgBase: "#1a1a19", bgSurface: "#232220", bgElevated: "#2a2825", bgInput: "#1f1e1c",
      borderSubtle: "rgba(255,255,255,0.06)", borderDefault: "rgba(255,255,255,0.08)", borderStrong: "rgba(255,255,255,0.12)",
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

// ── Accent colors ────────────────────────────────────────────────────────
export interface AccentColor {
  id: string;
  name: string;
  /** Base hex, e.g. "#3b82f6" */
  hex: string;
}

export const ACCENT_COLORS: AccentColor[] = [
  { id: "blue",    name: "Blue",    hex: "#3b82f6" },
  { id: "green",   name: "Green",   hex: "#7aab5e" },
  { id: "violet",  name: "Violet",  hex: "#8b5cf6" },
  { id: "orange",  name: "Orange",  hex: "#f97316" },
  { id: "cyan",    name: "Cyan",    hex: "#06b6d4" },
  { id: "rose",    name: "Rose",    hex: "#f43f5e" },
  { id: "amber",   name: "Amber",   hex: "#e0a83e" },
  { id: "indigo",  name: "Indigo",  hex: "#6366f1" },
  { id: "teal",    name: "Teal",    hex: "#10b981" },
  { id: "pink",    name: "Pink",    hex: "#ec4899" }
];

// ── Color manipulation helpers ───────────────────────────────────────────

/** hex → { r, g, b } */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16)
  };
}

/** { r, g, b } → hex */
function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return "#" + [r, g, b].map((n) => c(n).toString(16).padStart(2, "0")).join("");
}

/** Lighten a hex color by blending toward white at the given ratio (0-1) */
function lighten(hex: string, ratio: number): string {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r + (255 - r) * ratio, g + (255 - g) * ratio, b + (255 - b) * ratio);
}



/** Convert hex to rgba with alpha */
export function hexToRgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Derive accent variants from a single hex */
export function deriveAccent(hex: string) {
  return {
    accent: hex,
    accentHover: lighten(hex, 0.12),
    accentText: lighten(hex, 0.25),
    accentMuted: hexToRgba(hex, 0.12),
    accentSubtle: hexToRgba(hex, 0.06),
    accentBorder: hexToRgba(hex, 0.30)
  };
}

// ── Defaults ─────────────────────────────────────────────────────────────
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

// ── CSS variable application ─────────────────────────────────────────────

const BASE_COLOR_TO_CSS: Record<keyof BaseColors, string> = {
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

// Hardcoded hex values found in the codebase → which CSS variable to map to
const HARDCODED_HEX_MAP: Array<[string, string]> = [
  // backgrounds
  ["#1a1a19", "--bg-base"],     // warm bg
  ["#232220", "--bg-surface"],  // warm surface
  ["#2a2825", "--bg-elevated"], // warm elevated
  ["#1f1e1c", "--bg-input"],    // warm input
  ["#0a0a0a", "--bg-base"],     // obsidian bg
  ["#0f0f10", "--bg-base"],
  ["#121212", "--bg-base"],
  ["#262629", "--bg-surface"],
  ["#1f1f22", "--bg-input"],
  ["#111111", "--bg-base"],
  // text
  ["#ece9e4", "--text-primary"],
  ["#b8b3a8", "--text-secondary"],
  ["#807a6f", "--text-muted"],
  ["#5a554d", "--text-muted"],
  ["#9ca3af", "--text-secondary"],
  // accent (will be overridden by dynamic accent injection)
  ["#7aab5e", "--accent"],
  ["#f58d49", "--accent"],
  ["#d66dff", "--accent"],
  ["#8fc068", "--accent-hover"],
  ["#9bc480", "--accent-text"],
  // danger/warning/info stay constant
  ["#d65d5d", "--danger"],
  ["#e08585", "--danger"],
  ["#e8a0a0", "--danger"],
  ["#e0a83e", "--warning"],
  ["#6ba4d0", "--info"],
  ["#71e3e8", "--info"]
];

// rgba white-alpha patterns → CSS variables
const WHITE_ALPHA_MAP: Record<string, string> = {
  "0.018": "--border-subtle",
  "0.02": "--border-subtle",
  "0.025": "--bg-hover",
  "0.03": "--border-subtle",
  "0.035": "--border-default",
  "0.04": "--bg-hover",
  "0.05": "--bg-hover",
  "0.055": "--border-default",
  "0.06": "--border-default",
  "0.065": "--border-default",
  "0.07": "--border-default",
  "0.075": "--border-strong",
  "0.08": "--border-default",
  "0.12": "--border-strong",
  "0.14": "--border-strong",
  "0.16": "--border-strong",
  "0.18": "--border-strong",
  "0.22": "--border-strong"
};

let overrideStyleEl: HTMLStyleElement | null = null;
let accentOverrideEl: HTMLStyleElement | null = null;

/** Inject the base CSS overrides (hardcoded Tailwind hex → CSS variables). Runs once. */
function injectTailwindOverrides(): void {
  if (overrideStyleEl) return;
  const lines: string[] = [];
  for (const [hex, cssVar] of HARDCODED_HEX_MAP) {
    const e = hex.replace("#", "\\#");
    lines.push(
      `.bg-\\[${e}\\]{background-color:var(${cssVar})!important}`,
      `.text-\\[${e}\\]{color:var(${cssVar})!important}`,
      `.border-\\[${e}\\]{border-color:var(${cssVar})!important}`,
      `.fill-\\[${e}\\]{fill:var(${cssVar})!important}`,
      `.stroke-\\[${e}\\]{stroke:var(${cssVar})!important}`,
      `.from-\\[${e}\\]{--tw-gradient-from:var(${cssVar})!important}`,
      `.to-\\[${e}\\]{--tw-gradient-to:var(${cssVar})!important}`
    );
  }
  for (const [alpha, cssVar] of Object.entries(WHITE_ALPHA_MAP)) {
    const e = `white\\/\\[${alpha.replace(".", "\\.")}\\]`;
    lines.push(
      `.bg-\\[${e}\\]{background-color:var(${cssVar})!important}`,
      `.border-\\[${e}\\]{border-color:var(${cssVar})!important}`,
      `.divide-\\[${e}\\]>*{border-color:var(${cssVar})!important}`,
      `.ring-\\[${e}\\]{--tw-ring-color:var(${cssVar})!important}`
    );
  }
  const el = document.createElement("style");
  el.id = "theme-tailwind-overrides";
  el.textContent = lines.join("\n");
  document.head.appendChild(el);
  overrideStyleEl = el;
}

/** Inject / update accent-specific overrides. Re-runs every time accent changes. */
function injectAccentOverrides(hex: string): void {
  const d = deriveAccent(hex);
  // Update CSS variables
  const root = document.documentElement;
  root.style.setProperty("--accent", d.accent);
  root.style.setProperty("--accent-hover", d.accentHover);
  root.style.setProperty("--accent-text", d.accentText);
  root.style.setProperty("--accent-muted", d.accentMuted);
  root.style.setProperty("--accent-subtle", d.accentSubtle);
  root.style.setProperty("--accent-border", d.accentBorder);

  // Override the old hardcoded accent hex values in Tailwind classes
  // Remove old accent override element, recreate with new accent
  if (accentOverrideEl) {
    accentOverrideEl.remove();
  }
  const lines: string[] = [];
  // Map all old accent hexes to --accent
  const oldAccentHexes = ["#7aab5e", "#f58d49", "#d66dff"];
  for (const oldHex of oldAccentHexes) {
    const e = oldHex.replace("#", "\\#");
    lines.push(
      `.bg-\\[${e}\\]{background-color:var(--accent)!important}`,
      `.text-\\[${e}\\]{color:var(--accent)!important}`,
      `.border-\\[${e}\\]{border-color:var(--accent)!important}`,
      `.fill-\\[${e}\\]{fill:var(--accent)!important}`,
      `.stroke-\\[${e}\\]{stroke:var(--accent)!important}`
    );
  }
  // Map old accent-hover hex
  for (const oldHex of ["#8fc068", "#9bc480"]) {
    const e = oldHex.replace("#", "\\#");
    lines.push(
      `.text-\\[${e}\\]{color:var(--accent-text)!important}`,
      `.bg-\\[${e}\\]{background-color:var(--accent-hover)!important}`,
      `.border-\\[${e}\\]{border-color:var(--accent-hover)!important}`
    );
  }
  const el = document.createElement("style");
  el.id = "theme-accent-overrides";
  el.textContent = lines.join("\n");
  document.head.appendChild(el);
  accentOverrideEl = el;
}

/**
 * Apply a complete theme: base background + accent color.
 * This is the main entry point.
 */
export function applyTheme(baseId: string, accentId: string): void {
  const base = getBaseTheme(baseId);
  const accent = getAccentColor(accentId);
  const root = document.documentElement;

  // Set base CSS variables
  for (const [key, cssVar] of Object.entries(BASE_COLOR_TO_CSS)) {
    const value = base.colors[key as keyof BaseColors];
    if (value) root.style.setProperty(cssVar, value);
  }

  // Set static derived colors
  root.style.setProperty("--bg-hover", "rgba(255, 255, 255, 0.05)");
  root.style.setProperty("--danger", "#d65d5d");
  root.style.setProperty("--warning", "#e0a83e");
  root.style.setProperty("--info", "#6ba4d0");
  root.style.setProperty("--danger-muted", "rgba(214,93,93,0.12)");
  root.style.setProperty("--warning-muted", "rgba(224,168,62,0.12)");
  root.style.setProperty("--info-muted", "rgba(107,164,208,0.12)");

  // Meta theme-color
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", base.colors.bgBase);

  // Inject the base overrides (hardcoded hex → variables)
  injectTailwindOverrides();
  // Inject accent overrides
  injectAccentOverrides(accent.hex);
}
