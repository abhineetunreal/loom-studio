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
 * Working flows: select a colour (tap rug or list), whole-colour fill from the
 * library, area fill ("only what I tap") via region flood-fill, the four ideas
 * (slight / full / one family / shuffle) reusing the auto-colorway engine,
 * undo/redo across both whole-colour and area edits, and the texture toggle.
 *
 * Undo model: a single LIFO stack of ops spanning whole-colour commits (which
 * carry the previous colour map) and region fills (undone through the canvas
 * handle). Whole-colour ops are redoable; region fills are undo-only for now.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { PaletteEntry, YarnOption } from "@/types";
import type { RecolorCanvasHandle } from "@/components/design/RecolorCanvas";
import {
  generateSlightVariation,
  generateShuffle,
  generateOneFamily,
} from "@/lib/auto-colorways";
import StudioHeader from "./StudioHeader";
import InThisRug from "./InThisRug";
import LibraryPanel from "./LibraryPanel";
import FillSwitch from "./FillSwitch";

// RecolorCanvas touches the DOM/canvas — load client-only.
const RecolorCanvas = dynamic(() => import("@/components/design/RecolorCanvas"), { ssr: false });

type ColorMap = Record<string, YarnOption | null>;

// A single undo-stack entry: either a whole-colour map change (redoable, carries
// the map as it was *before* the change) or a region fill (undone via the canvas
// handle; not redoable yet).
type Op = { type: "map"; prevMap: ColorMap } | { type: "region" };

type IdeaKind = "slight" | "full" | "family" | "shuffle";
const IDEAS: { kind: IdeaKind; label: string; hint: string }[] = [
  { kind: "slight", label: "Slight", hint: "Nudge every colour to a near neighbour" },
  { kind: "full", label: "Full", hint: "A bolder reshuffle of the whole palette" },
  { kind: "family", label: "One family", hint: "Recast the rug into a single colour family" },
  { kind: "shuffle", label: "Shuffle", hint: "Swap the current colours between areas" },
];

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
  const past = useRef<Op[]>([]);
  const future = useRef<Op[]>([]); // only "map" ops are redoable
  const [, forceTick] = useState(0);
  const bump = () => forceTick((t) => t + 1);

  const [selectedHex, setSelectedHex] = useState<string | null>(null);
  const [fillMode, setFillMode] = useState<"whole" | "area">("whole");
  // Yarn to paint with in area ("only what I tap") mode.
  const [fillYarn, setFillYarn] = useState<YarnOption | null>(null);
  const [textureOn, setTextureOn] = useState(true);
  const [librarySearch, setLibrarySearch] = useState("");

  // Whole-colour commit: replace the map, push the previous one for undo.
  const commit = useCallback((next: ColorMap) => {
    past.current = [...past.current.slice(-99), { type: "map", prevMap: colorMap }];
    future.current = [];
    setColorMap(next);
    bump();
  }, [colorMap]);

  // A region fill just happened on the canvas — record it on the shared stack.
  const registerRegionOp = useCallback(() => {
    past.current = [...past.current.slice(-99), { type: "region" }];
    future.current = [];
    bump();
  }, []);

  const undo = useCallback(() => {
    const op = past.current.pop();
    if (!op) return;
    if (op.type === "map") {
      future.current = [{ type: "map", prevMap: colorMap }, ...future.current.slice(0, 99)];
      setColorMap(op.prevMap);
    } else {
      // Region fill — undo through the canvas. Region ops aren't redoable, so
      // clear the redo stack to keep undo/redo coherent.
      canvasRef.current?.undoRegionFill();
      future.current = [];
    }
    bump();
  }, [colorMap]);

  const redo = useCallback(() => {
    const op = future.current.shift();
    if (!op || op.type !== "map") return;
    past.current = [...past.current.slice(-99), { type: "map", prevMap: colorMap }];
    setColorMap(op.prevMap);
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

  const hasAssignments = useMemo(() => inThisRug.some((e) => e.current), [inThisRug]);

  // ── Interactions ─────────────────────────────────────────────────────────────
  const handleRugPick = useCallback((hex: string) => {
    setSelectedHex(hex);
  }, []);

  const handleLibraryPick = useCallback(
    (yarn: YarnOption) => {
      if (fillMode === "whole") {
        if (!selectedHex) return;
        // Replace the selected colour everywhere it appears.
        commit({ ...colorMap, [selectedHex]: yarn });
      } else {
        // Area mode: arm this yarn; the next tap on the rug floods a region.
        setFillYarn(yarn);
      }
    },
    [selectedHex, fillMode, colorMap, commit]
  );

  const handleInThisRugSelect = useCallback((hex: string) => {
    setSelectedHex((cur) => (cur === hex ? null : hex));
  }, []);

  const handleIdea = useCallback(
    (kind: IdeaKind) => {
      let next: Record<string, YarnOption> = {};
      if (kind === "slight") next = generateSlightVariation(colorMap, palette, yarns, 0.3);
      else if (kind === "full") next = generateSlightVariation(colorMap, palette, yarns, 1.0);
      else if (kind === "family") next = generateOneFamily(colorMap, palette, yarns);
      else next = generateShuffle(colorMap, palette);
      if (Object.keys(next).length === 0) return; // nothing applicable — no-op
      commit({ ...colorMap, ...next });
    },
    [colorMap, palette, yarns, commit]
  );

  const handleFillModeChange = useCallback((m: "whole" | "area") => {
    setFillMode(m);
    if (m === "whole") setFillYarn(null);
  }, []);

  // Readout (spec §10.1 — number only). Area mode shows what's armed to paint.
  const readout =
    fillMode === "area"
      ? fillYarn
        ? `${fillYarn.code} — tap an area to fill`
        : "Pick a colour, then tap an area"
      : selectedHex
        ? (colorMap[selectedHex]?.code ?? selectedHex)
        : "";

  const libraryDisabled = fillMode === "whole" && !selectedHex;

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
            <FillSwitch mode={fillMode} onChange={handleFillModeChange} />
            <div className="flex items-center gap-1.5">
              {IDEAS.map((idea) => (
                <button
                  key={idea.kind}
                  onClick={() => handleIdea(idea.kind)}
                  disabled={!hasAssignments}
                  title={idea.hint}
                  className="px-3 py-1.5 rounded-md text-[13px] text-neutral-600 border border-neutral-200 hover:border-neutral-400 hover:bg-neutral-50 disabled:opacity-40 disabled:hover:border-neutral-200 disabled:hover:bg-transparent transition-colors"
                >
                  {idea.label}
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
                mode={fillMode === "area" ? "region" : "global"}
                fillYarn={fillMode === "area" ? (fillYarn ?? undefined) : undefined}
                onRegionFillDelta={() => registerRegionOp()}
              />
            </div>
          </div>

          {/* Colour readout (number only — spec §10.1). */}
          <div className="shrink-0 h-7 flex items-center justify-center text-[13px] text-neutral-500 border-t border-neutral-200">
            {readout}
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
            disabled={libraryDisabled}
          />
        </aside>
      </div>
    </div>
  );
}
