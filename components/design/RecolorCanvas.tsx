"use client";

/**
 * RecolorCanvas
 *
 * Renders the rug design on a <canvas> and handles pixel-level recoloring.
 *
 * Render pipeline (v2-ready):
 *   Step 1 — applyRecolor(originalPixels, lookup) → baseImageData
 *   Step 2 — [v2 slot] multiplyNormalMap(baseImageData, textureData)
 *   Step 3 — ctx.putImageData(baseImageData, 0, 0)
 *
 * The originalPixels Uint8ClampedArray is stored in a ref and never mutated.
 * Every recolor is a fresh pass over that buffer — no cumulative drift.
 *
 * Click/touch handling maps CSS coordinates → canvas pixel coordinates,
 * reads from originalPixels (not the current recolored display), and calls
 * onColorPick with the hex at that point.
 */

import { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import { applyRecolor, buildColorLookup, rgbToHex } from "@/lib/recolor";
import type { PaletteEntry, YarnOption } from "@/types";

export type RecolorCanvasHandle = {
  /** Returns a data URL of the current recolored image, scaled to maxWidth. */
  getSnapshot: (maxWidth?: number) => string | null;
  /** Pick the palette color at the given viewport coordinates (forwarded from CanvasZone). */
  pickColorAt: (clientX: number, clientY: number) => void;
};

type Props = {
  imageUrl: string;
  width: number;
  height: number;
  palette: PaletteEntry[];
  colorMap: Record<string, YarnOption | null>;
  selectedHex: string | null;
  onColorPick: (hex: string, clientX: number, clientY: number) => void;
};

const RecolorCanvas = forwardRef<RecolorCanvasHandle, Props>(function RecolorCanvas(
  { imageUrl, width, height, palette, colorMap, selectedHex, onColorPick },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Immutable source-of-truth pixel data, loaded once from the PNG
  const originalPixels = useRef<Uint8ClampedArray | null>(null);
  // Set of valid palette hex values for fast lookup on click
  const paletteHexSet = useRef<Set<string>>(new Set(palette.map((e) => e.hex)));

  // ── Expose getSnapshot() and pickColorAt() to parent ────────────────────────
  useImperativeHandle(ref, () => ({
    getSnapshot(maxWidth = 800) {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const scale = Math.min(1, maxWidth / canvas.width);
      const w = Math.round(canvas.width * scale);
      const h = Math.round(canvas.height * scale);
      const offscreen = document.createElement("canvas");
      offscreen.width = w;
      offscreen.height = h;
      offscreen.getContext("2d")!.drawImage(canvas, 0, 0, w, h);
      return offscreen.toDataURL("image/png");
    },
    pickColorAt(clientX: number, clientY: number) {
      pickColorAt(clientX, clientY);
    },
  }));

  // ── Load image once → extract originalPixels ────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      ctx.drawImage(img, 0, 0, width, height);
      try {
        const imageData = ctx.getImageData(0, 0, width, height);
        // Slice makes an independent copy — the Uint8ClampedArray is immutable
        originalPixels.current = imageData.data.slice();
      } catch {
        // Canvas tainted by CORS — display still works, pixel ops won't
        console.warn("Canvas tainted: pixel operations disabled (CORS)");
      }
    };
    img.onerror = () => console.error("Failed to load design image");
    img.src = imageUrl;
  }, [imageUrl, width, height]);

  // ── Re-render when colorMap changes ─────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const pixels = originalPixels.current;
    if (!canvas || !pixels) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const lookup = buildColorLookup(colorMap);

    // ── Step 1: base layer (flat recolored image) ──
    const baseImageData = applyRecolor(pixels, width, height, lookup);

    // ── Step 2: [v2 texture slot] ──────────────────
    // if (textureImageData) multiplyNormalMap(baseImageData, textureImageData);

    // ── Step 3: draw to canvas ─────────────────────
    ctx.putImageData(baseImageData, 0, 0);
  }, [colorMap, width, height]);

  // ── Click/touch: pick color from original pixel data ────────────────────────
  function pickColorAt(clientX: number, clientY: number) {
    const canvas = canvasRef.current;
    const pixels = originalPixels.current;
    if (!canvas || !pixels) return;

    // Map CSS coordinates → canvas pixel coordinates (handles scaling)
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = Math.floor((clientX - rect.left) * scaleX);
    const y = Math.floor((clientY - rect.top) * scaleY);

    if (x < 0 || y < 0 || x >= width || y >= height) return;

    const i = (y * width + x) * 4;
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const a = pixels[i + 3];
    if (a === 0) return; // transparent pixel — ignore

    const hex = rgbToHex(r, g, b);
    // Only pick colors that are in the design palette — ignore click misses
    if (paletteHexSet.current.has(hex)) {
      onColorPick(hex, clientX, clientY);
    }
  }

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    pickColorAt(e.clientX, e.clientY);
  }

  function handleTouchEnd(e: React.TouchEvent<HTMLCanvasElement>) {
    const touch = e.changedTouches[0];
    if (touch) pickColorAt(touch.clientX, touch.clientY);
  }

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onClick={handleClick}
        onTouchEnd={handleTouchEnd}
        className="w-full h-full rounded-xl border border-stone-200 cursor-crosshair touch-none"
        aria-label="Rug design — click a color region to select it"
      />
      {/* Highlight ring on the selected color region is handled in PalettePanel,
          not on the canvas, to keep the render pipeline simple. */}
    </div>
  );
});

export default RecolorCanvas;
