/**
 * Auto-colorway generation.
 *
 * Two modes:
 *   1. Slight Variation — each assigned yarn is replaced by a nearby one from
 *      the same library, keeping the overall mood.
 *   2. Shuffle — the same set of assigned yarns are randomly redistributed
 *      across the palette entries.
 *
 * Both modes always use yarns from the loaded yarn library (the "use available
 * colors only" constraint from Galaincha is inherent here).
 */

import type { YarnOption, PaletteEntry } from "@/types";
import { hexToLab, deltaE, hexToRgbArr } from "./color-distance";

export type GeneratedColorway = {
  id: string;               // unique identifier for this variation
  label: string;            // human-readable label ("Variation 3", "Shuffle 5")
  colorMap: Record<string, YarnOption>;  // hex → yarn mapping
  mode: "variation" | "shuffle";
};

// ─── Precomputed LAB cache ──────────────────────────────────────────────────

type YarnWithLab = YarnOption & { _lab: ReturnType<typeof hexToLab> };

function precomputeLabs(yarns: YarnOption[]): YarnWithLab[] {
  return yarns.map((y) => ({ ...y, _lab: hexToLab(y.hex) }));
}

// ─── Slight Variation ───────────────────────────────────────────────────────

/**
 * For each palette entry that has an assigned yarn, pick a nearby yarn
 * (by ΔE in LAB space).
 *
 * - `spread` controls how far from the original the substitution can go:
 *     0.0 = only the closest alternative (very subtle)
 *     1.0 = pick from the 15 nearest (can be quite different)
 *
 * - To avoid multiple entries landing on the same yarn, each chosen yarn
 *   is removed from the candidate pool for subsequent entries.
 *
 * - Yarns are only considered from the same library as the original
 *   assignment, so a "Wool_Colors" yarn won't be replaced by an "OneLoom".
 */
export function generateSlightVariation(
  currentMap: Record<string, YarnOption | null>,
  palette: PaletteEntry[],
  yarns: YarnOption[],
  spread: number = 0.5,
): Record<string, YarnOption> {
  const result: Record<string, YarnOption> = {};
  const usedYarnIds = new Set<string>();

  // Work through palette entries largest-area first so the visually dominant
  // colors get the closest available match.
  const sortedEntries = [...palette]
    .filter((e) => e.percentage >= 0.05)
    .sort((a, b) => b.percentage - a.percentage);

  // Pre-compute LAB for all yarns
  const yarnsByLibrary = new Map<string, YarnWithLab[]>();
  for (const y of precomputeLabs(yarns)) {
    const lib = y.library ?? "__default__";
    if (!yarnsByLibrary.has(lib)) yarnsByLibrary.set(lib, []);
    yarnsByLibrary.get(lib)!.push(y);
  }

  for (const entry of sortedEntries) {
    const currentYarn = currentMap[entry.hex];
    if (!currentYarn) {
      // No assignment — skip
      continue;
    }

    const lib = currentYarn.library ?? "__default__";
    const candidates = (yarnsByLibrary.get(lib) ?? []).filter(
      (y) => y.id !== currentYarn.id && !usedYarnIds.has(y.id)
    );

    if (candidates.length === 0) {
      // No alternatives — keep the original
      result[entry.hex] = currentYarn;
      usedYarnIds.add(currentYarn.id);
      continue;
    }

    // Score by ΔE from the current yarn's color
    const targetLab = hexToLab(currentYarn.hex);
    const scored = candidates
      .map((y) => ({ yarn: y, dist: deltaE(targetLab, y._lab) }))
      .sort((a, b) => a.dist - b.dist);

    // Pick from a window: spread=0 → top 1, spread=1 → top 15 (clamped to available)
    const windowSize = Math.max(1, Math.min(Math.round(1 + spread * 14), scored.length));
    const pick = scored[Math.floor(Math.random() * windowSize)].yarn;

    result[entry.hex] = pick;
    usedYarnIds.add(pick.id);
  }

  return result;
}

// ─── Shuffle ────────────────────────────────────────────────────────────────

/**
 * Keep exactly the same set of yarns, just randomly reassign which palette
 * entry gets which yarn.  The palette order and the yarn list stay the same;
 * only the mapping changes.
 *
 * Fisher–Yates shuffle on the yarn array, then zip with palette entries.
 */
export function generateShuffle(
  currentMap: Record<string, YarnOption | null>,
  palette: PaletteEntry[],
): Record<string, YarnOption> {
  // Collect entries that actually have yarn assignments
  const assignedEntries = palette
    .filter((e) => e.percentage >= 0.05 && currentMap[e.hex])
    .sort((a, b) => b.percentage - a.percentage);

  const yarns = assignedEntries.map((e) => currentMap[e.hex]!);

  // Fisher–Yates shuffle
  const shuffled = [...yarns];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // Zip back — if the shuffle is identical to the original, rotate by 1
  let isIdentical = shuffled.every((y, i) => y.id === yarns[i].id);
  if (isIdentical && shuffled.length > 1) {
    const first = shuffled.shift()!;
    shuffled.push(first);
  }

  const result: Record<string, YarnOption> = {};
  assignedEntries.forEach((entry, i) => {
    result[entry.hex] = shuffled[i];
  });

  return result;
}

