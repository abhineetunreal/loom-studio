// TextureShader — high-pass detail map overlay over recolored ImageData.
//
// The detail map (wool_28kpsi_detail1.png) is pre-baked: large-scale tonal
// variation has been removed, leaving only fine knot/fiber grain centered
// on neutral gray (128). Value 128 = no change; >128 = highlight; <128 = shadow.
// The map averages to exactly 128, so applying it never shifts overall color.
//
// Usage (browser-only):
//   await textureShader.load('422');
//   textureShader.apply(imageData, w, h, tileScaleX, tileScaleY, strength);
//   // or — single-pass recolor+texture (faster):
//   textureShader.applyRecolorAndTexture(originalPixels, w, h, lookup, tileScaleX, tileScaleY, strength);

import { rgbToInt } from "@/lib/recolor";

/** Pre-loaded pixel data for a photo-swatch yarn. */
export type PhotoSwatchData = {
  data: Uint8ClampedArray;
  w: number;
  h: number;
};

// ─── Rug dimension parsing ────────────────────────────────────────────────────

const FALLBACK_FEET = { widthFeet: 8, heightFeet: 10 };

/**
 * Parse physical rug dimensions (feet) from a design name string.
 *
 * Handles:
 *   "Ou 413 9.0X11.0"      → { widthFeet: 9.0, heightFeet: 11.0 }
 *   "Design Size_9.8 x13"  → { widthFeet: 9.8, heightFeet: 13.0 }
 *   "3635 1"               → null  (no dimensions found)
 *
 * Numbers ≥ 30 (e.g. "90 X 110") are ambiguous — could be inches or
 * tenths-of-feet. Returns null and warns so the caller uses the fallback.
 * Confirm the convention with Abhineet before handling that pattern.
 */
export function parseRugDimensions(
  name: string
): { widthFeet: number; heightFeet: number } | null {
  const match = name.match(/(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)/);
  if (!match) return null;

  const a = parseFloat(match[1]);
  const b = parseFloat(match[2]);

  if (a >= 30 || b >= 30) {
    console.warn(
      `[TextureShader] Ambiguous dimensions in "${name}" (${a} × ${b} — ` +
        `inches or tenths-of-feet?). Using ${FALLBACK_FEET.widthFeet}×${FALLBACK_FEET.heightFeet} ft fallback. ` +
        `Confirm convention with Abhineet.`
    );
    return null;
  }

  return { widthFeet: a, heightFeet: b };
}

/**
 * Compute per-axis tile scales for a design.
 *
 * The detail map is a 2 ft × 2 ft physical sample at 2048 × 2048 px.
 * tileScale = 1024 × rugFeet / designPixels
 * → one tile covers (2 / rugFeet × designPixels) design pixels.
 *
 * @param tileMultiplier  Additional scale factor on top of physical scale
 *   (>1 = texture repeats more = smaller visible knots; <1 = larger knots).
 */
export function computeTileScales(
  designPixelWidth: number,
  designPixelHeight: number,
  designName: string,
  tileMultiplier = 1
): { tileScaleX: number; tileScaleY: number } {
  const dims = parseRugDimensions(designName) ?? (() => {
    if (!/\d\s*[xX]\s*\d/.test(designName)) {
      console.warn(
        `[TextureShader] No dimensions found in "${designName}". ` +
          `Using ${FALLBACK_FEET.widthFeet}×${FALLBACK_FEET.heightFeet} ft fallback.`
      );
    }
    return FALLBACK_FEET;
  })();

  return {
    tileScaleX: (1024 * dims.widthFeet  / designPixelWidth)  * tileMultiplier,
    tileScaleY: (1024 * dims.heightFeet / designPixelHeight) * tileMultiplier,
  };
}

// ─── Supersampling ───────────────────────────────────────────────────────────

