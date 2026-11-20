"use client";

/**
 * useRecolorStudio — the reusable core of the colour tool.
 *
 * Owns the colour map (with undo/redo), per-colour locks, the version History,
 * and the generators (scheme stepper, Shuffle, Randomise) that sit on top of the
 * existing auto-colorway engine. UI components consume this hook; it holds no
 * markup, so the same brain drives the design-page studio and any future screen.
 */

import { useCallback, useMemo, useReducer, useRef, useState } from "react";
import type { PaletteEntry, YarnOption } from "@/types";
import { generateShuffle, generateSlightVariation, generateBatch } from "@/lib/auto-colorways";

export type StudioColorMap = Record<string, YarnOption | null>;

type RState = { current: StudioColorMap; past: StudioColorMap[]; future: StudioColorMap[] };
type RAction =
  | { type: "SET_ALL"; map: StudioColorMap }
  | { type: "ASSIGN"; hex: string; yarn: YarnOption }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "RESET"; map: StudioColorMap };

function reducer(s: RState, a: RAction): RState {
  switch (a.type) {
    case "ASSIGN":
      return { current: { ...s.current, [a.hex]: a.yarn }, past: [...s.past.slice(-49), s.current], future: [] };
    case "SET_ALL":
      return { current: a.map, past: [...s.past.slice(-49), s.current], future: [] };
    case "UNDO":
      if (!s.past.length) return s;
      return { current: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [s.current, ...s.future] };
    case "REDO":
      if (!s.future.length) return s;
      return { current: s.future[0], past: [...s.past, s.current], future: s.future.slice(1) };
    case "RESET":
      return { current: a.map, past: [...s.past.slice(-49), s.current], future: [] };
  }
}

export type HistoryEntry = { id: string; label: string; map: StudioColorMap; source: "edit" | "scheme" | "shuffle" | "randomise" | "auto" };

export type ColourRow = {
  hex: string;
  current: YarnOption | null;
  displayHex: string;
  percentage: number;
};

type Params = {
  palette: PaletteEntry[];
  yarns: YarnOption[];
  initialColorMap: StudioColorMap;
};

const MIN_PCT = 0.05;

