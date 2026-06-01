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
 * Build a fast lookup from originalHex → replacement RGB.
 * Only entries present in the colorMap (and non-null) are included.
 */
export function buildColorLookup(
  colorMap: Record<string, { hex: string } | null>
): Map<string, RGB> {
  const lookup = new Map<string, RGB>();
  for (const [originalHex, yarn] of Object.entries(colorMap)) {
    if (yarn) lookup.set(originalHex, hexToRgb(yarn.hex));
  }
  return lookup;
}

/**
 * Apply a color lookup to produce recolored ImageData.
 *
 * `originalPixels` is the raw RGBA data from the source image — never mutated.
 * Returns a new ImageData with yarn colors substituted in.
 *
 * V2 extension point: after this function returns baseImageData, a texture
 * multiply pass (multiplyNormalMap) can be applied before ctx.putImageData.
 * See DesignViewer → renderFrame for the render pipeline.
 */
export function applyRecolor(
  originalPixels: Uint8ClampedArray,
  width: number,
  height: number,
  lookup: Map<string, RGB>
): ImageData {
  const output = new ImageData(width, height);
  const data = output.data;

  for (let i = 0; i < originalPixels.length; i += 4) {
    const r = originalPixels[i];
    const g = originalPixels[i + 1];
    const b = originalPixels[i + 2];
    const a = originalPixels[i + 3];

    const replacement = lookup.get(rgbToHex(r, g, b));
    data[i]     = replacement ? replacement.r : r;
    data[i + 1] = replacement ? replacement.g : g;
    data[i + 2] = replacement ? replacement.b : b;
    data[i + 3] = a;
  }

  return output;
}
