"use client";

import type { PaletteEntry, YarnOption } from "@/types";

type Props = {
  palette: PaletteEntry[];
  colorMap: Record<string, YarnOption | null>;
  selectedHex: string | null;
  onSelectColor: (hex: string) => void;
};

export default function PalettePanel({
  palette,
  colorMap,
  selectedHex,
  onSelectColor,
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
            isSelected={selectedHex === entry.hex}
            onSelect={() => onSelectColor(entry.hex)}
          />
        ))}
      </ul>
    </div>
  );
}

function PaletteRow({
  entry,
  assignedYarn,
  isSelected,
  onSelect,
}: {
  entry: PaletteEntry;
  assignedYarn: YarnOption | null;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        onClick={onSelect}
        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
          isSelected
            ? "bg-stone-800 text-white"
            : "hover:bg-stone-100 text-stone-800"
        }`}
      >
        {/* Original color swatch */}
        <span
          className="w-7 h-7 rounded-md shrink-0 border border-black/10 shadow-sm"
          style={{ backgroundColor: entry.hex }}
          aria-hidden
        />

        {/* Center: hex + optional assigned yarn */}
        <span className="flex-1 min-w-0">
          <span
            className={`font-mono text-xs block leading-snug ${
              isSelected ? "text-stone-300" : "text-stone-500"
            }`}
          >
            {entry.hex.toUpperCase()}
          </span>
          {assignedYarn ? (
            <span
              className={`text-xs truncate block leading-snug font-medium ${
                isSelected ? "text-white" : "text-stone-700"
              }`}
            >
              {assignedYarn.code} · {assignedYarn.name}
            </span>
          ) : (
            <span
              className={`text-xs block leading-snug ${
                isSelected ? "text-stone-400" : "text-stone-400"
              }`}
            >
              original
            </span>
          )}
        </span>

        {/* Right: assigned yarn swatch OR percentage */}
        {assignedYarn ? (
          <span
            className="w-6 h-6 rounded-md shrink-0 border border-black/10 shadow-sm"
            style={{ backgroundColor: assignedYarn.hex }}
            aria-label={`Assigned: ${assignedYarn.name}`}
          />
        ) : (
          <span
            className={`text-xs tabular-nums shrink-0 w-10 text-right ${
              isSelected ? "text-stone-400" : "text-stone-400"
            }`}
          >
            {entry.percentage.toFixed(1)}%
          </span>
        )}
      </button>
    </li>
  );
}
