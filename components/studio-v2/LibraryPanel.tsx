"use client";

/**
 * Library panel (spec §3 right panel, right column): the full colour library
 * with search, grouped by colour family, ordered light → dark within each.
 * Tapping a swatch applies it to the selected colour (whole-colour or area fill).
 *
 * Numbers only (spec §10.3): swatches show their code; names are hidden. Family
 * grouping is derived from hue until a curated family/number scheme is loaded.
 */

import { useMemo } from "react";
import type { YarnOption } from "@/types";

type Props = {
  yarns: YarnOption[];
  search: string;
  onSearch: (s: string) => void;
  onPick: (yarn: YarnOption) => void;
  disabled: boolean;
};

// ─── Colour maths for family bucketing + light→dark ordering ──────────────────
function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function isLight(hex: string): boolean {
  return luminance(hex) > 225;
}
/** Coarse family: neutrals (low saturation) then hue buckets. */
function family(hex: string): { key: string; label: string; order: number } {
  const [r, g, b] = rgb(hex);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  if (sat < 0.12) return { key: "neutral", label: "Neutrals", order: 99 };
  // hue in degrees
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
  if (h < 45) return { key: "orange", label: "Oranges", order: 2 };
  if (h < 70) return { key: "yellow", label: "Yellows", order: 3 };
  if (h < 160) return { key: "green", label: "Greens", order: 4 };
  if (h < 200) return { key: "teal", label: "Teals", order: 5 };
  if (h < 255) return { key: "blue", label: "Blues", order: 6 };
  if (h < 290) return { key: "purple", label: "Purples", order: 7 };
  return { key: "pink", label: "Pinks", order: 8 };
}

export default function LibraryPanel({ yarns, search, onSearch, onPick, disabled }: Props) {
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? yarns.filter((y) => y.code.toLowerCase().includes(q) || y.name.toLowerCase().includes(q))
      : yarns;

    const byFamily = new Map<string, { label: string; order: number; items: YarnOption[] }>();
    for (const y of filtered) {
      const f = family(y.hex);
      if (!byFamily.has(f.key)) byFamily.set(f.key, { label: f.label, order: f.order, items: [] });
      byFamily.get(f.key)!.items.push(y);
    }
    const out = [...byFamily.values()].sort((a, b) => a.order - b.order);
    // light → dark within each family
    for (const g of out) g.items.sort((a, b) => luminance(b.hex) - luminance(a.hex));
    return out;
  }, [yarns, search]);

  return (
    <div className="flex-1 min-w-0 flex flex-col min-h-0">
      <div className="shrink-0 px-3 py-2 border-b border-neutral-200">
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search by number"
          className="w-full px-2.5 py-1.5 rounded-md border border-neutral-300 text-[13px] text-neutral-800 placeholder:text-neutral-400 focus:outline-none focus:border-neutral-500"
        />
      </div>

      <div className={`flex-1 overflow-y-auto px-3 py-2 ${disabled ? "opacity-60" : ""}`}>
        {disabled && (
          <p className="text-[12px] text-neutral-400 mb-2">Pick a colour in the rug first.</p>
        )}
        {groups.map((g) => (
          <div key={g.label} className="mb-3">
            <h3 className="text-[11px] uppercase tracking-wide text-neutral-400 mb-1.5">{g.label}</h3>
            <div className="grid grid-cols-6 gap-1.5">
              {g.items.map((y) => (
                <button
                  key={y.id}
                  onClick={() => !disabled && onPick(y)}
                  disabled={disabled}
                  title={y.code}
                  className="aspect-square rounded relative group"
                  style={{ backgroundColor: y.hex }}
                >
                  <span
                    className={`absolute inset-0 rounded ${
                      isLight(y.hex) ? "border border-neutral-300" : ""
                    } group-hover:ring-2 group-hover:ring-neutral-900 group-hover:ring-offset-1 group-hover:ring-offset-white`}
                  />
                </button>
              ))}
            </div>
          </div>
        ))}
        {groups.length === 0 && (
          <p className="text-[13px] text-neutral-400">No colours match.</p>
        )}
      </div>
    </div>
  );
}
