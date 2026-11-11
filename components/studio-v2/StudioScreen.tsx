"use client";

/**
 * StudioScreen — Loom Studio v2 colouring screen (spec: 10 Nov 2026).
 *
 * Layout (spec §3):
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ Header: product · design · Undo/Redo/Compare · Shortlist/Send │
 *   ├──────┬──────────────────────────────────┬────────────────────┤
 *   │ Film │  Stage: fill switch + 4 ideas    │ In this rug │ Library│
 *   │ strip│         large rug + texture + readout              │
 *   └──────┴──────────────────────────────────┴────────────────────┘
 *
 * This first pass gets the structure and the core flows right: selecting a
 * colour, whole-colour fill from the library, undo/redo, texture toggle, the
 * "In this rug" list (by area) and the grouped library. Area fill, the four
 * ideas, shortlist, compare, zoom-map and right-click near-colours layer on
 * next, reusing the existing recolor/auto-colorway engine.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { PaletteEntry, YarnOption } from "@/types";
import type { RecolorCanvasHandle } from "@/components/design/RecolorCanvas";
import StudioHeader from "./StudioHeader";
import InThisRug from "./InThisRug";
import LibraryPanel from "./LibraryPanel";
import FillSwitch from "./FillSwitch";

// RecolorCanvas touches the DOM/canvas — load client-only.
const RecolorCanvas = dynamic(() => import("@/components/design/RecolorCanvas"), { ssr: false });

type ColorMap = Record<string, YarnOption | null>;

export type StudioScreenProps = {
  design: {
    id: string;
    name: string;
    slug: string;
    imageUrl: string;
    width: number;
    height: number;
    externalSku: string | null;
    collection: { id: string; name: string; slug: string } | null;
  };
  palette: PaletteEntry[];
  yarns: YarnOption[];
  initialColorMap: Record<string, YarnOption>;
  tenant: { id: string; name: string; displayName: string | null; logoUrl: string | null } | null;
};

export default function StudioScreen({
  design,
  palette,
  yarns,
  initialColorMap,
  tenant,
}: StudioScreenProps) {
  const canvasRef = useRef<RecolorCanvasHandle>(null);

  // ── Recolor state + history ─────────────────────────────────────────────────
  const [colorMap, setColorMap] = useState<ColorMap>(() => ({ ...initialColorMap }));
  const past = useRef<ColorMap[]>([]);
  const future = useRef<ColorMap[]>([]);
  const [, forceTick] = useState(0);
  const bump = () => forceTick((t) => t + 1);

  const [selectedHex, setSelectedHex] = useState<string | null>(null);
  const [fillMode, setFillMode] = useState<"whole" | "area">("whole");
  const [textureOn, setTextureOn] = useState(true);
  const [librarySearch, setLibrarySearch] = useState("");

  const commit = useCallback((next: ColorMap) => {
    past.current = [...past.current.slice(-49), colorMap];
    future.current = [];
    setColorMap(next);
    bump();
  }, [colorMap]);

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current = [colorMap, ...future.current.slice(0, 49)];
    setColorMap(prev);
    bump();
  }, [colorMap]);

  const redo = useCallback(() => {
    const nxt = future.current.shift();
    if (!nxt) return;
    past.current = [...past.current.slice(-49), colorMap];
    setColorMap(nxt);
    bump();
  }, [colorMap]);

  const canUndo = past.current.length > 0;
  const canRedo = future.current.length > 0;

  // ── Current palette ("In this rug") — each design colour shows its current
  // yarn colour, ordered by area, biggest first (spec fix). ────────────────────
  const inThisRug = useMemo(() => {
    return palette
      .filter((e) => e.percentage >= 0.05)
      .slice()
      .sort((a, b) => b.percentage - a.percentage)
      .map((e) => ({
        hex: e.hex,
        current: colorMap[e.hex] ?? null,
        displayHex: colorMap[e.hex]?.hex ?? e.hex,
        percentage: e.percentage,
      }));
  }, [palette, colorMap]);

  // ── Interactions ─────────────────────────────────────────────────────────────
  const handleRugPick = useCallback((hex: string) => {
    setSelectedHex(hex);
  }, []);

  const handleLibraryPick = useCallback(
    (yarn: YarnOption) => {
      if (!selectedHex) return;
      if (fillMode === "whole") {
        // Replace the selected colour everywhere it appears.
        commit({ ...colorMap, [selectedHex]: yarn });
      }
      // (area fill wired in next pass)
    },
    [selectedHex, fillMode, colorMap, commit]
  );

  const handleInThisRugSelect = useCallback((hex: string) => {
    setSelectedHex((cur) => (cur === hex ? null : hex));
  }, []);

  return (
    <div className="flex flex-col h-dvh w-full overflow-hidden bg-white">
      <StudioHeader
        productName={tenant?.displayName ?? tenant?.name ?? "Loom Studio"}
        logoUrl={tenant?.logoUrl ?? null}
        design={design}
        onUndo={undo}
        onRedo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
      />

      <div className="flex flex-1 min-h-0">
        {/* ── Film strip (left) — idea options + shortlist. Stub for now. ──── */}
        <aside className="w-[96px] shrink-0 border-r border-neutral-200 flex flex-col items-center py-3 gap-2">
          <span className="text-[11px] text-neutral-400 text-center leading-tight px-1">
            Ideas &amp; shortlist
          </span>
        </aside>

        {/* ── Stage (center) ──────────────────────────────────────────────── */}
        <main className="flex-1 min-w-0 flex flex-col">
          {/* Top controls row: fill switch + idea buttons */}
          <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 border-b border-neutral-200">
            <FillSwitch mode={fillMode} onChange={setFillMode} />
            <div className="flex items-center gap-1.5">
              {["Slight", "Full", "One family", "Shuffle"].map((idea) => (
                <button
                  key={idea}
                  className="px-3 py-1.5 rounded-md text-[13px] text-neutral-600 border border-neutral-200 hover:border-neutral-400 hover:bg-neutral-50 transition-colors"
                  // ideas wired in next pass
                  disabled
                >
                  {idea}
                </button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-[13px] text-neutral-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={textureOn}
                  onChange={(e) => setTextureOn(e.target.checked)}
                  className="accent-neutral-800"
                />
                Wool texture
              </label>
            </div>
          </div>

          {/* Rug */}
          <div className="flex-1 min-h-0 flex items-center justify-center p-4 bg-white">
            <div className="relative h-full w-full flex items-center justify-center">
              <RecolorCanvas
                ref={canvasRef}
                imageUrl={design.imageUrl}
                width={design.width}
                height={design.height}
                palette={palette}
                colorMap={colorMap}
                selectedHex={selectedHex}
                onColorPick={handleRugPick}
                textureEnabled={textureOn}
                designName={design.name}
                mode="global"
              />
            </div>
          </div>

          {/* Colour readout (number only — spec §10.1). Stub shows selected hex. */}
          <div className="shrink-0 h-7 flex items-center justify-center text-[13px] text-neutral-500 border-t border-neutral-200">
            {selectedHex ? (colorMap[selectedHex]?.code ?? selectedHex) : ""}
          </div>
        </main>

        {/* ── Right panel — two columns: In this rug | Library ───────────────── */}
        <aside className="w-[520px] shrink-0 border-l border-neutral-200 flex min-h-0">
          <InThisRug
            entries={inThisRug}
            selectedHex={selectedHex}
            onSelect={handleInThisRugSelect}
          />
          <LibraryPanel
            yarns={yarns}
            search={librarySearch}
            onSearch={setLibrarySearch}
            onPick={handleLibraryPick}
            disabled={!selectedHex}
          />
        </aside>
      </div>
    </div>
  );
}
