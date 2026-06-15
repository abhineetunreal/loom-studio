"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import RecolorCanvas, { type RecolorCanvasHandle, type RegionFillDelta, type RegionUndoDelta } from "./RecolorCanvas";
import { textureShader } from "@/lib/texture-shader";
import type { PaletteEntry, TierInfo, YarnOption } from "@/types";

type Props = {
  design: { name: string; imageUrl: string; width: number; height: number; palette: PaletteEntry[] };
  colorMap: Record<string, YarnOption | null>;
  selectedHex: string | null;
  onColorPick: (hex: string, clientX: number, clientY: number) => void;
  canvasRef: React.RefObject<RecolorCanvasHandle | null>;
  onUndo: () => void;
  onRedo: () => void;
  onReset: () => void;
  canUndo: boolean;
  canRedo: boolean;
  hasChanges: boolean;
  /** Opens the save modal when the user clicks "Save colorway" */
  onSave?: () => Promise<void>;
  /** Opens the colorway submission form */
  onRequestColorway: () => void;
  /** Tier info — controls which request-colorway CTA is shown */
  tierInfo: TierInfo;
  /** When true the "Save colorway" floating button is shown */
  canSave: boolean;
  /** Called once the first full render is painted — used to gate region-fill replay */
  onRenderComplete?: () => void;
  /** When true, extends the loading overlay over the canvas until the caller clears it.
   *  Used to hide the flash of unregion-filled colors while restoring a saved colorway. */
  colorwayLoading?: boolean;
  textureEnabled: boolean;
  onToggleTexture: () => void;
  /** Current recolor mode — "global" or "region" (flood fill). */
  mode: "global" | "region";
  onToggleMode: () => void;
  /** Yarn selected as the region-fill paint color. */
  selectedFillYarn: YarnOption | null;
  onRegionFillDelta?: (delta: RegionFillDelta) => void;
  onRegionUndoDelta?: (delta: RegionUndoDelta) => void;
  onRegionClear?: () => void;
};

function clampPan(
  panX: number,
  panY: number,
  zoom: number,
  fitW: number,
  fitH: number,
  zoneW: number,
  zoneH: number
): { x: number; y: number } {
  if (zoom <= 1) return { x: 0, y: 0 };
  const scaledW = fitW * zoom;
  const scaledH = fitH * zoom;
  // How far the canvas extends beyond the zone center
  const maxX = Math.max(0, (scaledW - zoneW) / 2);
  const maxY = Math.max(0, (scaledH - zoneH) / 2);
  return {
    x: Math.max(-maxX, Math.min(maxX, panX)),
    y: Math.max(-maxY, Math.min(maxY, panY)),
  };
}

