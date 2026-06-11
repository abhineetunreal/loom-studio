// Pure utility functions for the canvas recolor engine.
// No React or browser APIs here — usable in workers if needed later.

export type RGB = { r: number; g: number; b: number };

export function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

/** Pack RGB into a single integer for fast Map key comparisons. */
export function rgbToInt(r: number, g: number, b: number): number {
  return (r << 16) | (g << 8) | b;
}

/** Convert hex to HSL. H is 0–360, S and L are 0–1. */
export function hexToHsl(hex: string): [number, number, number] {
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l]; // achromatic
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h * 360, s, l];
}

/**
 * Build a fast lookup from packed-int RGB → replacement RGB.
 * Key is `rgbToInt(r, g, b)` — avoids per-pixel string allocation in the hot loop.
 * Only entries present in the colorMap (and non-null) are included.
 */
export function buildColorLookup(
  colorMap: Record<string, { hex: string } | null>
): Map<number, RGB> {
  const lookup = new Map<number, RGB>();
  for (const [originalHex, yarn] of Object.entries(colorMap)) {
    if (yarn) {
      const { r, g, b } = hexToRgb(originalHex);
      lookup.set(rgbToInt(r, g, b), hexToRgb(yarn.hex));
    }
  }
  return lookup;
}

/**
 * Apply a color lookup to produce recolored ImageData.
 *
 * `originalPixels` is the raw RGBA data from the source image — never mutated.
 * Returns a new ImageData with yarn colors substituted in.
 *
 * Uses integer-keyed Map to avoid per-pixel string allocation.
 */
export function applyRecolor(
  originalPixels: Uint8ClampedArray,
  width: number,
  height: number,
  lookup: Map<number, RGB>
): ImageData {
  const output = new ImageData(width, height);
  const data = output.data;

  for (let i = 0; i < originalPixels.length; i += 4) {
    const r = originalPixels[i];
    const g = originalPixels[i + 1];
    const b = originalPixels[i + 2];

    const replacement = lookup.get((r << 16) | (g << 8) | b);
    data[i]     = replacement ? replacement.r : r;
    data[i + 1] = replacement ? replacement.g : g;
    data[i + 2] = replacement ? replacement.b : b;
    data[i + 3] = originalPixels[i + 3];
  }

  return output;
}
