"use client";

/**
 * AutoColorwayPanel
 *
 * Generates colorway variations from the current palette assignments.
 * Two modes:
 *   - Slight Variation: each yarn → nearby alternative (same library)
 *   - Shuffle: same yarns, randomly reassigned to different palette slots
 *
 * Each generated colorway is previewed as a horizontal strip of palette
 * swatches. Clicking a variation applies it to the canvas.
 */

import { useState, useCallback, useMemo } from "react";
import { generateBatch, type GeneratedColorway } from "@/lib/auto-colorways";
import type { PaletteEntry, YarnOption } from "@/types";

type Props = {
  palette: PaletteEntry[];
  currentColorMap: Record<string, YarnOption | null>;
  yarns: YarnOption[];
  onApply: (colorMap: Record<string, YarnOption>) => void;
  onClose: () => void;
};

export default function AutoColorwayPanel({
  palette,
  currentColorMap,
  yarns,
  onApply,
  onClose,
}: Props) {
  const [mode, setMode] = useState<"variation" | "shuffle">("variation");
  const [count, setCount] = useState(8);
  const [spread, setSpread] = useState(0.5);
  const [results, setResults] = useState<GeneratedColorway[]>([]);
  const [generating, setGenerating] = useState(false);

  // Sorted palette entries for the swatch strip (largest area first)
  const sortedPalette = useMemo(
    () => [...palette].filter((e) => e.percentage >= 0.05).sort((a, b) => b.percentage - a.percentage),
    [palette]
  );

  const handleGenerate = useCallback(() => {
    setGenerating(true);
    // Use requestAnimationFrame so the spinner paints before the CPU-bound work
    requestAnimationFrame(() => {
      const batch = generateBatch(mode, count, currentColorMap, palette, yarns, spread);
      setResults(batch);
      setGenerating(false);
    });
  }, [mode, count, spread, currentColorMap, palette, yarns]);

  const hasAssignments = Object.values(currentColorMap).some((v) => v != null);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-3 py-2 border-b border-stone-200 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-stone-800">Auto Colorways</h3>
        <button
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-stone-100 text-stone-400 hover:text-stone-600 transition-colors"
          title="Close"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Controls */}
      <div className="shrink-0 px-3 py-2 border-b border-stone-200 space-y-2">
        {/* Mode toggle */}
        <div className="flex rounded-md border border-stone-200 overflow-hidden">
          <button
            onClick={() => setMode("variation")}
            className={`flex-1 text-[11px] py-1.5 font-medium transition-colors ${
              mode === "variation"
                ? "bg-stone-800 text-white"
                : "bg-white text-stone-500 hover:bg-stone-50"
            }`}
          >
            Slight Variation
          </button>
          <button
            onClick={() => setMode("shuffle")}
            className={`flex-1 text-[11px] py-1.5 font-medium transition-colors ${
              mode === "shuffle"
                ? "bg-stone-800 text-white"
                : "bg-white text-stone-500 hover:bg-stone-50"
            }`}
          >
            Shuffle
          </button>
        </div>

        {/* Count selector */}
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-stone-500 shrink-0">Count</label>
          <input
            type="range"
            min={4}
            max={20}
            value={count}
            onChange={(e) => setCount(parseInt(e.target.value))}
            className="flex-1 h-1 accent-stone-700"
          />
          <span className="text-[10px] text-stone-600 w-5 text-right tabular-nums">{count}</span>
        </div>

        {/* Spread slider — only for variation mode */}
        {mode === "variation" && (
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-stone-500 shrink-0">Spread</label>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(spread * 100)}
              onChange={(e) => setSpread(parseInt(e.target.value) / 100)}
              className="flex-1 h-1 accent-stone-700"
            />
            <span className="text-[10px] text-stone-600 w-8 text-right tabular-nums">
              {spread < 0.33 ? "Subtle" : spread < 0.66 ? "Medium" : "Bold"}
            </span>
          </div>
        )}

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={!hasAssignments || generating}
          className="w-full py-1.5 rounded-md text-[11px] font-medium transition-colors disabled:opacity-40 bg-stone-800 text-white hover:bg-stone-700 active:bg-stone-900"
        >
          {generating ? "Generating…" : `Generate ${count} Colorways`}
        </button>

        {!hasAssignments && (
          <p className="text-[10px] text-amber-600">
            Assign yarns to at least one color first
          </p>
        )}
      </div>

      {/* Results grid */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {results.length === 0 && !generating && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <WandIcon className="w-8 h-8 text-stone-300 mb-2" />
            <p className="text-xs text-stone-400">
              {mode === "variation"
                ? "Generates colorways with similar but different yarns"
                : "Rearranges the same yarns across different palette entries"}
            </p>
          </div>
        )}

        {results.map((cw) => (
          <button
            key={cw.id}
            onClick={() => onApply(cw.colorMap)}
            className="w-full mb-2 rounded-lg border border-stone-200 hover:border-stone-400 hover:shadow-sm transition-all overflow-hidden group"
            title={`Apply ${cw.label}`}
          >
            {/* Swatch strip — shows the top palette colors with their assigned yarns */}
            <div className="flex h-8">
              {sortedPalette.slice(0, 12).map((entry) => {
                const yarn = cw.colorMap[entry.hex];
                const color = yarn?.hex ?? entry.hex;
                // Width proportional to percentage (min 4% for visibility)
                const w = Math.max(4, entry.percentage);
                return (
                  <div
                    key={entry.hex}
                    style={{ backgroundColor: color, flex: `${w} 0 0%` }}
                    title={yarn ? `${yarn.code} (${yarn.hex})` : entry.hex}
                  />
                );
              })}
            </div>

            {/* Label */}
            <div className="px-2 py-1 bg-white flex items-center justify-between">
              <span className="text-[10px] text-stone-500">{cw.label}</span>
              <span className="text-[10px] text-stone-300 group-hover:text-stone-500 transition-colors">
                Apply →
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Icons ──────────────────────────────────────────────────────────────────

function WandIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
    </svg>
  );
}
