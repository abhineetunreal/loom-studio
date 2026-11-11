"use client";

/**
 * "In this rug" (spec §3 right panel, left column): the colours currently used,
 * ordered by area, biggest first (spec fix). Each row is a swatch + its number.
 * Tapping selects; the selected row gets a ring and (next pass) the padlock.
 *
 * Numbers: the spec wants swatch numbers only. Until a dedicated number field
 * exists we show the assigned yarn's code; unassigned design colours show a dash.
 */

import type { YarnOption } from "@/types";

type Entry = {
  hex: string;
  current: YarnOption | null;
  displayHex: string;
  percentage: number;
};

type Props = {
  entries: Entry[];
  selectedHex: string | null;
  onSelect: (hex: string) => void;
};

// Light colours need a hairline border so the chip edge is visible on white.
function isLight(hex: string): boolean {
  const h = hex.replace("#", "");
  if (h.length < 6) return false;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 225;
}

export default function InThisRug({ entries, selectedHex, onSelect }: Props) {
  return (
    <div className="w-[190px] shrink-0 flex flex-col min-h-0 border-r border-neutral-200">
      <div className="shrink-0 px-3 py-2.5 border-b border-neutral-200">
        <h2 className="text-[13px] font-semibold text-neutral-800">In this rug</h2>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {entries.map((e) => {
          const selected = selectedHex === e.hex;
          return (
            <button
              key={e.hex}
              onClick={() => onSelect(e.hex)}
              className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors ${
                selected ? "bg-neutral-100" : "hover:bg-neutral-50"
              }`}
            >
              <span
                className={`w-7 h-7 rounded shrink-0 ${
                  selected ? "ring-2 ring-neutral-900 ring-offset-1 ring-offset-white" : ""
                } ${isLight(e.displayHex) ? "border border-neutral-300" : ""}`}
                style={{ backgroundColor: e.displayHex }}
              />
              <span className="text-[13px] text-neutral-700 truncate">
                {e.current?.code ?? "—"}
              </span>
              <span className="ml-auto text-[11px] text-neutral-400 tabular-nums">
                {e.percentage.toFixed(0)}%
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
