"use client";

import type { PaletteEntry, YarnOption } from "@/types";

type Props = {
  palette: PaletteEntry[];
  colorMap: Record<string, YarnOption | null>;
  /** Pre-matched yarns from the rendered-color lookup — used to detect per-color changes. */
  initialColorMap: Record<string, YarnOption>;
  selectedHex: string | null;
  onSelectColor: (hex: string) => void;
  /** Revert a single color back to its initial state (pre-matched yarn or unassigned). */
  onRevert: (hex: string) => void;
};

export default function PalettePanel({
  palette,
  colorMap,
  initialColorMap,
  selectedHex,
  onSelectColor,
  onRevert,
}: Props) {
  const sorted = [...palette].sort((a, b) => b.percentage - a.percentage);

  return (
    <div>
      <h2 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-2">
        Colors · {palette.length}
      </h2>
      <ul className="flex flex-col gap-0.5">
        {sorted.map((entry) => (
          <PaletteRow
            key={entry.hex}
            entry={entry}
            assignedYarn={colorMap[entry.hex] ?? null}
            initialYarn={initialColorMap[entry.hex] ?? null}
            isSelected={selectedHex === entry.hex}
            onSelect={() => onSelectColor(entry.hex)}
            onRevert={() => onRevert(entry.hex)}
          />
        ))}
      </ul>
    </div>
  );
}

function PaletteRow({
  entry,
  assignedYarn,
  initialYarn,
  isSelected,
  onSelect,
  onRevert,
}: {
  entry: PaletteEntry;
  assignedYarn: YarnOption | null;
  initialYarn: YarnOption | null;
  isSelected: boolean;
  onSelect: () => void;
  onRevert: () => void;
}) {
  // Changed = current assignment differs from the initial pre-matched state
  const isChanged = (assignedYarn?.id ?? null) !== (initialYarn?.id ?? null);

  // Swatch shows the current color visible on the rug:
  //   assigned → yarn catalog color (what the recolored canvas shows)
  //   unassigned → original rendered color
  const swatchHex = assignedYarn ? assignedYarn.hex : entry.hex;

  return (
    <li className="relative">
      {/* ── Main row button ────────────────────────────────────────────── */}
      <button
        onClick={onSelect}
        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors ${
          isChanged ? "pr-8" : ""
        } ${
          isSelected
            ? "bg-stone-800 text-white"
            : "hover:bg-stone-100 text-stone-800"
        }`}
      >
        {/* Single swatch — current color */}
        <span
          className="w-7 h-7 rounded-md shrink-0 border border-black/10 shadow-sm"
          style={{ backgroundColor: swatchHex }}
          aria-hidden
        />

        {/* Center: yarn name + library, or hex for unmatched */}
        <span className="flex-1 min-w-0">
          {assignedYarn ? (
            <>
              <span
                className={`text-xs font-medium block leading-snug truncate ${
                  isSelected ? "text-white" : "text-stone-800"
                }`}
              >
                {assignedYarn.name}
              </span>
              {assignedYarn.library && (
                <span
                  className={`text-xs block leading-snug ${
                    isSelected ? "text-stone-400" : "text-stone-400"
                  }`}
                >
                  {assignedYarn.library}
                </span>
              )}
            </>
          ) : (
            <>
              <span
                className={`font-mono text-xs block leading-snug ${
                  isSelected ? "text-stone-400" : "text-stone-600"
                }`}
              >
                {entry.hex.toUpperCase()}
              </span>
              <span
                className={`text-xs block leading-snug ${
                  isSelected ? "text-stone-400" : "text-stone-400"
                }`}
              >
                original
              </span>
            </>
          )}
        </span>

        {/* Percentage — always visible */}
        <span
          className={`text-xs tabular-nums shrink-0 ${
            isSelected ? "text-stone-400" : "text-stone-400"
          }`}
        >
          {entry.percentage.toFixed(1)}%
        </span>
      </button>

      {/* ── Per-color revert button — sibling to main button, never nested ── */}
      {isChanged && (
        <button
          onClick={onRevert}
          title={initialYarn ? `Revert to ${initialYarn.name}` : "Remove assignment"}
          className={`absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded transition-colors ${
            isSelected
              ? "text-stone-500 hover:text-white"
              : "text-stone-400 hover:text-stone-600"
          }`}
          aria-label={initialYarn ? `Revert to ${initialYarn.name}` : "Remove assignment"}
        >
          <RevertIcon />
        </button>
      )}
    </li>
  );
}

function RevertIcon() {
  return (
    <svg
      className="w-3.5 h-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
      />
    </svg>
  );
}