// ─── One colour family (tonal) ───────────────────────────────────────────────

/** Coarse colour family key from a hex — mirrors the library panel's buckets. */
function familyKey(hex: string): string {
  const [r, g, b] = hexToRgbArr(hex);
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const mx = Math.max(rn, gn, bn), mn = Math.min(rn, gn, bn), d = mx - mn;
  const sat = mx === 0 ? 0 : d / mx;
  if (sat < 0.12) return "neutral";
  let h = 0;
  if (d !== 0) {
    if (mx === rn) h = ((gn - bn) / d) % 6;
    else if (mx === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  if (h < 20 || h >= 345) return "red";
  if (h < 45) return "orange";
  if (h < 70) return "yellow";
  if (h < 160) return "green";
  if (h < 200) return "teal";
  if (h < 255) return "blue";
  if (h < 290) return "purple";
  return "pink";
}

/**
 * One-family recolour: recast the whole rug into a single colour family, keeping
 * its light→dark structure. The dominant assigned family (by area, preferring a
 * chromatic one over neutrals) becomes the target; each entry is matched to the
 * yarn in that family whose lightness (LAB L*) is closest to the original's, so
 * contrast between areas is preserved. Returns {} if the target family has no
 * library yarns (caller should treat that as a no-op).
 */
export function generateOneFamily(
  currentMap: Record<string, YarnOption | null>,
  palette: PaletteEntry[],
  yarns: YarnOption[],
): Record<string, YarnOption> {
  const entries = palette
    .filter((e) => e.percentage >= 0.05 && currentMap[e.hex])
    .sort((a, b) => b.percentage - a.percentage);
  if (entries.length === 0) return {};

  // Dominant family among assigned yarns, weighted by area; prefer chromatic.
  const weight = new Map<string, number>();
  for (const e of entries) {
    const k = familyKey(currentMap[e.hex]!.hex);
    weight.set(k, (weight.get(k) ?? 0) + e.percentage);
  }
  let target = "";
  let best = -1;
  for (const [k, w] of weight) if (k !== "neutral" && w > best) { best = w; target = k; }
  if (!target) for (const [k, w] of weight) if (w > best) { best = w; target = k; }

  const candidates = yarns
    .filter((y) => familyKey(y.hex) === target)
    .map((y) => ({ y, L: hexToLab(y.hex).L }));
  if (candidates.length === 0) return {};

  const used = new Set<string>();
  const result: Record<string, YarnOption> = {};
  for (const e of entries) {
    const targetL = hexToLab(currentMap[e.hex]!.hex).L;
    let pick: YarnOption | null = null;
    let bestD = Infinity;
    for (const c of candidates) {
      if (used.has(c.y.id)) continue;
      const dd = Math.abs(c.L - targetL);
      if (dd < bestD) { bestD = dd; pick = c.y; }
    }
    if (!pick) {
      // Pool exhausted (more areas than family yarns) — allow reuse by nearest L.
      for (const c of candidates) {
        const dd = Math.abs(c.L - targetL);
        if (dd < bestD) { bestD = dd; pick = c.y; }
      }
    }
    if (pick) { result[e.hex] = pick; used.add(pick.id); }
  }
  return result;
}

// ─── Batch generation ───────────────────────────────────────────────────────

export function generateBatch(
  mode: "variation" | "shuffle",
  count: number,
  currentMap: Record<string, YarnOption | null>,
  palette: PaletteEntry[],
  yarns: YarnOption[],
  spread?: number,
): GeneratedColorway[] {
  const results: GeneratedColorway[] = [];
  const seenKeys = new Set<string>();

  // Allow up to 3× attempts to avoid duplicates
  const maxAttempts = count * 3;
  let attempts = 0;

  while (results.length < count && attempts < maxAttempts) {
    attempts++;
    const colorMap =
      mode === "variation"
        ? generateSlightVariation(currentMap, palette, yarns, spread ?? 0.5)
        : generateShuffle(currentMap, palette);

    // Deduplicate by sorted yarn-id string
    const key = Object.entries(colorMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([hex, y]) => `${hex}:${y.id}`)
      .join("|");

    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const label = mode === "variation"
      ? `Variation ${results.length + 1}`
      : `Shuffle ${results.length + 1}`;

    results.push({
      id: `${mode}-${Date.now()}-${results.length}`,
      label,
      colorMap,
      mode,
    });
  }

  return results;
}
