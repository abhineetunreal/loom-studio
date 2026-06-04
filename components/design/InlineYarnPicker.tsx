"use client";

import { useState, useMemo } from "react";
import { hexToRgb } from "@/lib/recolor";
import type { PaletteEntry, TierInfo, YarnOption } from "@/types";

const LIBRARIES = ["OneLoom", "ARS 1400", "ARS 1200"] as const;
type Library = (typeof LIBRARIES)[number];

function rgbDistance(hexA: string, hexB: string): number {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

type Props = {
  yarns: YarnOption[];
  targetEntry: PaletteEntry | null;
  currentYarn: YarnOption | null;
  onPick: (yarn: YarnOption) => void;
  tierInfo: TierInfo;
};

export default function InlineYarnPicker({
  yarns,
  targetEntry,
  currentYarn,
  onPick,
  tierInfo,
}: Props) {
  const [library, setLibrary] = useState<Library>("OneLoom");
  const [search, setSearch] = useState("");
  const isDemo = tierInfo.tier === "demo";
  const [hoveredYarn, setHoveredYarn] = useState<YarnOption | null>(null);

  // Top 6 closest RGB matches
  const closestYarns = useMemo(() => {
    if (!targetEntry) return [];
    return [...yarns]
      .map((y) => ({ yarn: y, dist: rgbDistance(targetEntry.hex, y.hex) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 6)
      .map(({ yarn }) => yarn);
  }, [yarns, targetEntry?.hex]);

  // Library + search filtered yarns
  const filteredYarns = useMemo(() => {
    const inLib = yarns.filter((y) => y.library === library);
    if (!search) return inLib;
    const q = search.toLowerCase();
    return inLib.filter(
      (y) =>
        y.name.toLowerCase().includes(q) ||
        y.code.toLowerCase().includes(q)
    );
  }, [yarns, library, search]);

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Pinned header */}
      <div className="shrink-0 border-b border-stone-200">
        {/* Title row */}
        <div className="px-2 py-1.5">
          <p className="text-[10px] font-semibold text-stone-600">Yarn Picker</p>
          {targetEntry && (
            <div className="flex items-center gap-1 mt-0.5">
              <span
                className="w-3 h-3 rounded-sm inline-block border border-black/10 shrink-0"
                style={{ backgroundColor: targetEntry.hex }}
                aria-hidden
              />
              <span className="text-[9px] font-mono text-stone-500">
                {targetEntry.hex.toUpperCase()}
              </span>
              <span className="text-[9px] text-stone-400">
                {targetEntry.percentage.toFixed(1)}%
              </span>
            </div>
          )}
        </div>

        {/* Closest matches */}
        {targetEntry && closestYarns.length > 0 && (
          <div className="px-2 pb-1.5">
            <p className="text-[9px] text-stone-400 mb-1">Closest</p>
            <div className="flex gap-1 flex-wrap">
              {closestYarns.map((yarn) => {
                const isCurrent = currentYarn?.id === yarn.id;
                return (
                  <button
                    key={yarn.id}
                    onClick={() => onPick(yarn)}
                    title={`${yarn.name}${yarn.library ? " · " + yarn.library : ""}`}
                    aria-label={yarn.name}
                    aria-pressed={isCurrent}
                    className={`w-6 h-6 rounded-sm border-2 transition-colors ${
                      isCurrent
                        ? "border-stone-800 ring-1 ring-stone-800 ring-offset-[1px]"
                        : "border-transparent hover:border-stone-400"
                    }`}
                    style={{ backgroundColor: yarn.hex }}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Library selector — hidden in demo tier */}
        {!isDemo && (
          <select
            value={library}
            onChange={(e) => {
              setLibrary(e.target.value as Library);
              setSearch("");
            }}
            className="text-[9px] px-1 py-0.5 w-full border-b border-stone-200 bg-stone-50 focus:outline-none"
          >
            {LIBRARIES.map((lib) => (
              <option key={lib} value={lib}>
                {lib}
              </option>
            ))}
          </select>
        )}

        {/* Search — hidden in demo tier */}
        {!isDemo && (
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="text-[9px] px-2 py-1 border-b border-stone-200 w-full placeholder:text-stone-400 focus:outline-none bg-white"
          />
        )}
      </div>

      {/* Scrollable swatch grid */}
      <div className="flex-1 overflow-y-auto p-1">
        {filteredYarns.length === 0 ? (
          <p className="text-[9px] text-stone-400 text-center py-4">No match</p>
        ) : (
          <div className="grid grid-cols-6 gap-[2px]">
            {filteredYarns.map((yarn) => {
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
                  className={`aspect-square rounded-[2px] border-2 transition-colors ${
                    isCurrent
                      ? "border-stone-800 ring-1 ring-stone-800 ring-offset-[1px]"
                      : "border-transparent hover:border-stone-400"
                  }`}
                  style={{ backgroundColor: yarn.hex }}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
