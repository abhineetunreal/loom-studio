"use client";

/**
 * Library panel (spec §3 far-right): the full wool library with search, grouped
 * by colour family and ordered light → dark. Swatches show the real wool photo
 * where available; a dot marks a colour already placed in the rug. Tapping a
 * swatch applies it to the selected colour (whole-colour) or arms it (area fill).
 */

import { useMemo } from "react";
import type { YarnOption } from "@/types";
import Swatch from "./Swatch";

type Props = {
  yarns: YarnOption[];
  search: string;
  onSearch: (s: string) => void;
  onPick: (yarn: YarnOption) => void;
  disabled: boolean;
  activeName: string | null;
  inUseIds: Set<string>;
};

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function family(hex: string): { key: string; label: string; order: number } {
  const [r, g, b] = rgb(hex);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  if (sat < 0.12) return { key: "neutral", label: "Neutrals", order: 99 };
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const mx = Math.max(rn, gn, bn), mn = Math.min(rn, gn, bn), d = mx - mn;
  let h = 0;
  if (d !== 0) {
    if (mx === rn) h = ((gn - bn) / d) % 6;
    else if (mx === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  if (h < 20 || h >= 345) return { key: "red", label: "Reds", order: 1 };
  if (h < 45) return { key: "orange", label: "Terracotta", order: 2 };
  if (h < 70) return { key: "yellow", label: "Wheat", order: 3 };
  if (h < 160) return { key: "green", label: "Sage", order: 4 };
  if (h < 200) return { key: "teal", label: "Teal", order: 5 };
  if (h < 255) return { key: "blue", label: "Denim", order: 6 };
  if (h < 290) return { key: "purple", label: "Plum", order: 7 };
  return { key: "pink", label: "Rose", order: 8 };
}

export default function LibraryPanel({
  yarns, search, onSearch, onPick, disabled, activeName, inUseIds,
}: Props) {
  const libraryName = useMemo(() => {
    const counts = new Map<string, number>();
    for (const y of yarns) if (y.library) counts.set(y.library, (counts.get(y.library) ?? 0) + 1);
    let best = ""; let n = -1;
    for (const [k, v] of counts) if (v > n) { n = v; best = k; }
    return best || "Wool";
  }, [yarns]);

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? yarns.filter((y) => y.code.toLowerCase().includes(q) || y.name.toLowerCase().includes(q) || y.hex.toLowerCase().includes(q))
      : yarns;
    const byFamily = new Map<string, { label: string; order: number; items: YarnOption[] }>();
    for (const y of filtered) {
      const f = family(y.hex);
      if (!byFamily.has(f.key)) byFamily.set(f.key, { label: f.label, order: f.order, items: [] });
      byFamily.get(f.key)!.items.push(y);
    }
    const out = [...byFamily.values()].sort((a, b) => a.order - b.order);
    for (const g of out) g.items.sort((a, b) => luminance(b.hex) - luminance(a.hex));
    return out;
  }, [yarns, search]);

  return (
    <div className="flex-1 min-w-0 flex flex-col min-h-0 bg-[var(--panel)]">
      <div className="shrink-0 px-4 py-3 border-b border-[var(--line)] flex items-center justify-between gap-2">
        <h2 className="u-label">Library · {libraryName}</h2>
        {activeName && <span className="u-mono text-[11px] text-[var(--ink)] truncate">{activeName}</span>}
      </div>
      <div className="shrink-0 px-4 py-2.5 border-b border-[var(--line)]">
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Name, or a code like #8B5A3C"
          className="w-full px-3 py-1.5 rounded-md border border-[var(--line-strong)] bg-[var(--raise)] u-mono text-[12px] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:outline-none focus:border-[var(--ink-soft)]"
        />
      </div>

      <div className={`flex-1 overflow-y-auto px-4 py-3 ${disabled ? "opacity-50" : ""}`}>
        {disabled && (
          <p className="u-mono text-[11px] text-[var(--ink-faint)] mb-3">Pick a colour in the rug first.</p>
        )}
        {groups.map((g) => (
          <div key={g.label} className="mb-4">
            <h3 className="u-label mb-1.5">{g.label}</h3>
            <div className="grid grid-cols-6 gap-1.5">
              {g.items.map((y) => (
                <Swatch
                  key={y.id}
                  yarn={y}
                  inUse={inUseIds.has(y.id)}
                  onClick={() => !disabled && onPick(y)}
                />
              ))}
            </div>
          </div>
        ))}
        {groups.length === 0 && (
          <p className="u-mono text-[12px] text-[var(--ink-faint)]">No colours match.</p>
        )}
      </div>
    </div>
  );
}
