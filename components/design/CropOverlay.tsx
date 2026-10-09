"use client";

import { useRef, useCallback, useEffect, useState } from "react";

export type CropRect = { x: number; y: number; w: number; h: number };

type Props = {
  /** Current crop selection in native design pixels, or null if none. */
  cropRect: CropRect | null;
  onCropChange: (rect: CropRect | null) => void;
  /** Native design dimensions. */
  designWidth: number;
  designHeight: number;
  /** CSS display dimensions of the canvas (fitW * zoom, fitH * zoom). */
  displayWidth: number;
  displayHeight: number;
  /** Minimum selection size in native design pixels. */
  minSize?: number;
};

const HANDLE_SIZE = 8;
const MIN_CROP_DEFAULT = 50;

type DragMode =
  | { type: "draw"; startX: number; startY: number }
  | { type: "move"; offsetX: number; offsetY: number }
  | { type: "resize"; edge: string; initRect: CropRect };

/**
 * CropOverlay renders a crop selection UI on top of the canvas.
 *
 * - Dimmed overlay outside the selection (four dark rectangles around the crop)
 * - Dashed selection border with contrast shadow
 * - Corner and edge resize handles
 * - Moveable interior
 * - Dimensions label
 *
 * All coordinates are stored in native design pixels; display positions are
 * derived by scaling to the CSS display size.
 */
