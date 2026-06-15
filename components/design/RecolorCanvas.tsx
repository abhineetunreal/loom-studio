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
 * Two recolor modes:
 *   "global"  — existing behavior; click picks a palette color for global replacement.
 *   "region"  — flood-fill paint-bucket; click runs BFS on originalPixels and stores
 *               per-pixel overrides in overrideLayerRef.  The override layer takes
 *               priority over the global colorMap in the render pipeline.
 *
 * Override layer: Map<pixelIndex, packedRGB>  (lives in a ref, survives re-renders)
 * Region undo:    stack of {pixelIndices, previousColors, newColor}  (max 20 ops)
 */

import { useEffect, useRef, useImperativeHandle, forwardRef, useState } from "react";
import { applyRecolor, buildColorLookup, rgbToHex, hexToRgb, rgbToInt } from "@/lib/recolor";
import { textureShader, computeTileScales, SUPERSAMPLE_FACTOR } from "@/lib/texture-shader";
import type { PhotoSwatchData, PhotoSwatchEntry } from "@/lib/texture-shader";
import { computePhotoTileSizes } from "@/lib/texture-scale";
import { floodFill } from "@/lib/flood-fill";
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

// Photo swatch pixel cache — keyed by textureUrl, survives component unmounts
const swatchCache = new Map<string, PhotoSwatchData>();

function cachePixels(url: string, native: Uint8ClampedArray, supersampled: Uint8ClampedArray) {
  if (pixelCache.has(url)) return; // already cached (concurrent loads)
  if (pixelCache.size >= MAX_PIXEL_CACHE) {
    const evict = pixelCacheOrder.shift()!;
    pixelCache.delete(evict);
  }
  pixelCache.set(url, { native, supersampled });
  pixelCacheOrder.push(url);
}

// ─── Region undo entry + exported delta types ─────────────────────────────────

type RegionUndoEntry = {
  pixelIndices: number[];
  previousColors: Map<number, number>; // pixelIdx → packed RGB that was there before
  previousPhotoUrls: Map<number, string>; // pixelIndex → textureUrl of previous state
  newColor: number;                    // packed RGB that was applied
  originalHex: string;                 // original design palette hex at the fill start
  yarn: YarnOption;                    // yarn used for this fill
  seedX: number;                       // native pixel x coordinate of seed point
  seedY: number;                       // native pixel y coordinate of seed point
};

const MAX_REGION_UNDO = 20;

/** Passed to onRegionFillDelta after each successful region fill. */
export type RegionFillDelta = {
  originalHex: string;
  pixelCount: number;
  previousColors: Map<number, number>; // pixelIdx → packed RGB previously there (region overrides only)
  newRgb: number;
  yarn: YarnOption;
  /** Native-resolution pixel coordinates of the flood-fill seed point. */
  seedX: number;
  seedY: number;
};

/** Passed to onRegionUndoDelta after each region fill undo. */
export type RegionUndoDelta = {
  originalHex: string;
  pixelCount: number;
  previousColors: Map<number, number>; // the state restored to (same map as in fill delta)
  removedRgb: number;
};

// ─── Component ────────────────────────────────────────────────────────────────