export default function CanvasZone({
  design,
  colorMap,
  selectedHex,
  onColorPick,
  canvasRef,
  onUndo,
  onRedo,
  onReset,
  canUndo,
  canRedo,
  hasChanges,
  onSave,
  onRequestColorway,
  tierInfo,
  canSave,
  onRenderComplete,
  colorwayLoading,
  textureEnabled,
  onToggleTexture,
  mode,
  onToggleMode,
  selectedFillYarn,
  onRegionFillDelta,
  onRegionUndoDelta,
  onRegionClear,
}: Props) {
  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const [zoneSize, setZoneSize] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  // True from mount until the first full render (recolor + texture) is painted.
  // Drives the loading overlay — hides the blank canvas while pixels are loading.
  const [isLoading, setIsLoading] = useState(true);

  // Texture tuning controls — knot size is inverted (slider right = larger knots = lower multiplier)
  // knotSlider range 0.25–1.0; tileMultiplier = 1.25 - knotSlider → range 0.25×–1.0×; default 0.60 → 0.65×
  const [knotSlider, setKnotSlider] = useState(0.60);
  const [textureStrength, setTextureStrength] = useState(1.5);
  const tileMultiplier = 1.25 - knotSlider;
  // Photo-swatch scale: multiplicative factor on the physically-calculated tile size.
  // Separate from tileMultiplier — only affects photo-type colors.
  const [swatchScale, setSwatchScale] = useState(1.0);
  // Toast shown after "Save Scale" completes
  const [saveScaleToast, setSaveScaleToast] = useState<string | null>(null);

  // True when any yarn in the current colorMap (or the active fill yarn) is a photo swatch.
  // Controls visibility of the Swatch Scale slider.
  const hasPhotoColors =
    Object.values(colorMap).some((y) => y?.renderType === "photo") ||
    selectedFillYarn?.renderType === "photo";

  // Refs to avoid stale closures in event listeners
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const zoneSizeRef = useRef({ w: 0, h: 0 });

  // Sync state → refs
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panRef.current = pan; }, [pan]);
  useEffect(() => { zoneSizeRef.current = zoneSize; }, [zoneSize]);

  // ResizeObserver on the canvas area div
  useEffect(() => {
    const el = canvasAreaRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setZoneSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Compute object-contain fit dimensions
  const aspectRatio = design.width / design.height;
  const { w: zoneW, h: zoneH } = zoneSize;
  let fitW = 0;
  let fitH = 0;
  if (zoneW > 0 && zoneH > 0) {
    if (zoneW / zoneH > aspectRatio) {
      // Height is binding
      fitH = zoneH;
      fitW = zoneH * aspectRatio;
    } else {
      // Width is binding
      fitW = zoneW;
      fitH = zoneW / aspectRatio;
    }
  }

  // Wheel zoom
  useEffect(() => {
    const el = canvasAreaRef.current;
    if (!el) return;

    function handleWheel(e: WheelEvent) {
      e.preventDefault();
      const { w: cZoneW, h: cZoneH } = zoneSizeRef.current;
      const cZoom = zoomRef.current;
      const cPan = panRef.current;

      const cAspect = design.width / design.height;
      let cFitW = 0, cFitH = 0;
      if (cZoneW > 0 && cZoneH > 0) {
        if (cZoneW / cZoneH > cAspect) {
          cFitH = cZoneH; cFitW = cZoneH * cAspect;
        } else {
          cFitW = cZoneW; cFitH = cZoneW / cAspect;
        }
      }

      let zoomFactor: number;
      if (e.ctrlKey) {
        zoomFactor = Math.max(0.5, Math.min(2.0, 1 - e.deltaY * 0.008));
      } else {
        zoomFactor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      }

      const newZoom = Math.max(1, Math.min(4, cZoom * zoomFactor));
      const domEl = canvasAreaRef.current;
      if (!domEl) return;
      const rect = domEl.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const A = mouseX - cZoneW / 2;
      const B = mouseY - cZoneH / 2;
      const r = newZoom / cZoom;
      const rawPanX = A * (1 - r) + cPan.x * r;
      const rawPanY = B * (1 - r) + cPan.y * r;
      const clamped = clampPan(rawPanX, rawPanY, newZoom, cFitW, cFitH, cZoneW, cZoneH);

      zoomRef.current = newZoom;
      panRef.current = clamped;
      setZoom(newZoom);
      setPan(clamped);
    }

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [design.width, design.height]);

  // Touch pinch zoom
  useEffect(() => {
    const el = canvasAreaRef.current;
    if (!el) return;

    let lastDist = 0;
    let lastCenter = { x: 0, y: 0 };

    function getTouchDist(touches: TouchList) {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function getTouchCenter(touches: TouchList) {
      return {
        x: (touches[0].clientX + touches[1].clientX) / 2,
        y: (touches[0].clientY + touches[1].clientY) / 2,
      };
    }

    function handleTouchMove(e: TouchEvent) {
      if (e.touches.length !== 2) return;
      e.preventDefault();

      const dist = getTouchDist(e.touches);
      const center = getTouchCenter(e.touches);

      if (lastDist === 0) {
        lastDist = dist;
        lastCenter = center;
        return;
      }

      const { w: cZoneW, h: cZoneH } = zoneSizeRef.current;
      const cZoom = zoomRef.current;
      const cPan = panRef.current;

      const cAspect = design.width / design.height;
      let cFitW = 0, cFitH = 0;
      if (cZoneW > 0 && cZoneH > 0) {
        if (cZoneW / cZoneH > cAspect) {
          cFitH = cZoneH; cFitW = cZoneH * cAspect;
        } else {
          cFitW = cZoneW; cFitH = cZoneW / cAspect;
        }
      }

      const zoomFactor = dist / lastDist;
      const newZoom = Math.max(1, Math.min(4, cZoom * zoomFactor));
      const domEl2 = canvasAreaRef.current;
      if (!domEl2) return;
      const rect = domEl2.getBoundingClientRect();
      const mouseX = center.x - rect.left;
      const mouseY = center.y - rect.top;
      const A = mouseX - cZoneW / 2;
      const B = mouseY - cZoneH / 2;
      const r = newZoom / cZoom;
      const rawPanX = A * (1 - r) + cPan.x * r;
      const rawPanY = B * (1 - r) + cPan.y * r;
      const clamped = clampPan(rawPanX, rawPanY, newZoom, cFitW, cFitH, cZoneW, cZoneH);

      lastDist = dist;
      lastCenter = center;
      zoomRef.current = newZoom;
      panRef.current = clamped;
      setZoom(newZoom);
      setPan(clamped);
    }

    function handleTouchEnd() {
      lastDist = 0;
    }

    el.addEventListener("touchmove", handleTouchMove, { passive: false });
    el.addEventListener("touchend", handleTouchEnd);
    return () => {
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
    };
  }, [design.width, design.height]);

  // Pointer drag state
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointerStartRef.current = { x: e.clientX, y: e.clientY };
    isDraggingRef.current = false;
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!pointerStartRef.current) return;
    const dx = e.clientX - pointerStartRef.current.x;
    const dy = e.clientY - pointerStartRef.current.y;
    if (!isDraggingRef.current && Math.sqrt(dx * dx + dy * dy) > 4) {
      isDraggingRef.current = true;
    }
    if (isDraggingRef.current && zoom > 1) {
      const newPan = clampPan(
        pan.x + dx,
        pan.y + dy,
        zoom,
        fitW,
        fitH,
        zoneW,
        zoneH
      );
      // Update start to current so delta is incremental
      pointerStartRef.current = { x: e.clientX, y: e.clientY };
      panRef.current = newPan;
      setPan(newPan);
    }
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!isDraggingRef.current) {
      // It's a tap — dispatch to the correct handler based on mode
      if (mode === "region") {
        canvasRef.current?.regionFillAt(e.clientX, e.clientY);
      } else {
        canvasRef.current?.pickColorAt(e.clientX, e.clientY);
      }
    }
    pointerStartRef.current = null;
    isDraggingRef.current = false;
  }

  const [isDragging, setIsDragging] = useState(false);

  function handlePointerDownWithState(e: React.PointerEvent<HTMLDivElement>) {
    setIsDragging(false);
    handlePointerDown(e);
  }

  function handlePointerMoveWithState(e: React.PointerEvent<HTMLDivElement>) {
    if (pointerStartRef.current) {
      const dx = e.clientX - pointerStartRef.current.x;
      const dy = e.clientY - pointerStartRef.current.y;
      if (!isDraggingRef.current && Math.sqrt(dx * dx + dy * dy) > 4) {
        setIsDragging(true);
      }
    }
    handlePointerMove(e);
  }

  function handlePointerUpWithState(e: React.PointerEvent<HTMLDivElement>) {
    handlePointerUp(e);
    setIsDragging(false);
  }

  // In region mode always show crosshair (paint-bucket intent);
  // in global mode show grab when zoomed in for panning affordance.
  const cursor =
    mode === "region" || zoom === 1 ? "crosshair" : isDragging ? "grabbing" : "grab";

  async function handleSaveScale() {
    // Collect unique photo yarns from global colorMap + active region fills
    const photoYarns = new Map<string, YarnOption>(); // id → yarn
    for (const yarn of Object.values(colorMap)) {
      if (yarn?.renderType === "photo" && yarn.swatchImageUrl) {
        photoYarns.set(yarn.id, yarn);
      }
    }
    for (const yarn of canvasRef.current?.getActivePhotoYarns() ?? []) {
      photoYarns.set(yarn.id, yarn);
    }
    if (photoYarns.size === 0) return;

    await Promise.all(
      [...photoYarns.values()].map((yarn) =>
        fetch(`/api/admin/yarns/${yarn.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ swatchScale }),
        })
      )
    );

    const codes = [...photoYarns.values()].map((y) => y.code).join(", ");
    setSaveScaleToast(`Scale saved for: ${codes}`);
    setTimeout(() => setSaveScaleToast(null), 3500);
  }

  function handleZoomSlider(value: number) {
    const newZoom = value;
    const clamped = clampPan(pan.x, pan.y, newZoom, fitW, fitH, zoneW, zoneH);
    zoomRef.current = newZoom;
    panRef.current = clamped;
    setZoom(newZoom);
    setPan(clamped);
  }

  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden bg-[#e8e5dd]">
      {/* Save Scale toast */}
      {saveScaleToast && (
        <div
          role="status"
          aria-live="polite"
          className="absolute bottom-14 left-1/2 -translate-x-1/2 z-50 pointer-events-none"
        >
          <div className="animate-fade-in bg-stone-800 text-white text-xs px-3 py-2 rounded-lg shadow-lg whitespace-nowrap">
            {saveScaleToast}
          </div>
        </div>
      )}

      {/* Canvas area */}
      <div ref={canvasAreaRef} className="flex-1 relative overflow-hidden">
        {zoneW > 0 && (
          <>
            {/* Canvas wrapper: absolutely positioned, centered + panned */}
            <div
              className="absolute pointer-events-none"
              style={{
                left: "50%",
                top: "50%",
                transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px))`,
                width: fitW * zoom,
                height: fitH * zoom,
              }}
            >
              <RecolorCanvas
                ref={canvasRef}
                imageUrl={design.imageUrl}
                width={design.width}
                height={design.height}
                palette={design.palette}
                colorMap={colorMap}
                selectedHex={selectedHex}
                onColorPick={onColorPick}
                textureEnabled={textureEnabled}
                designName={design.name}
                tileMultiplier={tileMultiplier}
                textureStrength={textureStrength}
                swatchScale={swatchScale}
                onRenderComplete={() => { setIsLoading(false); onRenderComplete?.(); }}
                mode={mode}
                fillYarn={selectedFillYarn ?? undefined}
                onRegionFillDelta={onRegionFillDelta}
                onRegionUndoDelta={onRegionUndoDelta}
                onRegionClear={onRegionClear}
              />
            </div>

            {/* Pointer overlay for pan/tap detection */}
            <div
              className="absolute inset-0 z-10"
              style={{ cursor }}
              onPointerDown={handlePointerDownWithState}
              onPointerMove={handlePointerMoveWithState}
              onPointerUp={handlePointerUpWithState}
            />
          </>
        )}

        {/* Loading overlay — shown during image fetch + pixel loop, and while restoring a saved colorway. */}
        {(isLoading || colorwayLoading) && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[#e8e5dd]">
            <SpinnerIcon className="w-8 h-8 text-stone-400 animate-spin" />
            {colorwayLoading && !isLoading && (
              <p className="text-xs text-stone-500">Loading colorway…</p>
            )}
          </div>
        )}

        {/* Floating action buttons — bottom-right of canvas area, above pointer overlay */}
        {!isLoading && !colorwayLoading && (
          <div className="absolute bottom-4 right-4 z-30 flex flex-col gap-2 items-end pointer-events-none">
            {/* Request colorway (primary) */}
            {tierInfo.pendingApproval ? (
              <p className="pointer-events-auto text-xs px-3 py-2 text-amber-700 bg-amber-50/95 rounded-lg border border-amber-200 shadow whitespace-nowrap">
                Account pending approval
              </p>
            ) : tierInfo.tier === "demo" ? (
              <Link
                href="/auth/signin"
                className="pointer-events-auto text-xs px-4 py-2 rounded-lg bg-stone-900 text-white shadow hover:bg-stone-700 transition-colors whitespace-nowrap"
              >
                Sign in to request
              </Link>
            ) : (
              <button
                onClick={onRequestColorway}
                className="pointer-events-auto text-xs px-4 py-2 rounded-lg bg-stone-900 text-white shadow hover:bg-stone-700 transition-colors whitespace-nowrap"
              >
                Request colorway
              </button>
            )}

            {/* Save colorway (secondary) — only for approved users */}
            {canSave && onSave && (
              <button
                onClick={onSave}
                className="pointer-events-auto text-xs px-4 py-2 rounded-lg border border-stone-800 bg-white/90 text-stone-900 shadow hover:bg-stone-50 transition-colors whitespace-nowrap"
              >
                Save colorway
              </button>
            )}
          </div>
        )}
      </div>

      {/* Bottom toolbar */}
      <div className="h-10 shrink-0 flex items-center gap-1 px-2 bg-white border-t border-stone-200">
        {/* Left: Undo/Redo/Reset */}
        <div className="flex items-center gap-1 flex-1">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
            className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-stone-200 hover:bg-stone-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <UndoIcon /> Undo
          </button>
          <button
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo (Ctrl+Y)"
            className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-stone-200 hover:bg-stone-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <RedoIcon /> Redo
          </button>
          <button
            onClick={onReset}
            disabled={!hasChanges}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-stone-200 hover:bg-stone-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Reset
          </button>
        </div>

        {/* Centre: Flat/Textured toggle + tuning sliders.
            Sliders are always in the DOM so toggling never shifts other toolbar items.
            invisible + pointer-events-none hides them visually while preserving layout. */}
        <TextureToggle
          enabled={textureEnabled}
          onToggle={onToggleTexture}
        />
        <div className={`flex items-center gap-1 shrink-0 pl-1 border-l border-stone-200 ${textureEnabled ? "" : "invisible pointer-events-none"}`}>
          <span className="text-xs text-stone-500 whitespace-nowrap">Knot size</span>
          <input
            type="range"
            min={0.25}
            max={1}
            step={0.05}
            value={knotSlider}
            onChange={(e) => setKnotSlider(parseFloat(e.target.value))}
            className="w-20 accent-stone-700"
            aria-label="Knot size"
          />
          <span className="w-10 text-right text-xs text-stone-500 tabular-nums">
            {tileMultiplier.toFixed(2)}×
          </span>
        </div>
        <div className={`flex items-center gap-1 shrink-0 pl-1 border-l border-stone-200 ${textureEnabled ? "" : "invisible pointer-events-none"}`}>
          <span className="text-xs text-stone-500 whitespace-nowrap">Strength</span>
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.05}
            value={textureStrength}
            onChange={(e) => setTextureStrength(parseFloat(e.target.value))}
            className="w-20 accent-stone-700"
            aria-label="Texture strength"
          />
          <span className="w-8 text-right text-xs text-stone-500 tabular-nums">
            {textureStrength.toFixed(2)}
          </span>
        </div>
        {hasPhotoColors && (
          <div className="flex items-center gap-1 shrink-0 pl-1 border-l border-stone-200">
            <span className="text-xs text-stone-500 whitespace-nowrap">Swatch Scale</span>
            <input
              type="range"
              min={0.1}
              max={3.0}
              step={0.05}
              value={swatchScale}
              onChange={(e) => setSwatchScale(parseFloat(e.target.value))}
              className="w-20 accent-stone-700"
              aria-label="Swatch scale"
            />
            <input
              type="number"
              min={0.1}
              max={3.0}
              step={0.05}
              value={swatchScale}
              onChange={(e) => setSwatchScale(e.target.value === "" ? swatchScale : parseFloat(e.target.value))}
              onBlur={(e) => {
                const v = parseFloat(e.target.value);
                if (!isNaN(v)) setSwatchScale(Math.min(3.0, Math.max(0.1, v)));
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              className="w-14 text-xs text-stone-700 tabular-nums border border-stone-200 rounded px-1 py-0.5 text-right"
              aria-label="Swatch scale value"
            />
            {tierInfo.tier === "admin" && (
              <button
                onClick={handleSaveScale}
                className="text-xs px-2 py-1 rounded border border-stone-300 bg-stone-50 hover:bg-stone-100 text-stone-700 whitespace-nowrap transition-colors"
                title="Save current scale as the calibrated default for these photo yarns"
              >
                Save Scale
              </button>
            )}
          </div>
        )}

        {/* Right: Zoom controls */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => handleZoomSlider(Math.max(1, zoom - 0.1))}
            className="text-xs w-5 h-5 flex items-center justify-center rounded hover:bg-stone-100 text-stone-600"
            aria-label="Zoom out"
          >
            −
          </button>
          <input
            type="range"
            min={1}
            max={4}
            step={0.1}
            value={zoom}
            onChange={(e) => handleZoomSlider(parseFloat(e.target.value))}
            className="w-20 accent-stone-700"
            aria-label="Zoom level"
          />
          <button
            onClick={() => handleZoomSlider(Math.min(4, zoom + 0.1))}
            className="text-xs w-5 h-5 flex items-center justify-center rounded hover:bg-stone-100 text-stone-600"
            aria-label="Zoom in"
          >
            +
          </button>
          <span className="w-8 text-right text-xs text-stone-500 tabular-nums">
            {zoom.toFixed(1)}×
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── TextureToggle ────────────────────────────────────────────────────────────

function TextureToggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    if (enabled) {
      // Turning off is instant
      onToggle();
      return;
    }
    // Turning on: preload textures first (no-op if already cached)
    setLoading(true);
    try {
      await textureShader.load("422");
    } finally {
      setLoading(false);
    }
    onToggle();
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      title={enabled ? "Switch to flat rendering" : "Apply wool texture overlay"}
      className={`flex items-center gap-1 text-xs px-2 py-1 rounded border transition-colors disabled:cursor-wait ${
        enabled
          ? "border-stone-700 bg-stone-800 text-white hover:bg-stone-700"
          : "border-stone-200 text-stone-600 hover:bg-stone-100"
      }`}
    >
      {loading && <SpinnerIcon className="w-3 h-3 animate-spin shrink-0" />}
      {enabled ? "Textured" : "Flat"}
    </button>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" d="M12 3a9 9 0 109 9" />
    </svg>
  );
}

function UndoIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3" />
    </svg>
  );
}