/**
 * Offscreen render multiplier. The recolor + texture pass runs at
 * (SUPERSAMPLE_FACTOR × native resolution) and is then downscaled to the
 * display canvas, so zoomed views stay crisp instead of blurry.
 * Bump to 3 if 2× is ever insufficient; the pixel loop scales as O(n²).
 */
export const SUPERSAMPLE_FACTOR = 2;

// ─── TextureShader ────────────────────────────────────────────────────────────

function loadImageData(url: string, size: number): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = new OffscreenCanvas(size, size);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, size, size);
      resolve(ctx.getImageData(0, 0, size, size));
    };
    img.onerror = () => reject(new Error(`Failed to load texture: ${url}`));
    img.src = url;
  });
}

class TextureShader {
  private detailMap: ImageData | null = null;
  private loadedCode: string | null = null;
  // In-flight promise so concurrent load() calls coalesce
  private loading: Promise<void> | null = null;

  async load(code = "422"): Promise<void> {
    if (this.loadedCode === code) return;
    if (this.loading) {
      await this.loading;
      if (this.loadedCode === code) return;
    }

    const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!base) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");

    this.loading = (async () => {
      this.detailMap = await loadImageData(
        `${base}/storage/v1/object/public/textures/${code}/wool_28kpsi_detail1.png`,
        2048
      );
      this.loadedCode = code;
    })();