export type RecolorCanvasHandle = {
  /** Returns a data URL of the current recolored image, scaled to maxWidth. */
  getSnapshot: (maxWidth?: number) => string | null;
  /** Pick the palette color at the given viewport coordinates (forwarded from CanvasZone). */
  pickColorAt: (clientX: number, clientY: number) => void;
  /**
   * Returns the unique photo-swatch yarns that are currently active in the region
   * override layer.  Used by the "Save Scale" button to determine which yarns to update.
   */
  getActivePhotoYarns: () => YarnOption[];
  /**
   * Region-fill mode: run a flood fill at the given viewport coordinates and
   * paint the connected region with `fillYarnRgb`.  No-op if no fill yarn is set
   * or if the clicked pixel is outside the design bounds / transparent.
   */
  regionFillAt: (clientX: number, clientY: number) => void;
  /**
   * Replay a saved region fill using native pixel coordinates and a specific yarn.
   * Used when restoring a saved colorway.  Adds to the undo stack.
   */
  replayRegionFill: (seedX: number, seedY: number, yarn: YarnOption) => void;
  /**
   * Undo the last region-fill operation.
   * Returns true if an operation was undone, false if the stack was empty.
   */
  undoRegionFill: () => boolean;
  /** Clear all region-fill overrides and the undo stack. */
  clearRegionFills: () => void;
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
  /** Multiplicative scale on the physically-calculated photo tile size. Default 1.0. */
  swatchScale?: number;
  /** Called once the first full render (recolor + texture) is painted to the canvas. */
  onRenderComplete?: () => void;
  /** Current interaction mode. */
  mode: "global" | "region";
  /**
   * Yarn to use for region fills.  Only relevant in "region" mode.
   * Packed RGB is derived internally so the caller doesn't need to convert.
   */
  fillYarn?: YarnOption;
  /** Called after each region fill with pixel-level delta information. */
  onRegionFillDelta?: (delta: RegionFillDelta) => void;
  /** Called after each region fill undo with pixel-level delta information. */
  onRegionUndoDelta?: (delta: RegionUndoDelta) => void;
  /** Called when all region fills are cleared (reset). */
  onRegionClear?: () => void;
};

