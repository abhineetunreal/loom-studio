"use client";

/**
 * RecolorCanvas
 *
 * Renders the rug design on a <canvas> and handles pixel-level recoloring.
 *
 * Render pipeline:
 *   Step 1 — (await) textureShader.load("422")  — no-op if already cached
 *   Step 2 — textureShader.applyRecolorAndTexture(ssPixels, ...) → ImageData
 *             (single pass: color substitution + wool grain, 2× supersampled)
 *   Step 3 — OffscreenCanvas putImageData + drawImage blit → display canvas
 *             (bilinear downsample acts as box-filter anti-alias)
 *
 * The originalPixels Uint8ClampedArray is stored in a ref and never mutated.
 * Every recolor is a fresh pass over that buffer — no cumulative drift.
 *
 * Click/touch handling maps CSS coordinates → canvas pixel coordinates,
 * reads from originalPixels (not the current recolored display), and calls
 * onColorPick with the hex at that point.
 */

import { useEffect, useRef, useImperativeHandle, forwardRef, useState } from "react";
import { applyRecolor, buildColorLookup, rgbToHex } from "@/lib/recolor";
import { textureShader, computeTileScales, SUPERSAMPLE_FACTOR } from "@/lib/texture-shader";
import type { PaletteEntry, YarnOption } from "@/types";

// ─── Module-level pixel cache ─────────────────────────────────────────────────
// Persists across component unmounts (page navigations within a session) so
// revisiting a design skips the image decode + pixel extraction entirely.
// Keyed by imageUrl. FIFO eviction at MAX_PIXEL_CACHE entries.

const MAX_PIXEL_CACHE = 10;
const pixelCacheOrder: string[] = [];
const pixelCache = new Map<string, {
  native: Uint8ClampedArray;
  supersampled: Uint8ClampedArray;
}>();

function cachePixels(url: string, native: Uint8ClampedArray, supersampled: Uint8ClampedArray) {
  if (pixelCache.has(url)) return; // already cached (concurrent loads)
  if (pixelCache.size >= MAX_PIXEL_CACHE) {
    const evict = pixelCacheOrder.shift()!;
    pixelCache.delete(evict);
  }
  pixelCache.set(url, { native, supersampled });
  pixelCacheOrder.push(url);
}

// ─── Component ────────────────────────────────────────────────────────────────

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
  textureEnabled?: boolean;
  designName?: string;
  tileMultiplier?: number;
  textureStrength?: number;
  /** Called once the first full render (recolor + texture) is painted to the canvas. */
  onRenderComplete?: () => void;
};