export function useRecolorStudio({ palette, yarns, initialColorMap }: Params) {
  const [state, dispatch] = useReducer(
    reducer,
    { current: { ...initialColorMap }, past: [], future: [] }
  );
  const [lockedHexes, setLockedHexes] = useState<Set<string>>(() => new Set());
  const [availableOnly, setAvailableOnly] = useState(true);
  const [textureEnabled, setTextureEnabled] = useState(true);

  const colorMap = state.current;

  // Keep locked colours fixed when a generator rewrites the map.
  const withLocks = useCallback(
    (next: Record<string, YarnOption>): StudioColorMap => {
      const merged: StudioColorMap = { ...colorMap, ...next };
      for (const hex of lockedHexes) merged[hex] = colorMap[hex] ?? null;
      return merged;
    },
    [colorMap, lockedHexes]
  );

  // ── History ──────────────────────────────────────────────────────────────────
  const [history, setHistory] = useState<HistoryEntry[]>(() => [
    { id: "v0", label: "Start", map: { ...initialColorMap }, source: "edit" },
  ]);
  const [currentVersionId, setCurrentVersionId] = useState("v0");
  const vCounter = useRef(0);

  const pushHistory = useCallback((map: StudioColorMap, source: HistoryEntry["source"], label?: string) => {
    vCounter.current += 1;
    const id = `v${vCounter.current}`;
    setHistory((h) => [{ id, label: label ?? labelFor(source, vCounter.current), map: { ...map }, source }, ...h].slice(0, 40));
    setCurrentVersionId(id);
  }, []);

  // ── Commit helpers ───────────────────────────────────────────────────────────
  const applyMap = useCallback(
    (map: StudioColorMap, source: HistoryEntry["source"] = "edit", label?: string) => {
      dispatch({ type: "SET_ALL", map });
      pushHistory(map, source, label);
    },
    [pushHistory]
  );

  const assign = useCallback(
    (hex: string, yarn: YarnOption) => {
      const next = { ...colorMap, [hex]: yarn };
      dispatch({ type: "ASSIGN", hex, yarn });
      pushHistory(next, "edit");
    },
    [colorMap, pushHistory]
  );

  const toggleLock = useCallback((hex: string) => {
    setLockedHexes((prev) => {
      const n = new Set(prev);
      if (n.has(hex)) n.delete(hex); else n.add(hex);
      return n;
    });
  }, []);

  const undo = useCallback(() => dispatch({ type: "UNDO" }), []);
  const redo = useCallback(() => dispatch({ type: "REDO" }), []);
  const canUndo = state.past.length > 0;
  const canRedo = state.future.length > 0;

  const restoreVersion = useCallback(
    (id: string) => {
      const entry = history.find((h) => h.id === id);
      if (!entry) return;
      dispatch({ type: "SET_ALL", map: { ...entry.map } });
      setCurrentVersionId(id);
    },
    [history]
  );

  // ── Derived: colours used, sorted by area ────────────────────────────────────
  const coloursUsed: ColourRow[] = useMemo(
    () =>
      palette
        .filter((e) => e.percentage >= MIN_PCT)
        .slice()
        .sort((a, b) => b.percentage - a.percentage)
        .map((e) => ({
          hex: e.hex,
          current: colorMap[e.hex] ?? null,
          displayHex: colorMap[e.hex]?.hex ?? e.hex,
          percentage: e.percentage,
        })),
    [palette, colorMap]
  );

  const inUseIds = useMemo(() => {
    const s = new Set<string>();
    for (const y of Object.values(colorMap)) if (y) s.add(y.id);
    return s;
  }, [colorMap]);

  const hasAssignments = useMemo(() => coloursUsed.some((e) => e.current), [coloursUsed]);

  // ── Generators ───────────────────────────────────────────────────────────────
  const pool = useMemo(
    () => (availableOnly ? yarns.filter((y) => (y.library ?? "").length > 0) : yarns),
    [yarns, availableOnly]
  );

  const shuffle = useCallback(() => {
    const next = generateShuffle(colorMap, palette);
    if (!Object.keys(next).length) return;
    applyMap(withLocks(next), "shuffle");
  }, [colorMap, palette, withLocks, applyMap]);

  const randomise = useCallback(() => {
    // New yarns for each unlocked, assigned colour — a bolder jump than Shuffle.
    const next: Record<string, YarnOption> = {};
    for (const row of coloursUsed) {
      if (!row.current) continue;
      const pick = pool.length ? pool[Math.floor(Math.random() * pool.length)] : row.current;
      next[row.hex] = pick;
    }
    if (!Object.keys(next).length) return;
    applyMap(withLocks(next), "randomise");
  }, [coloursUsed, pool, withLocks, applyMap]);

  // Scheme stepper — a pre-generated library of full variations to flip through.
  const schemes = useMemo(
    () => generateBatch("variation", 48, initialColorMap, palette, pool, 1.0).map((g) => g.colorMap),
    // regenerate only if the design/pool identity changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [palette, pool.length]
  );
  const [schemeIndex, setSchemeIndex] = useState(-1); // -1 = original, not yet stepped

  const applyScheme = useCallback(
    (idx: number) => {
      if (!schemes.length) return;
      const wrapped = ((idx % schemes.length) + schemes.length) % schemes.length;
      setSchemeIndex(wrapped);
      applyMap(withLocks(schemes[wrapped]), "scheme", `Scheme ${wrapped + 1}`);
    },
    [schemes, withLocks, applyMap]
  );
  const schemeNext = useCallback(() => applyScheme(schemeIndex + 1), [applyScheme, schemeIndex]);
  const schemePrev = useCallback(() => applyScheme(schemeIndex - 1), [applyScheme, schemeIndex]);
  const schemeRandom = useCallback(
    () => applyScheme(Math.floor(Math.random() * Math.max(1, schemes.length))),
    [applyScheme, schemes.length]
  );

  // Four options for Auto mode (maps only; previews rendered by the caller).
  const generateFour = useCallback(
    (kind: "full" | "slight" | "family" | "shuffle"): StudioColorMap[] => {
      const mode = kind === "shuffle" ? "shuffle" : "variation";
      const spread = kind === "full" ? 1.0 : kind === "slight" ? 0.3 : 0.6;
      const batch = generateBatch(mode, 4, colorMap, palette, pool, spread);
      return batch.map((g) => withLocks(g.colorMap));
    },
    [colorMap, palette, pool, withLocks]
  );

  return {
    colorMap,
    coloursUsed,
    inUseIds,
    hasAssignments,
    lockedHexes,
    toggleLock,
    assign,
    applyMap,
    shuffle,
    randomise,
    generateFour,
    scheme: { index: schemeIndex, total: schemes.length, next: schemeNext, prev: schemePrev, random: schemeRandom, apply: applyScheme },
    history,
    currentVersionId,
    restoreVersion,
    undo,
    redo,
    canUndo,
    canRedo,
    availableOnly,
    setAvailableOnly,
    textureEnabled,
    setTextureEnabled,
  };
}

function labelFor(source: HistoryEntry["source"], n: number): string {
  switch (source) {
    case "scheme": return `Scheme`;
    case "shuffle": return `Shuffle`;
    case "randomise": return `Randomise`;
    case "auto": return `Auto`;
    default: return `v${n}`;
  }
}
