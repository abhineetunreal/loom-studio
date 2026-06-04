"use client";

import Link from "next/link";
import type { PaletteEntry, TierInfo, YarnOption } from "@/types";

type Props = {
  designName: string;
  palette: PaletteEntry[];
  colorMap: Record<string, YarnOption | null>;
  initialColorMap: Record<string, YarnOption>;
  selectedHex: string | null;
  onSelectColor: (hex: string) => void;
  onRevert: (hex: string) => void;
  onRequestColorway: () => void;
  tierInfo: TierInfo;
};

export default function CompactPalette({
  designName,
  palette,
  colorMap,
  initialColorMap,
  selectedHex,
  onSelectColor,
  onRevert,
  onRequestColorway,
  tierInfo,
}: Props) {
  const sorted = [...palette].sort((a, b) => b.percentage - a.percentage);
  const isDemo = tierInfo.tier === "demo";

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-2 py-1.5 border-b border-stone-200">
        <p className="text-[10px] font-semibold truncate text-stone-800">{designName}</p>
        <p className="text-[9px] text-stone-400">{palette.length} colors</p>
      </div>

      {/* Scrollable rows */}
      <ul className="flex-1 overflow-y-auto">
        {sorted.map((entry, i) => {
          const assignedYarn = colorMap[entry.hex] ?? null;
          const initialYarn = initialColorMap[entry.hex] ?? null;
          const isSelected = selectedHex === entry.hex;
          const isChanged = (assignedYarn?.id ?? null) !== (initialYarn?.id ?? null);
          const swatchHex = assignedYarn?.hex ?? entry.hex;

          // Demo tier: "Color 1", "Color 2", … — no codes revealed
          const displayCode = isDemo
            ? `Color ${i + 1}`
            : (assignedYarn?.code ?? entry.hex.toUpperCase());

          return (
            <li key={entry.hex} className="relative">
              <button
                onClick={() => onSelectColor(entry.hex)}
                className={`w-full px-1.5 py-[3px] flex items-center gap-1.5 text-left rounded transition-colors ${
                  isChanged ? "pr-6" : ""
                } ${
                  isSelected
                    ? "bg-stone-800 text-white"
                    : "hover:bg-stone-100"
                }`}
              >
                {/* Swatch */}
                <span
                  className="w-4 h-4 rounded-sm shrink-0 border border-black/10"
                  style={{ backgroundColor: swatchHex }}
                  aria-hidden
                />
                {/* Code / label */}
                <span
                  className={`text-[9px] flex-1 min-w-0 truncate ${
                    isSelected ? "text-white" : "text-stone-700"
                  }`}
                >
                  {displayCode}
                </span>
                {/* Percentage */}
                <span className="text-[9px] tabular-nums shrink-0 text-stone-400">
                  {entry.percentage.toFixed(1)}%
                </span>
              </button>

              {/* Revert button */}
              {isChanged && (
                <button
                  onClick={() => onRevert(entry.hex)}
                  title={initialYarn ? `Revert to ${initialYarn.name}` : "Remove assignment"}
                  aria-label={initialYarn ? `Revert to ${initialYarn.name}` : "Remove assignment"}
                  className={`absolute right-0.5 top-1/2 -translate-y-1/2 p-0.5 rounded transition-colors ${
                    isSelected
                      ? "text-stone-400 hover:text-white"
                      : "text-stone-300 hover:text-stone-600"
                  }`}
                >
                  <RevertIcon />
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {/* Footer — changes based on tier */}
      <div className="shrink-0 p-2">
        {isDemo ? (
          tierInfo.pendingApproval ? (
            <p className="w-full text-center text-[10px] py-1.5 text-amber-700 bg-amber-50 rounded-lg border border-amber-200">
              Account pending approval
            </p>
          ) : (
            <Link
              href="/auth/signin"
              className="block w-full text-center bg-stone-800 text-white text-[10px] py-1.5 rounded-lg hover:bg-stone-700 transition-colors"
            >
              Sign in to request
            </Link>
          )
        ) : (
          <button
            onClick={onRequestColorway}
            className="w-full bg-stone-900 text-white text-[10px] py-1.5 rounded-lg hover:bg-stone-700 transition-colors"
          >
            Request colorway
          </button>
        )}
      </div>
    </div>
  );
}

function RevertIcon() {
  return (
    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
    </svg>
  );
}