    try {
      await this.loading;
    } finally {
      this.loading = null;
    }
  }

  /**
   * Modify flatData in place using the pre-centered detail map.
   *
   * Per pixel:
   *   factor = 1 + strength × ((detailValue − 128) / 128)
   *   finalColor = yarnColor × factor   (clamped 0–255)
   *
   * Because the detail map averages to 128, average brightness is unchanged —
   * the shader is a pure transparent grain overlay over the CAD colors.
   *
   * @param tileScaleX  Texture px per design px, X axis (from computeTileScales)
   * @param tileScaleY  Texture px per design px, Y axis
   * @param strength    0 = flat, 1 = full grain (default 0.6)
   */
  apply(
    flatData: ImageData,
    designWidth: number,
    designHeight: number,
    tileScaleX: number,
    tileScaleY: number,
    strength = 0.6
  ): void {
    if (!this.detailMap) return;

    const { data: dPx, width: tw, height: th } = this.detailMap;
    const pixels = flatData.data;

    for (let y = 0; y < designHeight; y++) {
      const texY = Math.floor((y * tileScaleY) % th);
      for (let x = 0; x < designWidth; x++) {
        const pi = (y * designWidth + x) * 4;
        if (pixels[pi + 3] === 0) continue;

        const texX = Math.floor((x * tileScaleX) % tw);
        const d = dPx[(texY * tw + texX) * 4]; // R channel
        const factor = 1 + strength * ((d - 128) / 128);

        pixels[pi]     = Math.min(255, Math.max(0, pixels[pi]     * factor));
        pixels[pi + 1] = Math.min(255, Math.max(0, pixels[pi + 1] * factor));
        pixels[pi + 2] = Math.min(255, Math.max(0, pixels[pi + 2] * factor));
      }
    }
  }

  /**
   * Combined recolor + texture pass — single loop over all pixels, ~2× faster
   * than calling applyRecolor() then apply() sequentially.
   *
   * Reads from `originalPixels` (never mutated), writes a new ImageData with
   * the color substitution and wool-grain factor applied in one iteration.
   *
   * Falls back to recolor-only if the detail map hasn't been loaded yet.
   *
   * Optimisations vs the naïve version:
   *   • Integer-keyed lookup (no per-pixel string allocation)
   *   • Row offset pre-computed outside the inner loop
   *   • Bitwise AND for power-of-2 texture modulo (2048 → & 2047)
   *   • `| 0` for float→int truncation instead of Math.floor
   *   • Uint8ClampedArray auto-clamps writes — no explicit Math.min/max
   *
   * @param lookup        Map from packed-int RGB → replacement {r,g,b}, from buildColorLookup()
   * @param overrideLayer Per-pixel region-fill overrides in NATIVE-resolution pixel-index
   *                      space (y * nativeWidth + x → packed RGB).  The ss pass maps each
   *                      supersampled pixel back to its native-res origin to look up the
   *                      override.  Pass undefined when there are no region fills.
   * @param nativeWidth   Native (pre-supersampled) design width.  Required when
   *                      overrideLayer is provided so the ss→native index mapping is correct.
   */
  applyRecolorAndTexture(
    originalPixels: Uint8ClampedArray,
    width: number,
    height: number,
    lookup: Map<number, { r: number; g: number; b: number }>,
    tileScaleX: number,
    tileScaleY: number,
    strength = 0.6,
    overrideLayer?: Map<number, number>,
    nativeWidth?: number,
    // Photo-swatch additions:
    photoLookup?: Map<number, PhotoSwatchData>,       // packedInt → swatch (global map)
    photoOverrideLayer?: Map<number, PhotoSwatchData>, // nativePixelIndex → swatch (region fills)
    photoTileSizeX = 90,   // tile size in NATIVE pixels, X axis
    photoTileSizeY = 90,   // tile size in NATIVE pixels, Y axis
  ): ImageData {
    const output = new ImageData(width, height);
    const out = output.data;

    // Pre-compute the native width used for override index mapping.
    // When overrideLayer is provided nativeWidth must be supplied; if somehow
    // omitted we fall back to half the ss width (valid only for SUPERSAMPLE_FACTOR=2).
    const nw = nativeWidth ?? (width >> 1);

    if (!this.detailMap) {
      // No detail map yet — recolor + photo, no shader grain
      for (let y = 0; y < height; y++) {
        const nativeRow = (y >> 1) * nw;
        const nativeY = y >> 1;
        for (let x = 0; x < width; x++) {
          const pi = (y * width + x) << 2;
          const a = originalPixels[pi + 3];
          if (a === 0) { out[pi + 3] = 0; continue; }
          const nativeX = x >> 1;
          const nativeIdx = nativeRow + nativeX;

          // Photo override — UV in native pixel space so all 4 SS pixels hit the same texel
          const photoOverride = photoOverrideLayer?.get(nativeIdx);
          if (photoOverride !== undefined) {
            const tx = Math.floor(((nativeX % photoTileSizeX) / photoTileSizeX) * photoOverride.w);
            const ty = Math.floor(((nativeY % photoTileSizeY) / photoTileSizeY) * photoOverride.h);
            const si = (ty * photoOverride.w + tx) * 4;
            out[pi] = photoOverride.data[si]; out[pi+1] = photoOverride.data[si+1];
            out[pi+2] = photoOverride.data[si+2]; out[pi+3] = a;
            continue;
          }

          // Shader override
          const override = overrideLayer?.get(nativeIdx);
          if (override !== undefined) {
            out[pi] = (override >> 16) & 0xFF; out[pi+1] = (override >> 8) & 0xFF;
            out[pi+2] = override & 0xFF; out[pi+3] = a;
            continue;
          }

          const r0 = originalPixels[pi], g0 = originalPixels[pi+1], b0 = originalPixels[pi+2];

          // Photo global map — UV in native pixel space
          const photoEntry = photoLookup?.get(rgbToInt(r0, g0, b0));
          if (photoEntry !== undefined) {
            const tx = Math.floor(((nativeX % photoTileSizeX) / photoTileSizeX) * photoEntry.w);
            const ty = Math.floor(((nativeY % photoTileSizeY) / photoTileSizeY) * photoEntry.h);
            const si = (ty * photoEntry.w + tx) * 4;
            out[pi] = photoEntry.data[si]; out[pi+1] = photoEntry.data[si+1];
            out[pi+2] = photoEntry.data[si+2]; out[pi+3] = a;
            continue;
          }

          // Shader global map (flat, no grain)
          const rep = lookup.get(rgbToInt(r0, g0, b0));
          out[pi] = rep ? rep.r : r0; out[pi+1] = rep ? rep.g : g0;
          out[pi+2] = rep ? rep.b : b0; out[pi+3] = a;
        }
      }
      return output;
    }

    const { data: dPx, width: tw, height: th } = this.detailMap;
    // Bitwise AND modulo only works for power-of-2 dimensions (2048 is 2^11)
    const twMask = tw - 1;
    const thMask = th - 1;

    for (let y = 0; y < height; y++) {
      const texY = ((y * tileScaleY) | 0) & thMask;
      const texRowOff = texY * tw;   // pre-computed row offset into detail map
      const rowOff = y * width;
      // Native-resolution row for override lookup (SUPERSAMPLE_FACTOR = 2)
      const nativeRowOff = (y >> 1) * nw;
      const nativeY = y >> 1;

      for (let x = 0; x < width; x++) {
        const pi = (rowOff + x) << 2; // * 4
        const a = originalPixels[pi + 3];
        if (a === 0) continue; // out is already zero-initialised
        const nativeX = x >> 1;
        const nativeIdx = nativeRowOff + nativeX;

        // ── Photo override layer (region fills using photo swatches) ──────────
        // UV in native pixel space so all 4 SS pixels in a 2×2 block hit the same texel → sharp
        const photoOverride = photoOverrideLayer?.get(nativeIdx);
        if (photoOverride !== undefined) {
          const tx = Math.floor(((nativeX % photoTileSizeX) / photoTileSizeX) * photoOverride.w);
          const ty = Math.floor(((nativeY % photoTileSizeY) / photoTileSizeY) * photoOverride.h);
          const si = (ty * photoOverride.w + tx) * 4;
          out[pi] = photoOverride.data[si]; out[pi+1] = photoOverride.data[si+1];
          out[pi+2] = photoOverride.data[si+2]; out[pi+3] = a;
          continue;
        }

        // ── Shader override layer (region fills with shader colors) ───────────
        const override = overrideLayer?.get(nativeIdx);

        let r: number, g: number, b: number;

        if (override !== undefined) {
          r = (override >> 16) & 0xFF;
          g = (override >> 8) & 0xFF;
          b = override & 0xFF;
        } else {
          const r0 = originalPixels[pi], g0 = originalPixels[pi+1], b0 = originalPixels[pi+2];

          // ── Photo global map — UV in native pixel space ───────────────────────
          const photoEntry = photoLookup?.get(rgbToInt(r0, g0, b0));
          if (photoEntry !== undefined) {
            const tx = Math.floor(((nativeX % photoTileSizeX) / photoTileSizeX) * photoEntry.w);
            const ty = Math.floor(((nativeY % photoTileSizeY) / photoTileSizeY) * photoEntry.h);
            const si = (ty * photoEntry.w + tx) * 4;
            out[pi] = photoEntry.data[si]; out[pi+1] = photoEntry.data[si+1];
            out[pi+2] = photoEntry.data[si+2]; out[pi+3] = a;
            continue;
          }

          // ── Shader global map ─────────────────────────────────────────────────
          const rep = lookup.get(rgbToInt(r0, g0, b0));
          r = rep ? rep.r : r0;
          g = rep ? rep.g : g0;
          b = rep ? rep.b : b0;
        }

        // ── Shader grain ──────────────────────────────────────────────────────
        const texX = ((x * tileScaleX) | 0) & twMask;
        const d = dPx[(texRowOff + texX) << 2]; // R channel of detail map
        const factor = 1 + strength * ((d - 128) / 128);

        // Uint8ClampedArray auto-clamps to 0–255 — no Math.min/max needed
        out[pi]     = r * factor;
        out[pi + 1] = g * factor;
        out[pi + 2] = b * factor;
        out[pi + 3] = a;
      }
    }

    return output;
  }
}

export const textureShader = new TextureShader();
