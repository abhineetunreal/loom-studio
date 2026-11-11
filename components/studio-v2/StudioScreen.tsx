"use client";

/**
 * StudioScreen — Loom Studio v2 colouring screen (spec: 10 Nov 2026).
 *
 * Four zones (spec §3): header · left rail (fill / four options / shortlist) ·
 * centre stage (rug + texture + caption) · right panel ("In this rug" grid +
 * wool library). Warm editorial theme defined in the (studio-v2) layout.
 *
 * Working flows: select a colour (tap rug or grid), whole-colour fill, area
 * fill ("chosen areas"), the four options (slight / full / tone-to-tone /
 * shuffle) with per-colour locks, shortlist with snapshot thumbnails, export,
 * undo/redo across whole-colour and area edits, and the texture toggle.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import LeftRail, { type ShortlistItem } from "./LeftRail";

const RecolorCanvas = dynamic(() => import("@/components/design/RecolorCanvas"), { ssr: false });

type ColorMap = Record<string, YarnOption | null>;
type Op = { type: "map"; prevMap: ColorMap } | { type: "region" };

export type IdeaKind = "slight" | "full" | "family" | "shuffle";

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
  design, palette, yarns, initialColorMap, tenant,
}: StudioScreenProps) {
  const canvasRef = useRef<RecolorCanvasHandle>(null);

  // ── Recolor state + history ─────────────────────────────────────────────────
  const [colorMap, setColorMap] = useState<ColorMap>(() => ({ ...initialColorMap }));
  const past = useRef<Op[]>([]);
  const future = useRef<Op[]>([]);
  const [, forceTick] = useState(0);
  const bump = () => forceTick((t) => t + 1);

  const [selectedHex, setSelectedHex] = useState<string | null>(null);
  const [fillMode, setFillMode] = useState<"whole" | "area">("whole");
  const [fillYarn, setFillYarn] = useState<YarnOption | null>(null);
  const [textureOn, setTextureOn] = useState(true);
  const [librarySearch, setLibrarySearch] = useState("");
  const [lockedHexes, setLockedHexes] = useState<Set<string>>(() => new Set());
  const [shortlist, setShortlist] = useState<ShortlistItem[]>([]);
  const shortlistMaps = useRef<Map<string, ColorMap>>(new Map());
  const [selectedShortlistId, setSelectedShortlistId] = useState<string | null>(null);
  const [compareActive, setCompareActive] = useState(false);

  const commit = useCallback((next: ColorMap) => {
    past.current = [...past.current.slice(-99), { type: "map", prevMap: colorMap }];
    future.current = [];
    setColorMap(next);
    setSelectedShortlistId(null);
    bump();
  }, [colorMap]);

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

  // ── Derived ──────────────────────────────────────────────────────────────────
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
  const inUseIds = useMemo(() => {
    const s = new Set<string>();
    for (const y of Object.values(colorMap)) if (y) s.add(y.id);
    return s;
  }, [colorMap]);

  // ── Interactions ─────────────────────────────────────────────────────────────
  const handleRugPick = useCallback((hex: string) => setSelectedHex(hex), []);

  const handleLibraryPick = useCallback(
    (yarn: YarnOption) => {
      if (fillMode === "whole") {
        if (!selectedHex) return;
        commit({ ...colorMap, [selectedHex]: yarn });
      } else {
        setFillYarn(yarn);
      }
    },
    [selectedHex, fillMode, colorMap, commit]
  );

  const handleInThisRugSelect = useCallback(
    (hex: string) => setSelectedHex((cur) => (cur === hex ? null : hex)),
    []
  );

  const handleIdea = useCallback(
    (kind: IdeaKind) => {
      let next: Record<string, YarnOption> = {};
      if (kind === "slight") next = generateSlightVariation(colorMap, palette, yarns, 0.3);
      else if (kind === "full") next = generateSlightVariation(colorMap, palette, yarns, 1.0);
      else if (kind === "family") next = generateOneFamily(colorMap, palette, yarns);
      else next = generateShuffle(colorMap, palette);
      if (Object.keys(next).length === 0) return;
      // Respect locks — keep locked colours exactly as they are.
      const merged: ColorMap = { ...colorMap, ...next };
      for (const hex of lockedHexes) merged[hex] = colorMap[hex];
      commit(merged);
    },
    [colorMap, palette, yarns, lockedHexes, commit]
  );

  const handleFillMode = useCallback((m: "whole" | "area") => {
    setFillMode(m);
    if (m === "whole") setFillYarn(null);
  }, []);

  const toggleLock = useCallback((hex: string) => {
    setLockedHexes((prev) => {
      const n = new Set(prev);
      if (n.has(hex)) n.delete(hex); else n.add(hex);
      return n;
    });
  }, []);

  const handleShortlist = useCallback(() => {
    const thumb = canvasRef.current?.getSnapshot(360, "jpeg", 0.82) ?? null;
    const id = `sl-${Date.now()}`;
    shortlistMaps.current.set(id, { ...colorMap });
    setShortlist((prev) => [...prev, { id, thumb, label: `Option ${prev.length + 1}` }]);
    setSelectedShortlistId(id);
  }, [colorMap]);

  const selectShortlist = useCallback((id: string) => {
    const map = shortlistMaps.current.get(id);
    if (!map) return;
    commit({ ...map });
    setSelectedShortlistId(id);
  }, [commit]);

  const removeShortlist = useCallback((id: string) => {
    shortlistMaps.current.delete(id);
    setShortlist((prev) => prev.filter((s) => s.id !== id));
    setSelectedShortlistId((cur) => (cur === id ? null : cur));
  }, []);

  const handleExport = useCallback(() => {
    const url = canvasRef.current?.getSnapshot(1600, "png");
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `${design.slug || "colourway"}.png`;
    a.click();
  }, [design.slug]);

  // ── Stage sizing — fit the rug to the available area in both orientations ─────
  const stageRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ar = design.width / design.height;
    const measure = () => {
      const cw = el.clientWidth, ch = el.clientHeight;
      if (!cw || !ch) return;
      let w = cw, h = cw / ar;
      if (h > ch) { h = ch; w = ch * ar; }
      setBox({ w: Math.floor(w), h: Math.floor(h) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [design.width, design.height]);

  // ── Copy ─────────────────────────────────────────────────────────────────────
  const activeName =
    fillMode === "area"
      ? fillYarn?.name ?? null
      : selectedHex
        ? colorMap[selectedHex]?.name ?? null
        : null;

  const caption =
    fillMode === "area"
      ? fillYarn
        ? `Tap an area to fill it with ${fillYarn.name}.`
        : "Pick a colour on the right, then tap an area of the rug."
      : selectedHex
        ? `Changing ${colorMap[selectedHex]?.name ?? "this colour"} everywhere it appears. Tap a swatch on the right.`
        : "Tap a colour in the rug, then pick a wool on the right.";

  const libraryDisabled = fillMode === "whole" && !selectedHex;

  return (
    <div className="flex flex-col h-dvh w-full overflow-hidden bg-[var(--paper)]">
      <StudioHeader
        productName={tenant?.displayName ?? tenant?.name ?? "Loom Studio"}
        logoUrl={tenant?.logoUrl ?? null}
        design={design}
        onUndo={undo}
        onRedo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
        onCompare={() => setCompareActive((v) => !v)}
        compareActive={compareActive}
        onShortlist={handleShortlist}
      />

      <div className="flex flex-1 min-h-0">
        <LeftRail
          fillMode={fillMode}
          onFillMode={handleFillMode}
          onIdea={handleIdea}
          ideasEnabled={hasAssignments}
          shortlist={shortlist}
          selectedShortlistId={selectedShortlistId}
          onSelectShortlist={selectShortlist}
          onRemoveShortlist={removeShortlist}
          onExport={handleExport}
        />

        {/* ── Stage ───────────────────────────────────────────────────────────── */}
        <main className="flex-1 min-w-0 flex flex-col bg-[var(--paper)]">
          <div className="flex-1 min-h-0 p-8 flex">
            <div ref={stageRef} className="relative flex-1 min-h-0 flex items-center justify-center">
              {box && (
                <div
                  className="relative shadow-[0_6px_30px_rgba(44,42,36,0.14)]"
                  style={{ width: box.w, height: box.h }}
                >
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
              )}
              {/* Wool texture pill */}
              <button
                onClick={() => setTextureOn((v) => !v)}
                className="absolute left-0 bottom-0 flex items-center gap-2 px-3 py-1.5 rounded-md bg-[var(--raise)]/90 border border-[var(--line-strong)] backdrop-blur-sm text-[12.5px] text-[var(--ink)]"
              >
                <span className={`w-3 h-3 rounded-[2px] ${textureOn ? "bg-[var(--ink)]" : "bg-transparent border border-[var(--line-strong)]"}`} />
                Wool texture
              </button>
            </div>
          </div>
          {/* Caption */}
          <div className="shrink-0 h-9 flex items-center justify-center px-4 border-t border-[var(--line)] bg-[var(--panel)]">
            <span className="u-mono text-[12px] text-[var(--ink-soft)] truncate">{caption}</span>
          </div>
        </main>

        {/* ── Right panel ─────────────────────────────────────────────────────── */}
        <aside className="shrink-0 flex min-h-0 border-l border-[var(--line)]">
          <InThisRug
            entries={inThisRug}
            selectedHex={selectedHex}
            onSelect={handleInThisRugSelect}
            lockedHexes={lockedHexes}
            onToggleLock={toggleLock}
          />
          <div className="w-[340px] flex min-h-0">
            <LibraryPanel
              yarns={yarns}
              search={librarySearch}
              onSearch={setLibrarySearch}
              onPick={handleLibraryPick}
              disabled={libraryDisabled}
              activeName={activeName}
              inUseIds={inUseIds}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
