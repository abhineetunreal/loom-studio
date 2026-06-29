"use client";

import type { PaletteEntry, TierInfo, YarnOption } from "@/types";

type Props = {
  designName: string;
  palette: PaletteEntry[];
  colorMap: Record<string, YarnOption | null>;
  initialColorMap: Record<string, YarnOption>;
  selectedHex: string | null;
  onSelectColor: (hex: string) => void;
  onRevert: (hex: string) => void;
  tierInfo: TierInfo;
  /** True for user-uploaded designs: unassigned slots show "Color N" instead of the raw hex */
  isUserUpload: boolean;
  /** Full URL to the product page on the brand's website. Only shown when set. */
  viewProductUrl?: string;
  /** Current fill mode — global replaces everywhere, region flood-fills one area. */
  mode: "global" | "region";
  onToggleMode: () => void;
};

export default function CompactPalette({
  designName,
  palette,
  colorMap,
  initialColorMap,
  selectedHex,
  onSelectColor,
  onRevert,
  tierInfo,
  isUserUpload,
  viewProductUrl,
  mode,
  onToggleMode,
}: Props) {
  // Exclude entries that are effectively invisible (rounds to "0.0%")
  const sorted = [...palette]
    .filter((e) => e.percentage >= 0.05)
    .sort((a, b) => b.percentage - a.percentage);
  const isDemo = tierInfo.tier === "demo";

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-2 py-1.5 border-b border-stone-200">
        <p className="text-xs font-semibold truncate text-stone-800">{designName}</p>
        <div className="flex items-center gap-2">
          <p className="text-[10px] text-stone-400">{palette.length} colors</p>
          {viewProductUrl && (
            <a
              href={viewProductUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-0.5 text-[10px] text-stone-400 hover:text-stone-700 transition-colors"
              title="View product page"
            >
              View product
              <svg className="w-2.5 h-2.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          )}
        </div>
      </div>

      {/* Fill mode toggle */}
      <div className="shrink-0 px-2 py-1.5 border-b border-stone-200">
        <div className="flex items-center gap-1">
          <button
            onClick={() => mode !== "global" && onToggleMode()}
            title="Global Fill — changes this color everywhere in the rug"
            aria-pressed={mode === "global"}
            className={`flex items-center justify-center w-7 h-7 rounded transition-colors ${
              mode === "global"
                ? "bg-stone-800 text-white"
                : "text-stone-400 hover:text-stone-700 hover:bg-stone-100"
            }`}
          >
            <GlobalFillIcon />
          </button>
          <button
            onClick={() => mode !== "region" && onToggleMode()}
            title="Region Fill — changes only the clicked area"
            aria-pressed={mode === "region"}
            className={`flex items-center justify-center w-7 h-7 rounded transition-colors ${
              mode === "region"
                ? "bg-stone-800 text-white"
                : "text-stone-400 hover:text-stone-700 hover:bg-stone-100"
            }`}
          >
            <RegionFillIcon />
          </button>
        </div>
      </div>

      {/* Scrollable rows */}
      <ul className="flex-1 overflow-y-auto">
        {sorted.map((entry, i) => {
          const assignedYarn = colorMap[entry.hex] ?? null;
          const initialYarn = initialColorMap[entry.hex] ?? null;
          const isSelected = selectedHex === entry.hex;
          const isChanged = (assignedYarn?.id ?? null) !== (initialYarn?.id ?? null);
          const swatchHex = assignedYarn?.hex ?? entry.hex;

          // Region-fill-only entries (index === -1) always show their yarn code.
          // Label priority for original palette entries:
          //   demo tier         → "Color N" (no codes ever revealed)
          //   user upload, no yarn assigned → "Color N" (no raw hex shown; raw palette has no library meaning)
          //   user upload, yarn assigned    → yarn.code (e.g. "ARS-472" or "108")
          //   catalog design, no yarn       → raw hex
          //   catalog design, yarn assigned → yarn.code
          //
          // Some yarn libraries store codes as "LibraryName:N_Code" (e.g. "OneLoom:5_BM-813").
          // Strip the library prefix and grid position so only the bare code is shown.
          const isRegionFillEntry = entry.index === -1;
          const rawCode = !isRegionFillEntry && (isDemo || (isUserUpload && !assignedYarn))
            ? `Color ${i + 1}`
            : (assignedYarn?.code ?? entry.matchedYarnCode ?? entry.hex.toUpperCase());
          // Strip "Library:N_" prefix if present (e.g. "OneLoom:5_BM-813" → "BM-813")
          const displayCode = rawCode.replace(/^[^:]+:\d+_/, "");

          const entryKey = isRegionFillEntry ? `region-${entry.hex}` : entry.hex;

          return (
            <li key={entryKey} className="relative">
              <button
                onClick={() => onSelectColor(entry.hex)}
                className={`w-full px-1.5 py-1.5 flex items-center gap-2 text-left rounded transition-colors ${
                  isChanged ? "pr-6" : ""
                } ${
                  isSelected
                    ? "bg-stone-800 text-white"
                    : "hover:bg-stone-100"
                }`}
              >
                {/* Swatch */}
                <span
                  className="w-6 h-6 rounded shrink-0 border border-black/10"
                  style={{ backgroundColor: swatchHex }}
                  aria-hidden
                />
                {/* Code / label */}
                <span
                  className={`text-[14px] flex-1 min-w-0 truncate ${
                    isSelected ? "text-white" : "text-stone-800"
                  }`}
                >
                  {displayCode}
                </span>
                {/* Percentage */}
                <span className="text-[13px] tabular-nums shrink-0 text-stone-500">
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
                      : "text-stone-400 hover:text-stone-600"
                  }`}
                >
                  <RevertIcon />
                </button>
              )}
            </li>
          );
        })}
      </ul>

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

/** Paint bucket — fills the entire color region everywhere in the rug. */
function GlobalFillIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      {/* brush stroke (diagonal handle) */}
      <path d="M2.5 13 7 8.5" />
      {/* brush head */}
      <path d="M7 8.5l3.5-3.5 1.5 1.5L8.5 10 7 8.5z" />
      {/* paint droplet */}
      <path d="M13.5 12.5c0 .83-.67 1.5-1.5 1.5s-1.5-.67-1.5-1.5C10.5 11.3 12 9.5 12 9.5s1.5 1.8 1.5 3z" />
      {/* base line — full coverage */}
      <path d="M1 14.5h5.5" strokeWidth="1.8" />
    </svg>
  );
}

/** Paint bucket confined within a dashed selection — fills only the clicked region. */
function RegionFillIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      {/* dashed selection box */}
      <rect x="1" y="1" width="10" height="10" rx="1.2" strokeDasharray="2 1.5" />
      {/* mini brush stroke inside */}
      <path d="M3 8.5l2.5-2.5" />
      {/* mini brush head */}
      <path d="M5.5 6l2-2 1 1-2 2-1-1z" />
      {/* mini droplet */}
      <path d="M9.5 9.5c0 .55-.45 1-1 1s-1-.45-1-1c0-.7 1-1.8 1-1.8s1 1.1 1 1.8z" />
    </svg>
  );
}
