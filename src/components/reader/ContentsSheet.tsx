"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Loader2, X } from "lucide-react";
import type { OutlineModule } from "@/lib/readerOutline";

type Props = {
  open: boolean;
  onClose: () => void;
  modules: OutlineModule[] | null; // null while loading
  error: string | null;
  currentModule: number;
  currentUnit: number; // unit_number of the unit being read
  onPick: (unitNumber: number) => void;
};

// The table of contents: every module, with its units inside, like the
// contents page of a printed book. Tap a unit to open it.
export default function ContentsSheet({
  open,
  onClose,
  modules,
  error,
  currentModule,
  currentUnit,
  onPick,
}: Props) {
  const [openModules, setOpenModules] = useState<Set<number>>(new Set([currentModule]));

  // Lock page scroll behind the sheet while it is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  function toggle(n: number) {
    setOpenModules((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Contents">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className="reader-sheet relative flex max-h-[85vh] w-full max-w-xl flex-col rounded-t-3xl shadow-2xl sm:rounded-3xl"
        style={{ background: "var(--r-panel)", color: "var(--r-fg)" }}
      >
        <div className="flex items-center justify-between px-6 pb-3 pt-5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: "var(--r-muted)" }}>
              Table of contents
            </p>
            <h2 className="font-serif text-2xl font-bold">Contents</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close contents"
            className="flex h-10 w-10 items-center justify-center rounded-full"
            style={{ background: "var(--r-rule)" }}
          >
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto px-3 pb-8">
          {error ? (
            <p className="px-3 py-6 text-sm">{error}</p>
          ) : !modules ? (
            <div className="flex items-center gap-3 px-3 py-8 text-sm" style={{ color: "var(--r-muted)" }}>
              <Loader2 size={18} className="animate-spin" />
              Loading all modules…
            </div>
          ) : modules.length === 0 ? (
            <p className="px-3 py-6 text-sm" style={{ color: "var(--r-muted)" }}>
              No modules found yet.
            </p>
          ) : (
            modules.map((m) => {
              const isOpen = openModules.has(m.moduleNumber);
              return (
                <section key={m.moduleNumber} className="border-b" style={{ borderColor: "var(--r-rule)" }}>
                  <button
                    onClick={() => toggle(m.moduleNumber)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center justify-between gap-3 px-3 py-4 text-left"
                  >
                    <span>
                      <span className="block text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--r-accent)" }}>
                        Module {m.moduleNumber}
                      </span>
                      {m.title && <span className="block text-base font-semibold leading-snug">{m.title}</span>}
                    </span>
                    <ChevronDown
                      size={20}
                      style={{ color: "var(--r-muted)", transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 150ms" }}
                    />
                  </button>
                  {isOpen && (
                    <ol className="pb-3">
                      {m.units.map((u) => {
                        const isCurrent = u.unitNumber === currentUnit;
                        return (
                          <li key={u.unitNumber}>
                            <button
                              onClick={() => onPick(u.unitNumber)}
                              className="flex w-full items-baseline gap-3 rounded-xl px-3 py-3 text-left"
                              style={isCurrent ? { background: "var(--r-rule)" } : undefined}
                            >
                              <span className="w-14 shrink-0 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--r-muted)" }}>
                                Unit {u.unitInModule}
                              </span>
                              <span className={`text-[15px] leading-snug ${isCurrent ? "font-bold" : ""}`}>{u.title}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </section>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