const RecolorCanvas = forwardRef<RecolorCanvasHandle, Props>(function RecolorCanvas(
  { imageUrl, width, height, palette, colorMap, selectedHex, onColorPick, textureEnabled, designName, tileMultiplier = 0.65, textureStrength = 1.5, onRenderComplete },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Immutable source-of-truth pixel data at native resolution, for click-picking
  const originalPixels = useRef<Uint8ClampedArray | null>(null);
  // Same image upscaled to SUPERSAMPLE_FACTOR × native size, for the render pass
  const supersampledPixels = useRef<Uint8ClampedArray | null>(null);
  // Bumped when the image finishes loading so the render effect re-fires with real pixels.
  // Refs don't trigger effects — without this counter the textured render would never happen
  // on initial load (the render effect fires on mount before pixels arrive, returns early,
  // then has nothing to wake it up when onload sets the refs).
  const [pixelsVersion, setPixelsVersion] = useState(0);
  // Set of valid palette hex values for fast lookup on click
  const paletteHexSet = useRef<Set<string>>(new Set(palette.map((e) => e.hex)));
  // Guard: only call onRenderComplete once per design load
  const renderCompleteFired = useRef(false);

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

  // ── Load image → extract pixels (cache-first) ────────────────────────────────
  useEffect(() => {
    renderCompleteFired.current = false;

    // Check module-level cache first — avoids full image decode on revisit
    const cached = pixelCache.get(imageUrl);
    if (cached) {
      console.log(`[Canvas] image pixels: cache hit for ${imageUrl.split("/").pop()}`);
      originalPixels.current = cached.native;
      supersampledPixels.current = cached.supersampled;
      setPixelsVersion((v) => v + 1);
      return;
    }

    // Clear stale pixel data so the render effect can't use old pixels
    // for a different design while the new image is in flight.
    originalPixels.current = null;
    supersampledPixels.current = null;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const t0 = performance.now();
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      const loadMs = (performance.now() - t0).toFixed(0);
      console.log(`[Canvas] image load: ${loadMs}ms (network/disk)`);

      ctx.drawImage(img, 0, 0, width, height);
      try {
        const t1 = performance.now();
        const imageData = ctx.getImageData(0, 0, width, height);
        // Slice makes an independent copy — the Uint8ClampedArray is immutable
        const native = imageData.data.slice();

        // Extract 2× supersampled pixels for the render pass.
        // imageSmoothingEnabled=false: flat-color CAD image, no sub-pixel detail.
        const ss = SUPERSAMPLE_FACTOR;
        const ssW = width * ss;
        const ssH = height * ss;
        const ssCanvas = new OffscreenCanvas(ssW, ssH);
        const ssCtx = ssCanvas.getContext("2d")!;
        ssCtx.imageSmoothingEnabled = false;
        ssCtx.drawImage(img, 0, 0, ssW, ssH);
        const supersampled = ssCtx.getImageData(0, 0, ssW, ssH).data.slice();

        console.log(`[Canvas] pixel extraction: ${(performance.now() - t1).toFixed(0)}ms (${ssW}×${ssH} = ${(ssW * ssH / 1e6).toFixed(1)}Mpx)`);

        cachePixels(imageUrl, native, supersampled);
        originalPixels.current = native;
        supersampledPixels.current = supersampled;
        // Bump version — triggers the render effect with real pixels
        setPixelsVersion((v) => v + 1);
      } catch {
        // Canvas tainted by CORS — display still works, pixel ops won't.
        // The raw drawImage above already shows the design; signal completion.
        console.warn("[Canvas] Canvas tainted: pixel operations disabled (CORS)");
        if (!renderCompleteFired.current) {
          renderCompleteFired.current = true;
          onRenderComplete?.();
        }
      }
    };

    img.onerror = () => {
      console.error("[Canvas] Failed to load design image:", imageUrl);
      // Unblock the loading spinner even on error
      if (!renderCompleteFired.current) {
        renderCompleteFired.current = true;
        onRenderComplete?.();
      }
    };

    img.src = imageUrl;
  }, [imageUrl, width, height]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Re-render when colorMap or texture toggle changes ───────────────────────
  useEffect(() => {
    let cancelled = false;

    async function render() {
      const canvas = canvasRef.current;
      const pixels = originalPixels.current;
      const ssPixels = supersampledPixels.current;
      if (!canvas || !pixels) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const lookup = buildColorLookup(colorMap);

      const ss = SUPERSAMPLE_FACTOR;
      const ssW = width * ss;
      const ssH = height * ss;
      const renderW = ssPixels ? ssW : width;
      const renderH = ssPixels ? ssH : height;
      const srcPixels = ssPixels ?? pixels;

      const t0 = performance.now();
      let imageData: ImageData;

      if (textureEnabled) {
        // ── Combined single-pass: recolor + texture ──────────────────────────
        // ~2× faster than sequential applyRecolor() → textureShader.apply().
        await textureShader.load("422");
        if (cancelled) return;

        const { tileScaleX, tileScaleY } = computeTileScales(renderW, renderH, designName ?? "", tileMultiplier);
        imageData = textureShader.applyRecolorAndTexture(
          srcPixels, renderW, renderH, lookup, tileScaleX, tileScaleY, textureStrength
        );
      } else {
        // ── Flat recolor only ────────────────────────────────────────────────
        imageData = applyRecolor(srcPixels, renderW, renderH, lookup);
      }

      if (cancelled) return;

      const passMs = (performance.now() - t0).toFixed(0);
      console.log(`[Canvas] pixel pass (${textureEnabled ? "recolor+texture" : "recolor only"}, ${(renderW * renderH / 1e6).toFixed(1)}Mpx): ${passMs}ms`);

      // ── Blit supersampled buffer → display canvas ─────────────────────────
      // The bilinear downscale from 2× acts as a box-filter anti-alias.
      const t1 = performance.now();
      if (ssPixels) {
        const offscreen = new OffscreenCanvas(ssW, ssH);
        const offCtx = offscreen.getContext("2d")!;
        offCtx.putImageData(imageData, 0, 0);
        ctx.drawImage(offscreen, 0, 0, width, height);
      } else {
        ctx.putImageData(imageData, 0, 0);
      }
      console.log(`[Canvas] blit ${ssPixels ? `${ssW}×${ssH}→${width}×${height}` : `${width}×${height}`}: ${(performance.now() - t1).toFixed(0)}ms`);

      if (!cancelled && !renderCompleteFired.current) {
        renderCompleteFired.current = true;
        onRenderComplete?.();
      }
    }

    render();
    return () => { cancelled = true; };
  // pixelsVersion is the trigger that fires this effect after image load completes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorMap, width, height, textureEnabled, designName, tileMultiplier, textureStrength, pixelsVersion]);

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
