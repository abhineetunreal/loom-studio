"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { hexToRgb } from "@/lib/recolor";
import type { PaletteEntry, TierInfo, YarnOption } from "@/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const LIBRARIES = ["OneLoom", "ARS 1400", "ARS 1200"] as const;
type Library = (typeof LIBRARIES)[number];

const SIMILAR_COUNT = 8;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rgbDistance(hexA: string, hexB: string): number {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

// ─── Component ────────────────────────────────────────────────────────────────

type Props = {
  yarns: YarnOption[];
  targetEntry: PaletteEntry;
  currentYarn: YarnOption | null;
  onPick: (yarn: YarnOption) => void;
  onClose: () => void;
  tierInfo: TierInfo;
};

export default function YarnPicker({
  yarns,
  targetEntry,
  currentYarn,
  onPick,
  onClose,
  tierInfo,
}: Props) {
  const [library, setLibrary] = useState<Library>("OneLoom");
  const [query, setQuery] = useState("");
  const isDemo = tierInfo.tier === "demo";
  const [hoveredYarn, setHoveredYarn] = useState<YarnOption | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Focus search on open
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Top N closest RGB matches across ALL libraries
  const similarYarns = useMemo(
    () =>
      [...yarns]
        .map((y) => ({ yarn: y, dist: rgbDistance(targetEntry.hex, y.hex) }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, SIMILAR_COUNT)
        .map(({ yarn }) => yarn),
    [yarns, targetEntry.hex]
  );

  // Current library filtered + searched, preserving XML import order (sortOrder)
  const libraryYarns = useMemo(() => {
    const inLib = yarns.filter((y) => y.library === library);
    if (!query) return inLib;
    const q = query.toLowerCase();
    return inLib.filter(
      (y) =>
        y.name.toLowerCase().includes(q) ||
        y.code.toLowerCase().includes(q)
    );
  }, [yarns, library, query]);

  function handleLibraryChange(next: Library) {
    setLibrary(next);
    setQuery("");
    // Re-focus search so keyboard users can type immediately
    setTimeout(() => searchRef.current?.focus(), 0);
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
        aria-hidden
      />

      {/* Panel — bottom sheet on mobile, fixed side panel on desktop */}
      <div
        role="dialog"
        aria-modal
        aria-label="Choose a yarn color"
        className="fixed z-50 inset-x-0 bottom-0 lg:inset-x-auto lg:right-4 lg:top-4 lg:bottom-4 lg:w-[400px] flex flex-col bg-white rounded-t-2xl lg:rounded-2xl shadow-2xl"
      >
        {/* ── Header: target color + close ────────────────────────────────── */}
        <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 border-b border-stone-100 shrink-0">
          <div className="flex items-center gap-3">
            <span
              className="w-8 h-8 rounded-md border border-black/10 shadow-sm shrink-0"
              style={{ backgroundColor: targetEntry.hex }}
              aria-hidden
            />
            <div>
              <p className="text-sm font-medium leading-tight">Choose yarn</p>
              <p className="text-xs text-stone-400 font-mono leading-tight">
                {targetEntry.hex.toUpperCase()} · {targetEntry.percentage.toFixed(1)}%
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-stone-400 hover:text-stone-700 transition-colors mt-0.5 shrink-0"
            aria-label="Close"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* ── Similar Colors ───────────────────────────────────────────────── */}
        <div className="px-4 pt-3 pb-3 border-b border-stone-100 shrink-0">
          <p className="text-xs font-medium text-stone-400 uppercase tracking-wide mb-2">
            Closest matches · all libraries
          </p>
          <div className="flex gap-1.5">
            {similarYarns.map((yarn) => {
              const isCurrent = currentYarn?.id === yarn.id;
              return (
                <button
                  key={yarn.id}
                  onClick={() => onPick(yarn)}
                  onMouseEnter={() => setHoveredYarn(yarn)}
                  onMouseLeave={() => setHoveredYarn(null)}
                  title={`${yarn.name}${yarn.library ? " · " + yarn.library : ""}`}
                  aria-label={`${yarn.name}${yarn.library ? " (" + yarn.library + ")" : ""}`}
                  aria-pressed={isCurrent}
                  className={`w-9 h-9 rounded-md border-2 transition-all hover:scale-110 hover:shadow-md ${
                    isCurrent
                      ? "border-stone-800 ring-2 ring-stone-800 ring-offset-1 scale-110"
                      : "border-black/10 hover:border-stone-400"
                  }`}
                  style={{ backgroundColor: yarn.hex }}
                />
              );
            })}
          </div>
        </div>

        {/* ── Library selector + search — hidden in demo tier ─────────────── */}
        {!isDemo && (
          <div className="px-4 pt-3 pb-2 shrink-0 flex gap-2 items-center">
            <select
              value={library}
              onChange={(e) => handleLibraryChange(e.target.value as Library)}
              className="text-sm px-2.5 py-2 rounded-lg border border-stone-200 bg-stone-50 focus:outline-none focus:ring-2 focus:ring-stone-400 shrink-0 cursor-pointer"
            >
              {LIBRARIES.map((lib) => (
                <option key={lib} value={lib}>
                  {lib}
                </option>
              ))}
            </select>
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search code or name…"
              className="flex-1 min-w-0 text-sm px-3 py-2 rounded-lg border border-stone-200 bg-stone-50 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-400"
            />
          </div>
        )}

        {/* ── Hover info / count bar — hidden in demo tier ─────────────────── */}
        {!isDemo && (
          <div className="px-4 pb-1.5 shrink-0 h-5">
            {hoveredYarn ? (
              <p className="text-xs text-stone-600 truncate">
                <span className="font-mono">{hoveredYarn.name}</span>
                {hoveredYarn.library && (
                  <span className="text-stone-400"> · {hoveredYarn.library}</span>
                )}
              </p>
            ) : (
              <p className="text-xs text-stone-300">
                {libraryYarns.length} color{libraryYarns.length !== 1 ? "s" : ""}
                {query && " matched"}
              </p>
            )}
          </div>
        )}

        {/* ── Swatch grid ─────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-3 pb-4">
          {libraryYarns.length === 0 ? (
            <p className="py-8 text-center text-sm text-stone-400">
              No colors match &ldquo;{query}&rdquo;
            </p>
          ) : (
            <div
              className="grid gap-1"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(32px, 1fr))" }}
            >
              {libraryYarns.map((yarn) => {
                const isCurrent = currentYarn?.id === yarn.id;
                return (
                  <button
                    key={yarn.id}
                    onClick={() => onPick(yarn)}
                    onMouseEnter={() => setHoveredYarn(yarn)}
                    onMouseLeave={() => setHoveredYarn(null)}
                    title={`${yarn.name}${yarn.library ? " · " + yarn.library : ""}`}
                    aria-label={yarn.name}
                    aria-pressed={isCurrent}
                    className={`aspect-square rounded-sm border-2 transition-colors ${
                      isCurrent
                        ? "border-stone-800 ring-1 ring-stone-800 ring-offset-1"
                        : "border-transparent hover:border-stone-500"
                    }`}
                    style={{ backgroundColor: yarn.hex }}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
