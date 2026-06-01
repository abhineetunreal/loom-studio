"use client";

/**
 * ColorPopover
 *
 * Floating info card pinned near the canvas click point. It stays visible
 * while the YarnPicker is open and live-updates when a yarn is assigned.
 *
 * Layout:
 *   Unchanged — single section: #rank + current yarn swatch + code + library + "Change yarn"
 *   Changed   — two sections:
 *     Top (fixed reference): #rank + original circle (entry.hex) + (original code)
 *     Body (live):           current yarn swatch + code + library + "Change yarn"
 *
 * Dismissed by:
 *   • The × button
 *   • Clicking a different canvas color (DesignViewer replaces canvasPick)
 *   • Closing the YarnPicker (DesignViewer clears canvasPick in handlePickerClose)
 *
 * Positioning: fixed to the viewport, offset from the click point.
 * Flips left if near the right edge, flips up if near the bottom edge.
 */

import { useRef } from "react";
import type { PaletteEntry, YarnOption } from "@/types";

const CARD_W = 224; // estimated width (matches w-56 = 224px)
const CARD_H = 220; // estimated height for smart-flip (taller when changed state shown)
const OFFSET = 14;  // gap between click point and card edge

type Props = {
  entry: PaletteEntry;
  /** 1-based rank in the palette sorted by coverage percentage (largest = 1) */
  paletteRank: number;
  assignedYarn: YarnOption | null;
  /** Pre-matched yarn from the rendered-color lookup — shown as reference when overridden */
  initialYarn: YarnOption | null;
  clientX: number;
  clientY: number;
  onOpenPicker: () => void;
  onDismiss: () => void;
};

export default function ColorPopover({
  entry,
  paletteRank,
  assignedYarn,
  initialYarn,
  clientX,
  clientY,
  onOpenPicker,
  onDismiss,
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null);

  // Show the original reference line only when the color has been changed away from its initial match
  const isChanged = initialYarn !== null && assignedYarn?.id !== initialYarn.id;

  // ── Smart positioning ────────────────────────────────────────────────────────
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  let x = clientX + OFFSET;
  let y = clientY + OFFSET;
  if (x + CARD_W > vw - 8) x = clientX - CARD_W - OFFSET;
  if (y + CARD_H > vh - 8) y = clientY - CARD_H - OFFSET;
  x = Math.max(8, x);
  y = Math.max(8, y);

  return (
    <div
      ref={cardRef}
      className="fixed z-[55] w-56 bg-white rounded-xl shadow-xl border border-stone-200 overflow-hidden select-none"
      style={{ left: x, top: y }}
    >
      {/* ── Dismiss button — absolute so it doesn't affect layout ───────── */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        className="absolute top-2.5 right-2.5 text-stone-300 hover:text-stone-600 transition-colors"
        aria-label="Dismiss"
      >
        <svg
          className="w-3.5 h-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* ── Main clickable area ──────────────────────────────────────────── */}
      <div
        role="button"
        tabIndex={0}
        onClick={onOpenPicker}
        onKeyDown={(e) => e.key === "Enter" && onOpenPicker()}
        className="cursor-pointer hover:bg-stone-50 transition-colors"
        aria-label={`Open yarn picker for color #${paletteRank}`}
      >
        {/* ── Original reference line — only shown when color has been changed ── */}
        {isChanged && (
          <>
            <div className="flex items-center gap-2 px-3 pt-3 pb-2 pr-8">
              <span className="text-xs font-semibold text-stone-400 w-5 shrink-0 tabular-nums">
                #{paletteRank}
              </span>
              <span
                className="w-4 h-4 rounded-full border border-black/10 shadow-sm shrink-0"
                style={{ backgroundColor: entry.hex }}
                aria-hidden
              />
              <span className="text-xs font-mono text-stone-400 truncate leading-none">
                ({initialYarn!.name})
              </span>
            </div>
            <div className="h-px bg-stone-100" />
          </>
        )}

        {/* ── Current yarn body ────────────────────────────────────────────── */}
        <div className={`flex items-center gap-2 px-3 py-2.5 ${!isChanged ? "pt-3 pr-8" : ""}`}>
          {/* Rank only in unchanged state (no reference line above) */}
          {!isChanged && (
            <span className="text-xs font-semibold text-stone-400 w-5 shrink-0 tabular-nums">
              #{paletteRank}
            </span>
          )}

          {assignedYarn ? (
            <>
              <span
                className="w-6 h-6 rounded-md border border-black/10 shadow-sm shrink-0"
                style={{ backgroundColor: assignedYarn.hex }}
                aria-hidden
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-stone-800 truncate leading-snug">
                  {assignedYarn.name}
                </p>
                {(assignedYarn.library || assignedYarn.pileType) && (
                  <div className="flex gap-1 mt-0.5 flex-wrap">
                    {assignedYarn.library && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-stone-100 text-stone-500 leading-none">
                        {assignedYarn.library}
                      </span>
                    )}
                    {assignedYarn.pileType && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-stone-100 text-stone-500 leading-none">
                        {assignedYarn.pileType}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <span
                className="w-5 h-5 rounded-full border border-black/10 shadow-sm shrink-0"
                style={{ backgroundColor: entry.hex }}
                aria-hidden
              />
              <p className="text-xs text-stone-400">No yarn assigned yet</p>
            </>
          )}
        </div>

        <div className="h-px bg-stone-100" />

        {/* ── Footer CTA ───────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-xs font-medium text-stone-500">
            {assignedYarn ? "Change yarn" : "Choose yarn"}
          </span>
          <svg
            className="w-3.5 h-3.5 text-stone-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    </div>
  );
}
