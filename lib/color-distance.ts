/**
 * Color-distance utilities for auto-colorway generation.
 *
 * Converts hex → sRGB → CIE-LAB and computes ΔE76 (Euclidean distance
 * in LAB space).  Good enough for "perceptually similar" yarn matching
 * without needing the heavier CIEDE2000 formula.
 */

// ─── Hex ↔ sRGB ─────────────────────────────────────────────────────────────

export function hexToRgbArr(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

// ─── sRGB → XYZ → LAB ──────────────────────────────────────────────────────

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** D65 white point */
const Xn = 0.95047, Yn = 1.0, Zn = 1.08883;

function f(t: number): number {
  const delta = 6 / 29;
  return t > delta ** 3
    ? Math.cbrt(t)
    : t / (3 * delta * delta) + 4 / 29;
}

export type LAB = { L: number; a: number; b: number };

export function hexToLab(hex: string): LAB {
  const [r, g, b] = hexToRgbArr(hex);
  const lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b);

  // sRGB → XYZ (D65)
  const x = 0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb;
  const y = 0.2126729 * lr + 0.7151522 * lg + 0.0721750 * lb;
  const z = 0.0193339 * lr + 0.1191920 * lg + 0.9503041 * lb;

  // XYZ → LAB
  const fx = f(x / Xn), fy = f(y / Yn), fz = f(z / Zn);
  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

/** CIE76 ΔE — Euclidean distance in LAB. */
export function deltaE(a: LAB, b: LAB): number {
  return Math.sqrt(
    (a.L - b.L) ** 2 +
    (a.a - b.a) ** 2 +
    (a.b - b.b) ** 2
  );
}

/**
 * Find the N nearest yarns to a target color by ΔE.
 * Returns them sorted closest-first.
 */
export function findNearestYarns(
  targetHex: string,
  yarns: { hex: string; [k: string]: unknown }[],
  count: number,
  /** Skip yarns whose hex matches any of these (to avoid returning the same yarn) */
  excludeHexes?: Set<string>,
): typeof yarns {
  const targetLab = hexToLab(targetHex);
  const scored = yarns
    .filter((y) => !excludeHexes?.has(y.hex))
    .map((y) => ({ yarn: y, dist: deltaE(targetLab, hexToLab(y.hex)) }))
    .sort((a, b) => a.dist - b.dist);
  return scored.slice(0, count).map((s) => s.yarn);
}
