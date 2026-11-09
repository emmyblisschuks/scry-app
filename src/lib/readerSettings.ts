import { useSyncExternalStore } from "react";

export type ReaderThemeId = "original" | "quiet" | "paper" | "bold" | "calm" | "focus";
export type ReaderFontId = "literata" | "fraunces" | "georgia" | "inter" | "atkinson";

export type ReaderSettings = {
  theme: ReaderThemeId;
  font: ReaderFontId;
  fontSize: number; // px
  lineHeight: number; // unitless multiplier
  margin: "narrow" | "normal" | "wide";
};

export const FONT_SIZE_MIN = 14;
export const FONT_SIZE_MAX = 32;

export const DEFAULT_SETTINGS: ReaderSettings = {
  theme: "calm",
  font: "literata",
  fontSize: 19,
  lineHeight: 1.75,
  margin: "normal",
};

export type ReaderTheme = {
  id: ReaderThemeId;
  label: string;
  bg: string;
  fg: string;
  muted: string;
  rule: string;
  accent: string;
  panel: string; // sheets and cards
  bold?: boolean;
};

export const READER_THEMES: ReaderTheme[] = [
  { id: "original", label: "Original", bg: "#ffffff", fg: "#1c1c1e", muted: "#6b6b70", rule: "#dcdcdf", accent: "#7a2e3a", panel: "#f4f4f5" },
  { id: "quiet", label: "Quiet", bg: "#232326", fg: "#d4d4d8", muted: "#9a9aa2", rule: "#3d3d42", accent: "#e4a0aa", panel: "#2f2f33" },
  { id: "paper", label: "Paper", bg: "#e8e6e1", fg: "#2b2a28", muted: "#6e6b65", rule: "#c9c6bf", accent: "#7a2e3a", panel: "#dcd9d3" },
  { id: "bold", label: "Bold", bg: "#ffffff", fg: "#000000", muted: "#3a3a3a", rule: "#000000", accent: "#000000", panel: "#efefef", bold: true },
  { id: "calm", label: "Calm", bg: "#f4e9d2", fg: "#3a2d1c", muted: "#7b6a50", rule: "#d6c6a5", accent: "#7a2e3a", panel: "#e9dbbc" },
  { id: "focus", label: "Focus", bg: "#faf9f4", fg: "#222222", muted: "#707068", rule: "#dedcd2", accent: "#5e2029", panel: "#f0eee5" },
];

export type ReaderFont = { id: ReaderFontId; label: string; family: string };

export const READER_FONTS: ReaderFont[] = [
  { id: "literata", label: "Literata", family: "var(--font-literata), Georgia, serif" },
  { id: "fraunces", label: "Fraunces", family: "var(--font-fraunces), Georgia, serif" },
  { id: "georgia", label: "Georgia", family: "Georgia, 'Times New Roman', serif" },
  { id: "inter", label: "Inter", family: "var(--font-inter), system-ui, sans-serif" },
  { id: "atkinson", label: "Easy to read", family: "var(--font-atkinson), system-ui, sans-serif" },
];

export const MARGIN_PADDING: Record<ReaderSettings["margin"], string> = {
  narrow: "1rem",
  normal: "1.5rem",
  wide: "2.5rem",
};

export function themeById(id: ReaderThemeId): ReaderTheme {
  return READER_THEMES.find((t) => t.id === id) ?? READER_THEMES[4];
}

export function fontById(id: ReaderFontId): ReaderFont {
  return READER_FONTS.find((f) => f.id === id) ?? READER_FONTS[0];
}

// ---- tiny localStorage-backed store so the choice survives reloads ---------

const KEY = "scry.reader.settings.v1";
const listeners = new Set<() => void>();
let cached: ReaderSettings = DEFAULT_SETTINGS;
let loaded = false;

function sanitize(raw: Partial<ReaderSettings>): ReaderSettings {
  const size = Number(raw.fontSize);
  const lh = Number(raw.lineHeight);
  return {
    theme: READER_THEMES.some((t) => t.id === raw.theme) ? (raw.theme as ReaderThemeId) : DEFAULT_SETTINGS.theme,
    font: READER_FONTS.some((f) => f.id === raw.font) ? (raw.font as ReaderFontId) : DEFAULT_SETTINGS.font,
    fontSize: Number.isFinite(size) ? Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, size)) : DEFAULT_SETTINGS.fontSize,
    lineHeight: Number.isFinite(lh) ? Math.min(2.2, Math.max(1.3, lh)) : DEFAULT_SETTINGS.lineHeight,
    margin: raw.margin === "narrow" || raw.margin === "wide" ? raw.margin : "normal",
  };
}

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) cached = sanitize(JSON.parse(raw));
  } catch {
    // private mode or bad data: keep defaults
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): ReaderSettings {
  load();
  return cached;
}

function getServerSnapshot(): ReaderSettings {
  return DEFAULT_SETTINGS;
}

export function updateReaderSettings(patch: Partial<ReaderSettings>) {
  load();
  cached = sanitize({ ...cached, ...patch });
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cached));
  } catch {
    // ignore storage errors
  }
  listeners.forEach((l) => l());
}

export function useReaderSettings(): ReaderSettings {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