export default function CropOverlay({
  cropRect,
  onCropChange,
  designWidth,
  designHeight,
  displayWidth,
  displayHeight,
  minSize = MIN_CROP_DEFAULT,
}: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragMode | null>(null);
  const cropRef = useRef<CropRect | null>(cropRect);
  cropRef.current = cropRect;

  // Scale factors: native design pixels → CSS display pixels
  const scaleX = displayWidth / designWidth;
  const scaleY = displayHeight / designHeight;

  // Convert native rect → display rect
  function toDisplay(r: CropRect) {
    return {
      left: r.x * scaleX,
      top: r.y * scaleY,
      width: r.w * scaleX,
      height: r.h * scaleY,
    };
  }

  // Convert display coordinates to native design coordinates
  const toNative = useCallback(
    (clientX: number, clientY: number): { nx: number; ny: number } => {
      const el = overlayRef.current;
      if (!el) return { nx: 0, ny: 0 };
      const rect = el.getBoundingClientRect();
      const dx = clientX - rect.left;
      const dy = clientY - rect.top;
      return {
        nx: Math.round(dx / scaleX),
        ny: Math.round(dy / scaleY),
      };
    },
    [scaleX, scaleY]
  );

  // Clamp a rect to design bounds and enforce minimum size
  const clampRect = useCallback(
    (r: CropRect): CropRect => {
      let { x, y, w, h } = r;
      w = Math.max(minSize, w);
      h = Math.max(minSize, h);
      if (x < 0) x = 0;
      if (y < 0) y = 0;
      if (x + w > designWidth) x = designWidth - w;
      if (y + h > designHeight) y = designHeight - h;
      // Final safety clamp
      x = Math.max(0, x);
      y = Math.max(0, y);
      w = Math.min(w, designWidth - x);
      h = Math.min(h, designHeight - y);
      return { x, y, w, h };
    },
    [designWidth, designHeight, minSize]
  );

  // Pointer handlers
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);

      const { nx, ny } = toNative(e.clientX, e.clientY);
      const crop = cropRef.current;

      if (!crop) {
        // Start drawing a new selection
        dragRef.current = { type: "draw", startX: nx, startY: ny };
        return;
      }

      // Check if pointer is on a handle
      const edge = getEdge(crop, nx, ny, Math.max(8, minSize * 0.1));
      if (edge) {
        dragRef.current = { type: "resize", edge, initRect: { ...crop } };
        return;
      }

      // Check if pointer is inside the crop rect → move
      if (nx >= crop.x && nx <= crop.x + crop.w && ny >= crop.y && ny <= crop.y + crop.h) {
        dragRef.current = { type: "move", offsetX: nx - crop.x, offsetY: ny - crop.y };
        return;
      }

      // Click outside → start a new selection
      dragRef.current = { type: "draw", startX: nx, startY: ny };
    },
    [toNative, minSize]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      e.preventDefault();
      e.stopPropagation();

      const { nx, ny } = toNative(e.clientX, e.clientY);
      const mode = dragRef.current;

      if (mode.type === "draw") {
        const x = Math.min(mode.startX, nx);
        const y = Math.min(mode.startY, ny);
        const w = Math.abs(nx - mode.startX);
        const h = Math.abs(ny - mode.startY);
        onCropChange(clampRect({ x, y, w: Math.max(1, w), h: Math.max(1, h) }));
        return;
      }

      if (mode.type === "move") {
        const crop = cropRef.current;
        if (!crop) return;
        onCropChange(
          clampRect({
            x: nx - mode.offsetX,
            y: ny - mode.offsetY,
            w: crop.w,
            h: crop.h,
          })
        );
        return;
      }

      if (mode.type === "resize") {
        const r = { ...mode.initRect };
        const { edge } = mode;

        if (edge.includes("l")) {
          const newX = Math.min(nx, r.x + r.w - minSize);
          r.w = r.w + (r.x - newX);
          r.x = newX;
        }
        if (edge.includes("r")) {
          r.w = Math.max(minSize, nx - r.x);
        }
        if (edge.includes("t")) {
          const newY = Math.min(ny, r.y + r.h - minSize);
          r.h = r.h + (r.y - newY);
          r.y = newY;
        }
        if (edge.includes("b")) {
          r.h = Math.max(minSize, ny - r.y);
        }

        onCropChange(clampRect(r));
      }
    },
    [toNative, onCropChange, clampRect, minSize]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const mode = dragRef.current;
      dragRef.current = null;

      // If draw mode produced a selection smaller than minSize, discard it
      if (mode?.type === "draw") {
        const crop = cropRef.current;
        if (crop && (crop.w < minSize || crop.h < minSize)) {
          onCropChange(null);
        }
      }
    },
    [onCropChange, minSize]
  );

  // Cursor for hover — show appropriate resize cursor on handles
  const [hoverCursor, setHoverCursor] = useState("crosshair");

  const handleHoverMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (dragRef.current) return; // don't change cursor while dragging
      const crop = cropRef.current;
      if (!crop) {
        setHoverCursor("crosshair");
        return;
      }
      const { nx, ny } = toNative(e.clientX, e.clientY);
      const edge = getEdge(crop, nx, ny, Math.max(8, minSize * 0.1));
      if (edge) {
        setHoverCursor(edgeToCursor(edge));
      } else if (nx >= crop.x && nx <= crop.x + crop.w && ny >= crop.y && ny <= crop.y + crop.h) {
        setHoverCursor("move");
      } else {
        setHoverCursor("crosshair");
      }
    },
    [toNative, minSize]
  );

  // Display rect for the crop selection
  const d = cropRect ? toDisplay(cropRect) : null;

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 z-10"
      style={{ cursor: hoverCursor }}
      onPointerDown={handlePointerDown}
      onPointerMove={(e) => {
        handlePointerMove(e);
        handleHoverMove(e);
      }}
      onPointerUp={handlePointerUp}
    >
      {d && cropRect && (
        <>
          {/* Dimmed overlay — four rectangles around the selection */}
          <div className="absolute inset-0 pointer-events-none">
            {/* Top */}
            <div
              className="absolute left-0 right-0 top-0 bg-black/50"
              style={{ height: d.top }}
            />
            {/* Bottom */}
            <div
              className="absolute left-0 right-0 bottom-0 bg-black/50"
              style={{ top: d.top + d.height }}
            />
            {/* Left */}
            <div
              className="absolute bg-black/50"
              style={{ left: 0, top: d.top, width: d.left, height: d.height }}
            />
            {/* Right */}
            <div
              className="absolute bg-black/50"
              style={{
                left: d.left + d.width,
                top: d.top,
                right: 0,
                height: d.height,
              }}
            />
          </div>

          {/* Selection border — dark shadow + white dashed */}
          <div
            className="absolute pointer-events-none"
            style={{
              left: d.left,
              top: d.top,
              width: d.width,
              height: d.height,
              border: "1px solid rgba(0,0,0,0.3)",
              boxShadow: "0 0 0 1px rgba(0,0,0,0.15)",
            }}
          />
          <div
            className="absolute pointer-events-none"
            style={{
              left: d.left,
              top: d.top,
              width: d.width,
              height: d.height,
              border: "2px dashed white",
            }}
          />

          {/* Resize handles — corners */}
          {renderHandle(d.left - HANDLE_SIZE / 2, d.top - HANDLE_SIZE / 2, "nwse-resize")}
          {renderHandle(d.left + d.width - HANDLE_SIZE / 2, d.top - HANDLE_SIZE / 2, "nesw-resize")}
          {renderHandle(d.left - HANDLE_SIZE / 2, d.top + d.height - HANDLE_SIZE / 2, "nesw-resize")}
          {renderHandle(d.left + d.width - HANDLE_SIZE / 2, d.top + d.height - HANDLE_SIZE / 2, "nwse-resize")}

          {/* Resize handles — edge midpoints */}
          {renderHandle(d.left + d.width / 2 - 3, d.top - 3, "ns-resize", 6)}
          {renderHandle(d.left + d.width / 2 - 3, d.top + d.height - 3, "ns-resize", 6)}
          {renderHandle(d.left - 3, d.top + d.height / 2 - 3, "ew-resize", 6)}
          {renderHandle(d.left + d.width - 3, d.top + d.height / 2 - 3, "ew-resize", 6)}

          {/* Dimensions label */}
          <div
            className="absolute pointer-events-none flex items-center justify-center"
            style={{
              left: d.left,
              top: d.top + d.height + 6,
              width: d.width,
            }}
          >
            <span className="text-[10px] font-medium text-white bg-black/60 px-1.5 py-0.5 rounded whitespace-nowrap">
              {cropRect.w} &times; {cropRect.h} px
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function renderHandle(left: number, top: number, cursor: string, size = HANDLE_SIZE) {
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left,
        top,
        width: size,
        height: size,
        backgroundColor: "white",
        border: "1px solid rgba(0,0,0,0.4)",
        borderRadius: 1,
        cursor,
      }}
    />
  );
}

