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

import { rgbToHex } from "@/lib/recolor";

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
   * @param lookup  Map from original hex → replacement {r,g,b}, from buildColorLookup()
   */
  applyRecolorAndTexture(
    originalPixels: Uint8ClampedArray,
    width: number,
    height: number,
    lookup: Map<string, { r: number; g: number; b: number }>,
    tileScaleX: number,
    tileScaleY: number,
    strength = 0.6
  ): ImageData {
    const output = new ImageData(width, height);
    const out = output.data;

    if (!this.detailMap) {
      // Texture not loaded — recolor only (shouldn't happen if load() was awaited first)
      for (let i = 0; i < originalPixels.length; i += 4) {
        const rep = lookup.get(rgbToHex(originalPixels[i], originalPixels[i + 1], originalPixels[i + 2]));
        out[i]     = rep ? rep.r : originalPixels[i];
        out[i + 1] = rep ? rep.g : originalPixels[i + 1];
        out[i + 2] = rep ? rep.b : originalPixels[i + 2];
        out[i + 3] = originalPixels[i + 3];
      }
      return output;
    }

    const { data: dPx, width: tw, height: th } = this.detailMap;

    for (let y = 0; y < height; y++) {
      const texY = Math.floor((y * tileScaleY) % th);
      for (let x = 0; x < width; x++) {
        const pi = (y * width + x) * 4;
        const a = originalPixels[pi + 3];
        if (a === 0) {
          out[pi + 3] = 0;
          continue;
        }

        // ── Color substitution ──
        const rep = lookup.get(rgbToHex(originalPixels[pi], originalPixels[pi + 1], originalPixels[pi + 2]));
        const r = rep ? rep.r : originalPixels[pi];
        const g = rep ? rep.g : originalPixels[pi + 1];
        const b = rep ? rep.b : originalPixels[pi + 2];

        // ── Texture grain factor ──
        const texX = Math.floor((x * tileScaleX) % tw);
        const d = dPx[(texY * tw + texX) * 4]; // R channel of detail map
        const factor = 1 + strength * ((d - 128) / 128);

        out[pi]     = Math.min(255, Math.max(0, r * factor));
        out[pi + 1] = Math.min(255, Math.max(0, g * factor));
        out[pi + 2] = Math.min(255, Math.max(0, b * factor));
        out[pi + 3] = a;
      }
    }

    return output;
  }
}

export const textureShader = new TextureShader();
