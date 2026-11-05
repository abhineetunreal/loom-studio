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
import { hexToLab, deltaE } from "./color-distance";

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