/** Determine which edge/corner the point is near (within `threshold` native pixels). */
function getEdge(rect: CropRect, nx: number, ny: number, threshold: number): string | null {
  const { x, y, w, h } = rect;
  const nearL = Math.abs(nx - x) < threshold;
  const nearR = Math.abs(nx - (x + w)) < threshold;
  const nearT = Math.abs(ny - y) < threshold;
  const nearB = Math.abs(ny - (y + h)) < threshold;
  const inX = nx >= x - threshold && nx <= x + w + threshold;
  const inY = ny >= y - threshold && ny <= y + h + threshold;

  // Corners
  if (nearT && nearL) return "tl";
  if (nearT && nearR) return "tr";
  if (nearB && nearL) return "bl";
  if (nearB && nearR) return "br";
  // Edges
  if (nearT && inX) return "t";
  if (nearB && inX) return "b";
  if (nearL && inY) return "l";
  if (nearR && inY) return "r";
  return null;
}

function edgeToCursor(edge: string): string {
  switch (edge) {
    case "tl":
    case "br":
      return "nwse-resize";
    case "tr":
    case "bl":
      return "nesw-resize";
    case "t":
    case "b":
      return "ns-resize";
    case "l":
    case "r":
      return "ew-resize";
    default:
      return "crosshair";
  }
}
