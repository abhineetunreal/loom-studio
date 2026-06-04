"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import RecolorCanvas, { type RecolorCanvasHandle } from "./RecolorCanvas";
import type { PaletteEntry, YarnOption } from "@/types";

type Props = {
  design: { imageUrl: string; width: number; height: number; palette: PaletteEntry[] };
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
}: Props) {
  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const [zoneSize, setZoneSize] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

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
      // It's a tap — pick color
      canvasRef.current?.pickColorAt(e.clientX, e.clientY);
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

  const cursor =
    zoom === 1 ? "crosshair" : isDragging ? "grabbing" : "grab";

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