const RecolorCanvas = forwardRef<RecolorCanvasHandle, Props>(function RecolorCanvas(
  {
    imageUrl, width, height, palette, colorMap, selectedHex, onColorPick,
    textureEnabled, designName, tileMultiplier = 0.65, textureStrength = 1.5, swatchScale = 1.0,
    onRenderComplete, mode, fillYarn,
    onRegionFillDelta, onRegionUndoDelta, onRegionClear,
  },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Immutable source-of-truth pixel data at native resolution, for click-picking
  const originalPixels = useRef<Uint8ClampedArray | null>(null);
  // Same image upscaled to SUPERSAMPLE_FACTOR × native size, for the render pass
  const supersampledPixels = useRef<Uint8ClampedArray | null>(null);
  // Reused across renders — avoids GC pressure from allocating a new OffscreenCanvas each time
  const offscreenRef = useRef<OffscreenCanvas | null>(null);
  // Bumped when the image finishes loading so the render effect re-fires with real pixels.
  const [pixelsVersion, setPixelsVersion] = useState(0);
  // Set of valid palette hex values for fast lookup on click
  const paletteHexSet = useRef<Set<string>>(new Set(palette.map((e) => e.hex)));
  // Guard: only call onRenderComplete once per design load
  const renderCompleteFired = useRef(false);

  // ── Region-fill state (internal — not exposed via props) ─────────────────────
  // Override layer: per-pixel color overrides that take priority over colorMap.
  // Map<pixelIndex, packedRGB>.  Stored as a ref so mutations don't cause
  // React re-renders — instead we bump overrideVersion to trigger the effect.
  const overrideLayerRef = useRef<Map<number, number>>(new Map());
  // Maps pixelIndex → textureUrl for photo-type region fills
  const photoUrlOverrideLayerRef = useRef<Map<number, string>>(new Map());
  // Maps swatchImageUrl → YarnOption — populated on every photo region fill so we can
  // look up yarn metadata (including swatchScale) from an active photo URL.
  const photoUrlToYarnRef = useRef<Map<string, YarnOption>>(new Map());
  // Region fill undo stack — capped at MAX_REGION_UNDO entries
  const regionUndoStackRef = useRef<RegionUndoEntry[]>([]);
  // Bumped after each region fill / undo to trigger a re-render
  const [overrideVersion, setOverrideVersion] = useState(0);
  const [swatchVersion, setSwatchVersion] = useState(0);

  // ── Expose handle methods to parent ─────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    getSnapshot(maxWidth = 300) {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const scale = Math.min(1, maxWidth / canvas.width);
      const w = Math.round(canvas.width * scale);
      const h = Math.round(canvas.height * scale);
      const offscreen = document.createElement("canvas");
      offscreen.width = w;
      offscreen.height = h;
      try {
        offscreen.getContext("2d")!.drawImage(canvas, 0, 0, w, h);
        return offscreen.toDataURL("image/png");
      } catch {
        // Canvas tainted by CORS — snapshot unavailable
        return null;
      }
    },
    getActivePhotoYarns(): YarnOption[] {
      // Collect unique swatchImageUrls that are active in the region override layer
      const activeUrls = new Set(photoUrlOverrideLayerRef.current.values());
      const seen = new Set<string>();
      const result: YarnOption[] = [];
      for (const url of activeUrls) {
        if (!seen.has(url)) {
          seen.add(url);
          const yarn = photoUrlToYarnRef.current.get(url);
          if (yarn) result.push(yarn);
        }
      }
      return result;
    },
    pickColorAt(clientX: number, clientY: number) {
      pickColorAt(clientX, clientY);
    },
    regionFillAt(clientX: number, clientY: number) {
      doRegionFill(clientX, clientY);
    },
    replayRegionFill(seedX: number, seedY: number, yarn: YarnOption) {
      doRegionFillNative(seedX, seedY, yarn);
    },
    undoRegionFill(): boolean {
      const stack = regionUndoStackRef.current;
      if (stack.length === 0) return false;
      const entry = stack.pop()!;
      const layer = overrideLayerRef.current;
      // Restore previous state for each affected pixel
      for (const idx of entry.pixelIndices) {
        // Restore shader override layer
        const prev = entry.previousColors.get(idx);
        if (prev !== undefined) {
          layer.set(idx, prev);
        } else {
          layer.delete(idx);
        }
        // Restore photo URL override layer
        const prevPhoto = entry.previousPhotoUrls.get(idx);
        if (prevPhoto !== undefined) {
          photoUrlOverrideLayerRef.current.set(idx, prevPhoto);
        } else {
          photoUrlOverrideLayerRef.current.delete(idx);
        }
      }
      onRegionUndoDelta?.({
        originalHex: entry.originalHex,
        pixelCount: entry.pixelIndices.length,
        previousColors: entry.previousColors,
        removedRgb: entry.newColor,
      });
      setOverrideVersion((v) => v + 1);
      return true;
    },
    clearRegionFills() {
      overrideLayerRef.current.clear();
      photoUrlOverrideLayerRef.current.clear();
      regionUndoStackRef.current = [];
      onRegionClear?.();
      setOverrideVersion((v) => v + 1);
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

  // ── Lazy-load photo swatch images ────────────────────────────────────────────
  // Watches BOTH colorMap (global assigns) AND fillYarn (region-fill mode).
  //
  // Critical: region fills do NOT change colorMap — they write to photoUrlOverrideLayerRef
  // directly.  Without fillYarn in the deps, a photo fill yarn's swatch would never
  // be loaded, leaving the cache empty and the render permanently on the shader path.
  //
  // By watching fillYarn, the swatch pre-loads the moment the user picks a photo
  // fill yarn — before they even click — so the first fill render shows the photo.
  useEffect(() => {
    const toLoad: string[] = [];

    // Swatches for colors already assigned in the global map
    for (const yarn of Object.values(colorMap)) {
      if (yarn?.renderType === "photo" && yarn.swatchImageUrl && !swatchCache.has(yarn.swatchImageUrl)) {
        toLoad.push(yarn.swatchImageUrl);
      }
    }

    // Pre-load the active region-fill yarn's swatch so it's ready before the user clicks
    if (fillYarn?.renderType === "photo" && fillYarn.swatchImageUrl && !swatchCache.has(fillYarn.swatchImageUrl)) {
      if (!toLoad.includes(fillYarn.swatchImageUrl)) {
        toLoad.push(fillYarn.swatchImageUrl);
      }
    }

    if (toLoad.length === 0) return;

    let cancelled = false;
    (async () => {
      await Promise.all(toLoad.map(async (url) => {
        if (swatchCache.has(url)) return;
        try {
          const img = new Image();
          img.crossOrigin = "anonymous";
          await new Promise<void>((res, rej) => {
            img.onload = () => res();
            img.onerror = () => rej(new Error(`Failed to load swatch: ${url}`));
            img.src = url;
          });
          if (cancelled) return;
          const w = img.naturalWidth || 256;
          const h = img.naturalHeight || 256;
          const oc = new OffscreenCanvas(w, h);
          const ctx = oc.getContext("2d")!;
          ctx.drawImage(img, 0, 0);
          const d = ctx.getImageData(0, 0, w, h);
          swatchCache.set(url, { data: d.data.slice() as Uint8ClampedArray, w, h });
          console.log(`[Canvas] swatch loaded: ${url.split("/").pop()} (${w}×${h})`);
        } catch (err) {
          console.warn("[Canvas] Failed to load swatch:", err);
        }
      }));
      // Bump swatchVersion even if some loads failed — re-render will pick up
      // whatever did load.  Failed swatches fall back to flat yarn.hex color.
      if (!cancelled) setSwatchVersion((v) => v + 1);
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorMap, fillYarn]); // fillYarn dep is critical for region-fill photo swatches

  // ── Re-render when colorMap, override layer, or texture toggle changes ───────
  //
  // Two-phase render for instant perceived feedback:
  //
  //   Phase 1 — flat recolor at native resolution (~5–15 ms).
  //             Paints to the canvas immediately so the user sees the new
  //             colors without waiting for the texture pass.
  //
  //   Phase 2 — textured render at 2× supersampled resolution.
  //             Queued via requestAnimationFrame so the browser first composites
  //             phase 1, then runs the heavier pixel loop without blocking the UI.
  //
  // Performance notes:
  //   • lookup uses integer keys (r<<16|g<<8|b) — no per-pixel string allocation
  //   • OffscreenCanvas is reused across renders (offscreenRef)
  //   • Row offsets pre-computed; bitwise ops replace Math.floor / %
  //   • overrideVersion dep ensures region fills re-render without stale closure
  useEffect(() => {
    let cancelled = false;

    async function render() {
      const canvas = canvasRef.current;
      const pixels = originalPixels.current;
      const ssPixels = supersampledPixels.current;
      if (!canvas || !pixels) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // ── DPR-aware canvas sizing ───────────────────────────────────────────────
      // Set the canvas pixel buffer to match its CSS display size × devicePixelRatio.
      // This eliminates the browser's bilinear upscale of the canvas element, which
      // was the primary cause of perceived blurriness in photo-swatch areas.
      const rect = canvas.getBoundingClientRect();
      const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
      const canvasW = rect.width > 0 ? Math.round(rect.width * dpr) : width;
      const canvasH = rect.height > 0 ? Math.round(rect.height * dpr) : height;
      // Only resize when dimensions actually change — resizing clears the canvas buffer.
      if (canvas.width !== canvasW) canvas.width = canvasW;
      if (canvas.height !== canvasH) canvas.height = canvasH;

      const lookup = buildColorLookup(colorMap);
      const overrideLayer = overrideLayerRef.current;
      const hasOverrides = overrideLayer.size > 0;

      // Quick check for photo colors without building the full maps yet
      const hasPhotoColors =
        Object.values(colorMap).some((y) => y?.renderType === "photo" && y?.swatchImageUrl) ||
        photoUrlOverrideLayerRef.current.size > 0;

      // ── Phase 1: flat recolor at native resolution — fast path ─────────────
      const t0 = performance.now();
      const flatData = applyRecolor(
        pixels, width, height, lookup,
        hasOverrides ? overrideLayer : undefined,
      );
      // DPR canvas: putImageData writes at native size; scale up to fill the DPR buffer.
      const flatOffscreen = new OffscreenCanvas(width, height);
      flatOffscreen.getContext("2d")!.putImageData(flatData, 0, 0);
      ctx.drawImage(flatOffscreen, 0, 0, canvasW, canvasH);
      console.log(`[Canvas] phase 1 flat (${width}×${height}→${canvasW}×${canvasH}): ${(performance.now() - t0).toFixed(0)}ms`);

      if (!cancelled && !renderCompleteFired.current) {
        renderCompleteFired.current = true;
        onRenderComplete?.();
      }

      // Run texture pass if shader texturing is on OR if any photo colors are in use
      // (photo colors always show their photograph, even when textureEnabled=false)
      if ((!textureEnabled && !hasPhotoColors) || !ssPixels || cancelled) return;

      // ── Yield to browser so phase 1 is composited before phase 2 blocks ────
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (cancelled) return;

      // ── Phase 2: textured render at supersampled resolution ─────────────────
      const ss = SUPERSAMPLE_FACTOR;
      const ssW = width * ss;
      const ssH = height * ss;

      await textureShader.load("422");
      if (cancelled) return;

      const { tileScaleX, tileScaleY } = computeTileScales(ssW, ssH, designName ?? "", tileMultiplier);

      // knotSizeMultiplier (tileMultiplier) excluded — it affects only the shader detail map.
      // Photo tile size = physical size × per-yarn calibrated scale (or global slider if uncalibrated).
      const { tileSizeX: basePhotoTileX, tileSizeY: basePhotoTileY } = computePhotoTileSizes(
        width, height, designName ?? "", 1.0
      );

      // ── Build photo lookup from color map — per-yarn calibrated tile sizes ──
      const photoLookup = new Map<number, PhotoSwatchEntry>();
      for (const [hex, yarn] of Object.entries(colorMap)) {
        if (yarn?.renderType === "photo" && yarn.swatchImageUrl) {
          const swatch = swatchCache.get(yarn.swatchImageUrl);
          if (swatch) {
            // Use yarn's saved swatchScale if calibrated; fall back to global slider
            const effectiveScale = yarn.swatchScale !== 1.0 ? yarn.swatchScale : swatchScale;
            const { r, g, b } = hexToRgb(hex);
            photoLookup.set(rgbToInt(r, g, b), {
              ...swatch,
              tileSizeX: basePhotoTileX * effectiveScale * SUPERSAMPLE_FACTOR,
              tileSizeY: basePhotoTileY * effectiveScale * SUPERSAMPLE_FACTOR,
            });
          }
        }
      }

      // ── Build photo override layer — per-yarn calibrated tile sizes ─────────
      const photoSwatchLayer = new Map<number, PhotoSwatchEntry>();
      for (const [idx, url] of photoUrlOverrideLayerRef.current) {
        const swatch = swatchCache.get(url);
        if (swatch) {
          const yarn = photoUrlToYarnRef.current.get(url);
          const effectiveScale = yarn && yarn.swatchScale !== 1.0 ? yarn.swatchScale : swatchScale;
          photoSwatchLayer.set(Number(idx), {
            ...swatch,
            tileSizeX: basePhotoTileX * effectiveScale * SUPERSAMPLE_FACTOR,
            tileSizeY: basePhotoTileY * effectiveScale * SUPERSAMPLE_FACTOR,
          });
        }
      }

      const t1 = performance.now();
      const texturedData = textureShader.applyRecolorAndTexture(
        ssPixels, ssW, ssH, lookup, tileScaleX, tileScaleY,
        textureEnabled ? textureStrength : 0, // strength=0 → flat shader colors in photo-only mode
        hasOverrides ? overrideLayer : undefined,
        width, // native width (nativeWidth param)
        photoLookup.size > 0 ? photoLookup : undefined,
        photoSwatchLayer.size > 0 ? photoSwatchLayer : undefined,
      );
      if (cancelled) return;
      console.log(`[Canvas] phase 2 textured (${ssW}×${ssH}→${canvasW}×${canvasH}): ${(performance.now() - t1).toFixed(0)}ms`);

      // Reuse OffscreenCanvas — allocate only when SS size changes
      if (!offscreenRef.current || offscreenRef.current.width !== ssW || offscreenRef.current.height !== ssH) {
        offscreenRef.current = new OffscreenCanvas(ssW, ssH);
      }
      const offCtx = offscreenRef.current.getContext("2d")!;
      offCtx.putImageData(texturedData, 0, 0);
      // Draw SS render to DPR canvas — browser scales from SS to DPR dimensions in one pass,
      // avoiding the previous double-scaling (SS→native→display) that blurred photo areas.
      ctx.drawImage(offscreenRef.current, 0, 0, canvasW, canvasH);
    }

    render();
    return () => { cancelled = true; };
  // pixelsVersion triggers this effect after image load; overrideVersion after region fills; swatchVersion after photo swatch loads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorMap, width, height, textureEnabled, designName, tileMultiplier, textureStrength, swatchScale, pixelsVersion, overrideVersion, swatchVersion]);

  // ── Click/touch: pick color from original pixel data ────────────────────────
  function pickColorAt(clientX: number, clientY: number) {
    const canvas = canvasRef.current;
    const pixels = originalPixels.current;
    if (!canvas || !pixels) return;

    // Map CSS coordinates → native design pixel coordinates.
    // Use design dimensions (not canvas.width) since the canvas buffer is now DPR-sized.
    const rect = canvas.getBoundingClientRect();
    const scaleX = width / rect.width;
    const scaleY = height / rect.height;
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

  // ── Region fill ──────────────────────────────────────────────────────────────

  /** Core flood-fill logic operating on native pixel coordinates. */
  function doRegionFillNative(x: number, y: number, yarn: YarnOption) {
    const pixels = originalPixels.current;
    if (!pixels) return;

    if (x < 0 || y < 0 || x >= width || y >= height) return;

    // Derive packed RGB from the fill yarn's hex color
    const { r: fr, g: fg, b: fb } = hexToRgb(yarn.hex);
    const fillYarnRgb = rgbToInt(fr, fg, fb);

    // Capture the original palette hex at the start pixel
    const si = (y * width + x) * 4;
    if (pixels[si + 3] === 0) return; // transparent — ignore
    const originalHex = rgbToHex(pixels[si], pixels[si + 1], pixels[si + 2]);

    const t0 = performance.now();
    const indices = floodFill(pixels, x, y, width, height);
    console.log(`[Canvas] flood fill: ${indices.length} pixels in ${(performance.now() - t0).toFixed(0)}ms`);
    if (indices.length === 0) return;

    const isPhotoFill = yarn.renderType === "photo" && !!yarn.swatchImageUrl;

    // Capture current state of affected pixels for undo
    const layer = overrideLayerRef.current;
    const photoLayer = photoUrlOverrideLayerRef.current;
    const previousColors = new Map<number, number>();
    const previousPhotoUrls = new Map<number, string>();
    for (const idx of indices) {
      const prev = layer.get(idx);
      if (prev !== undefined) previousColors.set(idx, prev);
      const prevPhoto = photoLayer.get(idx);
      if (prevPhoto !== undefined) previousPhotoUrls.set(idx, prevPhoto);
    }

    // Apply override
    for (const idx of indices) {
      layer.set(idx, fillYarnRgb);
      if (isPhotoFill) {
        photoLayer.set(idx, yarn.swatchImageUrl!);
      } else {
        // Shader fill clears any previous photo override for these pixels
        photoLayer.delete(idx);
      }
    }

    // Track URL → yarn so getActivePhotoYarns() can return full yarn objects
    if (isPhotoFill) {
      photoUrlToYarnRef.current.set(yarn.swatchImageUrl!, yarn);
    }

    // Push to undo stack (FIFO eviction at max size)
    const stack = regionUndoStackRef.current;
    stack.push({ pixelIndices: indices, previousColors, previousPhotoUrls, newColor: fillYarnRgb, originalHex, yarn, seedX: x, seedY: y });
    if (stack.length > MAX_REGION_UNDO) stack.shift();

    onRegionFillDelta?.({
      originalHex,
      pixelCount: indices.length,
      previousColors,
      newRgb: fillYarnRgb,
      yarn,
      seedX: x,
      seedY: y,
    });

    setOverrideVersion((v) => v + 1);
  }

  function doRegionFill(clientX: number, clientY: number) {
    const canvas = canvasRef.current;
    if (!canvas || !fillYarn) return;

    // Map CSS coordinates → native pixel coordinates
    const rect = canvas.getBoundingClientRect();
    const scaleX = width / rect.width;
    const scaleY = height / rect.height;
    const x = Math.floor((clientX - rect.left) * scaleX);
    const y = Math.floor((clientY - rect.top) * scaleY);

    doRegionFillNative(x, y, fillYarn);
  }

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    // Handled by CanvasZone pointer overlay; this fires only when the canvas
    // itself receives a click (e.g. from a direct programmatic dispatch).
    if (mode === "region") {
      doRegionFill(e.clientX, e.clientY);
    } else {
      pickColorAt(e.clientX, e.clientY);
    }
  }

  function handleTouchEnd(e: React.TouchEvent<HTMLCanvasElement>) {
    const touch = e.changedTouches[0];
    if (!touch) return;
    if (mode === "region") {
      doRegionFill(touch.clientX, touch.clientY);
    } else {
      pickColorAt(touch.clientX, touch.clientY);
    }
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
    </div>
  );
});

export default RecolorCanvas;
