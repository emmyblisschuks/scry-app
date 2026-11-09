"use client";

import { Minus, Plus, X } from "lucide-react";
import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  READER_FONTS,
  READER_THEMES,
  ReaderSettings,
  updateReaderSettings,
} from "@/lib/readerSettings";

type Props = {
  open: boolean;
  onClose: () => void;
  settings: ReaderSettings;
};

const SPACING: { label: string; value: number }[] = [
  { label: "Tight", value: 1.5 },
  { label: "Normal", value: 1.75 },
  { label: "Loose", value: 2.0 },
];

const MARGINS: { label: string; value: ReaderSettings["margin"] }[] = [
  { label: "Narrow", value: "narrow" },
  { label: "Normal", value: "normal" },
  { label: "Wide", value: "wide" },
];

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--r-muted)" }}>
      {children}
    </p>
  );
}

function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className="rounded-xl border-2 px-2 py-2.5 text-sm font-medium"
            style={{
              borderColor: active ? "var(--r-fg)" : "transparent",
              background: "var(--r-bg)",
              color: "var(--r-fg)",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// Bottom sheet where the reader picks font size, font style, theme, spacing
// and margins. Changes apply to the page live and are remembered.
export default function ReaderSettingsSheet({ open, onClose, settings }: Props) {
  if (!open) return null;

  const clampSize = (n: number) => Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, n));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label="Themes and settings">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div
        className="reader-sheet relative max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-t-3xl px-6 pb-8 pt-5 shadow-2xl"
        style={{ background: "var(--r-panel)", color: "var(--r-fg)" }}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-2xl font-bold">Themes &amp; Settings</h2>
          <button
            onClick={onClose}
            aria-label="Close settings"
            className="flex h-10 w-10 items-center justify-center rounded-full"
            style={{ background: "var(--r-rule)" }}
          >
            <X size={20} />
          </button>
        </div>

        <Label>Font size</Label>
        <div className="flex items-center gap-3 rounded-2xl p-2" style={{ background: "var(--r-bg)" }}>
          <button
            onClick={() => updateReaderSettings({ fontSize: clampSize(settings.fontSize - 1) })}
            disabled={settings.fontSize <= FONT_SIZE_MIN}
            aria-label="Smaller text"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl disabled:opacity-30"
            style={{ background: "var(--r-panel)" }}
          >
            <Minus size={18} />
          </button>
          <input
            type="range"
            min={FONT_SIZE_MIN}
            max={FONT_SIZE_MAX}
            step={1}
            value={settings.fontSize}
            onChange={(e) => updateReaderSettings({ fontSize: Number(e.target.value) })}
            aria-label="Font size"
            className="h-2 w-full cursor-pointer"
            style={{ accentColor: "var(--r-fg)" }}
          />
          <button
            onClick={() => updateReaderSettings({ fontSize: clampSize(settings.fontSize + 1) })}
            disabled={settings.fontSize >= FONT_SIZE_MAX}
            aria-label="Bigger text"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl disabled:opacity-30"
            style={{ background: "var(--r-panel)" }}
          >
            <Plus size={18} />
          </button>
        </div>
        <p className="mt-1 text-right text-xs" style={{ color: "var(--r-muted)" }}>
          {settings.fontSize}px
        </p>

        <Label>Theme</Label>
        <div className="grid grid-cols-3 gap-3">
          {READER_THEMES.map((t) => {
            const active = t.id === settings.theme;
            return (
              <button
                key={t.id}
                onClick={() => updateReaderSettings({ theme: t.id })}
                aria-pressed={active}
                className="flex flex-col items-center gap-1.5"
              >
                <span
                  className="flex h-16 w-full items-center justify-center rounded-2xl border-2 font-serif text-2xl"
                  style={{
                    background: t.bg,
                    color: t.fg,
                    borderColor: active ? "var(--r-fg)" : t.rule,
                    fontWeight: t.bold ? 800 : 400,
                  }}
                >
                  Aa
                </span>
                <span className="text-xs" style={{ color: "var(--r-muted)" }}>
                  {t.label}
                </span>
              </button>
            );
          })}
        </div>

        <Label>Font style</Label>
        <div className="grid grid-cols-2 gap-2">
          {READER_FONTS.map((f) => {
            const active = f.id === settings.font;
            return (
              <button
                key={f.id}
                onClick={() => updateReaderSettings({ font: f.id })}
                aria-pressed={active}
                className="rounded-xl border-2 px-3 py-3 text-left text-base"
                style={{
                  fontFamily: f.family,
                  borderColor: active ? "var(--r-fg)" : "transparent",
                  background: "var(--r-bg)",
                  color: "var(--r-fg)",
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        <Label>Line spacing</Label>
        <Segmented
          options={SPACING}
          value={settings.lineHeight}
          onChange={(v) => updateReaderSettings({ lineHeight: v })}
        />

        <Label>Margins</Label>
        <Segmented
          options={MARGINS}
          value={settings.margin}
          onChange={(v) => updateReaderSettings({ margin: v })}
        />

        <button
          onClick={() =>
            updateReaderSettings({ theme: "calm", font: "literata", fontSize: 19, lineHeight: 1.75, margin: "normal" })
          }
          className="mt-6 w-full text-center text-sm underline"
          style={{ color: "var(--r-muted)" }}
        >
          Reset to default
        </button>
      </div>
    </div>
  );
}
