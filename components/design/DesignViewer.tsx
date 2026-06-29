"use client";

import { useReducer, useState, useRef, useCallback, useEffect } from "react";
import type { RecolorCanvasHandle } from "./RecolorCanvas";
import { type RegionFillDelta, type RegionUndoDelta } from "./RecolorCanvas";
import CanvasZone from "./CanvasZone";
import CompactPalette from "./CompactPalette";
import InlineYarnPicker from "./InlineYarnPicker";
import ColorPopover from "./ColorPopover";
import YarnPicker from "./YarnPicker";
import SubmissionForm from "./SubmissionForm";
import SaveModal from "./SaveModal";
import type { DesignDetail, PaletteEntry, TierInfo, YarnOption } from "@/types";

// ─── Operations JSON types ────────────────────────────────────────────────────

export type RegionFillOperation = {
  seedX: number;
  seedY: number;
  originalColor: string;
  newHex: string;
  newYarnCode: string;
  newYarnId: string;
};

export type ColorwayOperations = {
  globalMap: Record<string, { hex: string; yarnCode: string; yarnId: string }>;
  regionFills: RegionFillOperation[];
};

// ─── Recolor state + reducer ──────────────────────────────────────────────────

type ColorMap = Record<string, YarnOption | null>;

type RecolorState = {
  current: ColorMap;
  past: ColorMap[];    // previous states, most recent last — for undo
  future: ColorMap[];  // states after current, most recent first — for redo
};

type RecolorAction =
  | { type: "ASSIGN"; hex: string; yarn: YarnOption }
  | { type: "REVERT"; hex: string; yarn: YarnOption | null } // yarn=null → remove assignment
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "RESET" };

function recolorReducer(state: RecolorState, action: RecolorAction): RecolorState {
  switch (action.type) {
    case "ASSIGN":
      return {
        current: { ...state.current, [action.hex]: action.yarn },
        past: [...state.past.slice(-49), state.current],
        future: [],
      };
    case "UNDO":
      if (!state.past.length) return state;
      return {
        current: state.past[state.past.length - 1],
        past: state.past.slice(0, -1),
        future: [state.current, ...state.future],
      };
    case "REDO":
      if (!state.future.length) return state;
      return {
        current: state.future[0],
        past: [...state.past, state.current],
        future: state.future.slice(1),
      };
    case "REVERT": {
      const next = { ...state.current };
      if (action.yarn !== null) {
        next[action.hex] = action.yarn;
      } else {
        delete next[action.hex];
      }
      return {
        current: next,
        past: [...state.past.slice(-49), state.current],
        future: [],
      };
    }
    case "RESET":
      if (!Object.keys(state.current).length) return state;
      return {
        current: {},
        past: [...state.past.slice(-49), state.current],
        future: [],
      };
  }
}

const initialRecolorState: RecolorState = { current: {}, past: [], future: [] };

// ─── Component ────────────────────────────────────────────────────────────────

type Props = {
  design: DesignDetail;
  yarns: YarnOption[];
  /** Pre-matched yarns from the rendered-color lookup; pre-populates the color map on load. */
  initialColorMap?: Record<string, YarnOption>;
  /**
   * Previously saved colorway for this user+design, restored from SavedColorway.
   * When provided it is used as the initial recolor state (takes precedence over
   * initialColorMap) and a brief "Restored your saved colorway" toast is shown.
   */
  savedColorMap?: Record<string, YarnOption>;
  /**
   * Full operations from a specific saved colorway (globalMap + regionFills).
   * When provided, region fills are replayed onto the canvas after it first renders.
   */
  savedOperations?: ColorwayOperations;
  /** True when this design was uploaded by a user (not seeded from catalog). */
  isUserUpload: boolean;
  tierInfo: TierInfo;
  /** Display name for the yarn library — derived from the tenant's displayName/name. */
  yarnLibraryName: string;
  /** Brand logo URL for PDF order sheets. */
  brandLogoUrl?: string;
  /** Full URL to the product page on the brand's website, if available. */
  viewProductUrl?: string;
};

// State for the floating popover shown on canvas click (before the full picker opens)
type CanvasPickState = {
  hex: string;
  clientX: number;
  clientY: number;
} | null;

export default function DesignViewer({
  design,
  yarns,
  initialColorMap,
  savedColorMap,
  savedOperations,
  isUserUpload,
  tierInfo,
  yarnLibraryName,
  brandLogoUrl,
  viewProductUrl,
}: Props) {
  // Saved colorway takes precedence over the lookup-matched initial map.
  // For user uploads, initialColorMap is typically empty anyway.
  const startingColorMap = savedColorMap ?? initialColorMap ?? {};

  const [recolor, dispatch] = useReducer(
    recolorReducer,
    startingColorMap,
    (initial): RecolorState => ({ current: initial as ColorMap, past: [], future: [] })
  );
  // Set when YarnPicker should be open (from palette row click OR popover "choose yarn")
  const [selectedHex, setSelectedHex] = useState<string | null>(null);
  // Set when the floating popover should be shown (canvas click, before picker opens)
  const [canvasPick, setCanvasPick] = useState<CanvasPickState>(null);
  const [showSubmissionForm, setShowSubmissionForm] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [textureEnabled, setTextureEnabled] = useState(true);
  // Toast: shown briefly when a saved colorway was restored on page load
  const [showRestoredToast, setShowRestoredToast] = useState(false);
  // Toast: shown briefly after a successful save
  const [showSavedToast, setShowSavedToast] = useState(false);
  // True once the canvas has rendered for the first time — gates region-fill replay
  const [canvasReady, setCanvasReady] = useState(false);
  // True while a saved colorway with region fills is being restored — keeps canvas covered
  // until all fills have been applied so the user never sees the intermediate state.
  const [colorwayLoading, setColorwayLoading] = useState(
    !!(savedOperations?.regionFills.length)
  );
  const canvasRef = useRef<RecolorCanvasHandle | null>(null);

  // ── Recolor mode ─────────────────────────────────────────────────────────────
  // "global"  — existing behavior: yarn assignment replaces a color everywhere.
  // "region"  — flood-fill paint bucket: yarn pick sets the fill color,
  //             canvas click paints the connected region only.
  const [recolorMode, setRecolorMode] = useState<"global" | "region">("global");
  // Yarn selected as the active region-fill color (region mode only)
  const [selectedFillYarn, setSelectedFillYarn] = useState<YarnOption | null>(null);

  // Palette sorted by coverage — used to derive 1-based rank for the popover
  const sortedPalette = [...design.palette].sort((a, b) => b.percentage - a.percentage);

  // ── Region-fill palette sync ─────────────────────────────────────────────────
  // Running counts that let us rebuild the effective palette incrementally
  // without scanning all pixels.  Updated by delta callbacks from RecolorCanvas.
  //
  //   overrideOriginalCount: originalHex → # of those pixels currently overridden
  //   overrideDisplayCount:  packedRgb   → net # of pixels currently showing that color via override
  //   overrideYarnByRgb:     packedRgb   → YarnOption used (for code display)
  const overrideOriginalCountRef = useRef<Map<string, number>>(new Map());
  const overrideDisplayCountRef  = useRef<Map<number, number>>(new Map());
  const overrideYarnByRgbRef     = useRef<Map<number, YarnOption>>(new Map());

  // ── Region-fill history for operations JSON ──────────────────────────────────
  // Ordered list of region fill operations applied so far.  Mirrors the undo stack
  // in RecolorCanvas (push on fill, pop on undo, clear on reset).
  const regionFillHistoryRef = useRef<RegionFillOperation[]>([]);

  // The palette list shown in CompactPalette — rebuilt after every region fill delta
  const [effectivePalette, setEffectivePalette] = useState(design.palette);

  const totalPixels = design.palette.reduce((s, e) => s + e.pixelCount, 0);

  /** Convert a packed 24-bit RGB int to "#rrggbb". */
  function packedToHex(packed: number): string {
    const r = (packed >> 16) & 0xFF;
    const g = (packed >> 8)  & 0xFF;
    const b =  packed        & 0xFF;
    return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
  }

  /** Rebuild effectivePalette from current recolor.current + override refs. */
  function rebuildEffectivePalette() {
    const overrideOriginalCount = overrideOriginalCountRef.current;
    const overrideDisplayCount  = overrideDisplayCountRef.current;
    const overrideYarnByRgb     = overrideYarnByRgbRef.current;

    const entries: PaletteEntry[] = [];

    // 1. Original palette entries — adjusted for region overrides
    for (const entry of design.palette) {
      const overridden = overrideOriginalCount.get(entry.hex) ?? 0;
      const visible = Math.max(0, entry.pixelCount - overridden);
      if (visible === 0) continue;
      entries.push({
        ...entry,
        pixelCount: visible,
        percentage: totalPixels > 0 ? (visible / totalPixels) * 100 : 0,
      });
    }

    // 2. Region-fill-only colors (not present in original design palette)
    const originalHexSet = new Set(design.palette.map((e) => e.hex));
    for (const [packedRgb, count] of overrideDisplayCount) {
      if (count <= 0) continue;
      const displayHex = packedToHex(packedRgb);
      if (originalHexSet.has(displayHex)) continue; // merged into original entry via adjusted count
      const yarn = overrideYarnByRgb.get(packedRgb);
      entries.push({
        index: -1,
        hex: displayHex,
        pixelCount: count,
        percentage: totalPixels > 0 ? (count / totalPixels) * 100 : 0,
        matchedYarnCode: yarn?.code,
      });
    }

    entries.sort((a, b) => b.percentage - a.percentage);
    setEffectivePalette(entries);
  }

  /** Handle a region fill delta: update running counts and rebuild palette. */
  const handleRegionFillDelta = useCallback((delta: RegionFillDelta) => {
    const overrideOriginalCount = overrideOriginalCountRef.current;
    const overrideDisplayCount  = overrideDisplayCountRef.current;
    const overrideYarnByRgbMap  = overrideYarnByRgbRef.current;

    // Pixels newly taken from the original (not previously overridden)
    const newlyOverridden = delta.pixelCount - delta.previousColors.size;
    overrideOriginalCount.set(
      delta.originalHex,
      (overrideOriginalCount.get(delta.originalHex) ?? 0) + newlyOverridden
    );

    // Previous overrides being replaced: subtract their old display contribution
    for (const prevRgb of delta.previousColors.values()) {
      overrideDisplayCount.set(prevRgb, (overrideDisplayCount.get(prevRgb) ?? 0) - 1);
    }

    // All affected pixels now display newRgb
    overrideDisplayCount.set(delta.newRgb, (overrideDisplayCount.get(delta.newRgb) ?? 0) + delta.pixelCount);
    overrideYarnByRgbMap.set(delta.newRgb, delta.yarn);

    // Track operation for operations JSON
    regionFillHistoryRef.current.push({
      seedX: delta.seedX,
      seedY: delta.seedY,
      originalColor: delta.originalHex,
      newHex: delta.yarn.hex,
      newYarnCode: delta.yarn.code,
      newYarnId: delta.yarn.id,
    });

    rebuildEffectivePalette();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Handle a region fill undo delta: reverse the running counts and rebuild. */
  const handleRegionUndoDelta = useCallback((delta: RegionUndoDelta) => {
    const overrideOriginalCount = overrideOriginalCountRef.current;
    const overrideDisplayCount  = overrideDisplayCountRef.current;

    // Remove the undone color's contribution
    overrideDisplayCount.set(delta.removedRgb, (overrideDisplayCount.get(delta.removedRgb) ?? 0) - delta.pixelCount);

    // Pixels restored to original (those not in previousColors)
    const restoredToOriginal = delta.pixelCount - delta.previousColors.size;
    overrideOriginalCount.set(
      delta.originalHex,
      Math.max(0, (overrideOriginalCount.get(delta.originalHex) ?? 0) - restoredToOriginal)
    );

    // Pixels restored to their previous override color
    for (const prevRgb of delta.previousColors.values()) {
      overrideDisplayCount.set(prevRgb, (overrideDisplayCount.get(prevRgb) ?? 0) + 1);
    }

    // Pop the last operation from history
    regionFillHistoryRef.current.pop();

    rebuildEffectivePalette();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Clear all override tracking and reset effective palette to design.palette. */
  const handleRegionClear = useCallback(() => {
    overrideOriginalCountRef.current.clear();
    overrideDisplayCountRef.current.clear();
    overrideYarnByRgbRef.current.clear();
    regionFillHistoryRef.current = [];
    setEffectivePalette(design.palette);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design.palette]);

  // ── Keyboard shortcuts ───────────────────────────────────────────────────────
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        // Try region-fill undo first; fall back to global colorMap undo if the
        // region stack is empty (most-recently-applied operation undoes first).
        if (!canvasRef.current?.undoRegionFill()) {
          dispatch({ type: "UNDO" });
        }
      }
      if (e.key === "y" || (e.key === "z" && e.shiftKey)) {
        e.preventDefault();
        dispatch({ type: "REDO" });
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // ── Restored-colorway toast ──────────────────────────────────────────────────
  // Shown once on mount if a previously saved colorway was found and applied.
  const hasSavedState = !!(
    (savedColorMap && Object.keys(savedColorMap).length > 0) ||
    (savedOperations && (
      Object.keys(savedOperations.globalMap).length > 0 ||
      savedOperations.regionFills.length > 0
    ))
  );
  useEffect(() => {
    if (!hasSavedState) return;
    setShowRestoredToast(true);
    const t = setTimeout(() => setShowRestoredToast(false), 3500);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally only on mount

  // ── Replay saved region fills after canvas first renders ─────────────────────
  // Region fills need the pixel data to be loaded before they can be applied.
  // We wait for `canvasReady` (set by the onRenderComplete callback) then replay.
  // colorwayLoading keeps the canvas covered until this effect completes.
  useEffect(() => {
    if (!canvasReady) return;
    if (savedOperations?.regionFills.length) {
      const yarnById = new Map(yarns.map((y) => [y.id, y]));
      for (const fill of savedOperations.regionFills) {
        const yarn = yarnById.get(fill.newYarnId);
        if (yarn) canvasRef.current?.replayRegionFill(fill.seedX, fill.seedY, yarn);
      }
    }
    // Reveal the canvas only after all fills are applied
    setColorwayLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasReady]); // only fires once when canvas becomes ready

  // ── Build current operations JSON ─────────────────────────────────────────────
  const buildOperations = useCallback((): ColorwayOperations => {
    const globalMap: ColorwayOperations["globalMap"] = {};
    for (const [hex, yarn] of Object.entries(recolor.current)) {
      if (!yarn) continue;
      globalMap[hex] = { hex: yarn.hex, yarnCode: yarn.code, yarnId: yarn.id };
    }
    return { globalMap, regionFills: [...regionFillHistoryRef.current] };
  }, [recolor]);

  // ── Load a saved colorway ─────────────────────────────────────────────────────
  // Apply globalMap to recolor state and replay region fills on the canvas.
  const loadColorway = useCallback(async (ops: ColorwayOperations, yarns: YarnOption[]) => {
    const yarnById = new Map(yarns.map((y) => [y.id, y]));

    // Apply global map
    const newColorMap: Record<string, YarnOption | null> = {};
    for (const [hex, entry] of Object.entries(ops.globalMap)) {
      const yarn = yarnById.get(entry.yarnId);
      if (yarn) newColorMap[hex] = yarn;
    }
    // Reset to the loaded global map via RESET then individual ASSIGNs
    dispatch({ type: "RESET" });
    for (const [hex, yarn] of Object.entries(newColorMap)) {
      if (yarn) dispatch({ type: "ASSIGN", hex, yarn });
    }

    // Clear existing region fills then replay
    canvasRef.current?.clearRegionFills();
    for (const fill of ops.regionFills) {
      const yarn = yarnById.get(fill.newYarnId);
      if (!yarn) continue;
      canvasRef.current?.replayRegionFill(fill.seedX, fill.seedY, yarn);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Save handler (called from SaveModal) ──────────────────────────────────────
  // Captures snapshot from the CURRENT recolored canvas, POSTs to the API.
  // On success: closes the modal and shows a brief "Saved" toast.
  // Does NOT reset recolor state or navigate — the user continues editing.
  const handleSaveSubmit = useCallback(async (name: string, folderId: string | null) => {
    // Capture snapshot of the current recolored canvas (not the original)
    const snapshot = canvasRef.current?.getSnapshot() ?? null;
    const operations = buildOperations();

    const res = await fetch("/api/colorways", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        designId: design.id,
        name,
        operations,
        folderId,
        snapshotDataUrl: snapshot,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error ?? "Save failed");
    }
    // Show success toast — modal will close itself after this resolves
    setShowSavedToast(true);
    setTimeout(() => setShowSavedToast(false), 2500);
  }, [design.id, buildOperations]);

  // ── Order sheet download (client-side PDF) ──────────────────────────────────
  const [orderSheetBusy, setOrderSheetBusy] = useState(false);

  const handleDownloadOrderSheet = useCallback(async () => {
    setOrderSheetBusy(true);
    // Yield to let the UI update before heavy work
    await new Promise((r) => setTimeout(r, 50));

    try {
      const { default: jsPDF } = await import("jspdf");

      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pw = doc.internal.pageSize.getWidth();
      const margin = 15;
      const contentW = pw - margin * 2;
      let y = margin;

      // ── Header: logo + brand name ──
      const drawTextHeader = () => {
        doc.setFontSize(16);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(26, 22, 18);
        doc.text(yarnLibraryName, margin, y + 6);
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(136, 136, 136);
        doc.text("Order Sheet", margin, y + 11);
        y += 15;
      };

      if (brandLogoUrl) {
        try {
          const logoImg = await loadImageAsDataUrl(brandLogoUrl);
          if (logoImg) {
            doc.addImage(logoImg, "JPEG", margin, y, 20, 20);
            doc.setFontSize(16);
            doc.setFont("helvetica", "bold");
            doc.setTextColor(26, 22, 18);
            doc.text(yarnLibraryName, margin + 24, y + 9);
            doc.setFontSize(8);
            doc.setFont("helvetica", "normal");
            doc.setTextColor(136, 136, 136);
            doc.text("Order Sheet", margin + 24, y + 14);
            y += 24;
          } else {
            drawTextHeader();
          }
        } catch {
          drawTextHeader();
        }
      } else {
        drawTextHeader();
      }

      // ── Divider ──
      doc.setDrawColor(224, 224, 224);
      doc.setLineWidth(0.3);
      doc.line(margin, y, margin + contentW, y);
      y += 5;

      // ── Preview image (JPEG, max 1000px longest side) ──
      const jpegSnapshot = canvasRef.current?.getSnapshot(1000, "jpeg", 0.8) ?? null;
      if (jpegSnapshot) {
        const imgAspect = design.width / design.height;
        const maxH = 90;
        let imgW = contentW;
        let imgH = imgW / imgAspect;
        if (imgH > maxH) { imgH = maxH; imgW = imgH * imgAspect; }
        const imgX = margin + (contentW - imgW) / 2;
        doc.addImage(jpegSnapshot, "JPEG", imgX, y, imgW, imgH);
        y += imgH + 5;
      }

      // ── Metadata ──
      const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
      const meta: [string, string][] = [
        ["Design", design.name],
        ["Size", `${design.width} x ${design.height} px`],
        ["Date", dateStr],
      ];

      doc.setFontSize(9);
      for (const [label, value] of meta) {
        doc.setFont("helvetica", "bold");
        doc.setTextColor(85, 85, 85);
        doc.text(label, margin, y + 3);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(26, 22, 18);
        doc.text(value, margin + 28, y + 3);
        y += 5;
      }
      y += 4;

      // ── Divider ──
      doc.setDrawColor(224, 224, 224);
      doc.line(margin, y, margin + contentW, y);
      y += 5;

      // ── Yarn color table ──
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(26, 22, 18);
      doc.text("Yarn Colors", margin, y + 3);
      y += 7;

      // Table header
      doc.setFontSize(7);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(136, 136, 136);
      doc.text("Swatch", margin, y + 3);
      doc.text("Code", margin + 20, y + 3);
      doc.text("Yarn Name", margin + 55, y + 3);
      doc.text("%", margin + contentW - 5, y + 3, { align: "right" });
      y += 5;

      const rows = effectivePalette
        .filter((e) => e.percentage >= 0.05)
        .sort((a, b) => b.percentage - a.percentage);

      const pageH = doc.internal.pageSize.getHeight();
      for (const entry of rows) {
        if (y + 7 > pageH - margin) {
          doc.addPage();
          y = margin;
        }

        const yarn = recolor.current[entry.hex] ?? null;
        const hex = yarn?.hex ?? entry.hex;
        const code = yarn?.code ?? entry.matchedYarnCode ?? entry.hex.toUpperCase();
        const name = yarn?.name ?? "";

        const { r, g, b } = hexToRgbLocal(hex);
        doc.setFillColor(r, g, b);
        doc.rect(margin, y, 5, 5, "F");
        doc.setDrawColor(200, 200, 200);
        doc.rect(margin, y, 5, 5, "S");

        doc.setFontSize(8);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(26, 22, 18);
        doc.text(code, margin + 20, y + 3.5);

        doc.setFont("helvetica", "normal");
        doc.setTextColor(85, 85, 85);
        doc.text(name, margin + 55, y + 3.5);

        doc.setTextColor(136, 136, 136);
        doc.text(`${entry.percentage.toFixed(1)}%`, margin + contentW - 5, y + 3.5, { align: "right" });

        y += 7;
      }

      // ── Footer ──
      const footY = pageH - 8;
      doc.setFontSize(6);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(170, 170, 170);
      doc.text(
        `Generated by Loom Studio on ${new Date().toISOString().split("T")[0]}`,
        pw / 2, footY, { align: "center" }
      );

      const safeName = design.name.replace(/[^a-zA-Z0-9_\-. ]/g, "").replace(/\s+/g, "_");
      const dateTag = new Date().toISOString().split("T")[0];
      doc.save(`${safeName}_OrderSheet_${dateTag}.pdf`);
    } finally {
      setOrderSheetBusy(false);
    }
  }, [design, effectivePalette, recolor, canvasRef, yarnLibraryName, brandLogoUrl]);

  // ── Rebuild effective palette when global colorMap changes ───────────────────
  // This covers: initial load (savedColorMap / initialColorMap), every ASSIGN/UNDO/REDO/RESET.
  // Region-fill-driven rebuilds happen via the delta callbacks, not here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { rebuildEffectivePalette(); }, [recolor.current]);

  // ── Color pick handlers ──────────────────────────────────────────────────────

  // Canvas click → show the floating popover; deselects any active picker selection
  const handleCanvasColorPick = useCallback(
    (hex: string, clientX: number, clientY: number) => {
      setCanvasPick({ hex, clientX, clientY });
      setSelectedHex(null);
    },
    []
  );

  // Palette row click → open YarnPicker directly; dismiss any canvas popover
  const handlePaletteColorPick = useCallback((hex: string) => {
    setSelectedHex(hex);
    setCanvasPick(null);
  }, []);

  // Popover "choose yarn / change yarn" → open picker; keep popover visible
  function handlePopoverOpenPicker() {
    if (!canvasPick) return;
    setSelectedHex(canvasPick.hex);
    // intentionally NOT clearing canvasPick — popover stays visible
  }

  function handleYarnPick(yarn: YarnOption) {
    if (recolorMode === "region") {
      // In region mode, picking a yarn sets it as the active fill color.
      // Canvas clicks will then flood-fill the clicked region with this yarn.
      setSelectedFillYarn(yarn);
      return;
    }
    if (!selectedHex) return;
    dispatch({ type: "ASSIGN", hex: selectedHex, yarn });
    // Keep selectedHex — picker stays "hot" so user can swap yarns without re-selecting
  }

  function handlePickerClose() {
    setSelectedHex(null);
    setCanvasPick(null); // picker closed → dismiss the popover too
  }

  // Revert a single color back to its initial (pre-matched) state, or unassigned
  function handleRevert(hex: string) {
    dispatch({ type: "REVERT", hex, yarn: initialColorMap?.[hex] ?? null });
  }

  // ── Snapshot for submission ──────────────────────────────────────────────────
  const getSnapshot = useCallback(() => {
    return canvasRef.current?.getSnapshot() ?? null;
  }, []);

  const hasChanges =
    Object.keys(recolor.current).length > 0 ||
    regionFillHistoryRef.current.length > 0;

  // Show save button for any signed-in non-demo user (catalog or upload)
  const canSave = tierInfo.tier !== "demo";

  return (
    <div className="relative flex h-full overflow-hidden">
      {/* Restored-colorway toast */}
      {showRestoredToast && (
        <div
          role="status"
          aria-live="polite"
          className="absolute bottom-14 left-1/2 -translate-x-1/2 z-50 pointer-events-none px-3 py-1.5 rounded-full bg-stone-800/90 text-white text-xs font-medium shadow-lg whitespace-nowrap animate-fade-in"
        >
          Restored your saved colorway
        </div>
      )}

      {/* Saved toast — shown after a successful save */}
      {showSavedToast && (
        <div
          role="status"
          aria-live="polite"
          className="absolute bottom-14 left-1/2 -translate-x-1/2 z-50 pointer-events-none px-3 py-1.5 rounded-full bg-green-700/90 text-white text-xs font-medium shadow-lg whitespace-nowrap animate-fade-in"
        >
          Colorway saved
        </div>
      )}

      {/* Zone B — canvas */}
      <CanvasZone
        design={design}
        colorMap={recolor.current}
        selectedHex={canvasPick?.hex ?? selectedHex}
        onColorPick={handleCanvasColorPick}
        canvasRef={canvasRef}
        onUndo={() => {
          if (!canvasRef.current?.undoRegionFill()) {
            dispatch({ type: "UNDO" });
          }
        }}
        onRedo={() => dispatch({ type: "REDO" })}
        onReset={() => {
          regionFillHistoryRef.current = [];
          overrideOriginalCountRef.current = new Map();
          overrideDisplayCountRef.current = new Map();
          overrideYarnByRgbRef.current = new Map();
          dispatch({ type: "RESET" });
          canvasRef.current?.clearRegionFills();
          setEffectivePalette(design.palette);
        }}
        canUndo={!!recolor.past.length}
        canRedo={!!recolor.future.length}
        hasChanges={hasChanges}
        onSave={canSave ? async () => { setShowSaveModal(true); } : undefined}
        onRequestColorway={() => setShowSubmissionForm(true)}
        tierInfo={tierInfo}
        canSave={canSave}
        colorwayLoading={colorwayLoading}
        onRenderComplete={() => setCanvasReady(true)}
        textureEnabled={textureEnabled}
        onToggleTexture={() => setTextureEnabled((v) => !v)}
        mode={recolorMode}
        onToggleMode={() => setRecolorMode((m) => m === "global" ? "region" : "global")}
        selectedFillYarn={selectedFillYarn}
        onRegionFillDelta={handleRegionFillDelta}
        onRegionUndoDelta={handleRegionUndoDelta}
        onRegionClear={handleRegionClear}
        onDownloadOrderSheet={tierInfo.tier !== "demo" ? handleDownloadOrderSheet : undefined}
        orderSheetBusy={orderSheetBusy}
      />

      {/* Zone C — compact palette. Mobile: max-h-40 overflow-hidden; desktop: full height */}
      <div className="shrink-0 w-[13%] min-w-[160px] flex flex-col border-l border-stone-200 bg-white overflow-hidden">
        <CompactPalette
          designName={design.name}
          palette={effectivePalette}
          colorMap={recolor.current}
          initialColorMap={initialColorMap ?? {}}
          selectedHex={canvasPick?.hex ?? selectedHex}
          onSelectColor={handlePaletteColorPick}
          onRevert={handleRevert}
          tierInfo={tierInfo}
          isUserUpload={isUserUpload}
          viewProductUrl={viewProductUrl}
          mode={recolorMode}
          onToggleMode={() => setRecolorMode((m) => m === "global" ? "region" : "global")}
        />
      </div>

      {/* Zone D — inline yarn picker, desktop only.
          In region mode: shows all yarns for fill-color selection; currentYarn is the
          active fill yarn.  In global mode: shows closest matches for selectedHex. */}
      <div className="flex flex-col shrink-0 w-[16%] min-w-[200px] border-l border-stone-200 bg-white overflow-hidden">
        <InlineYarnPicker
          yarns={yarns}
          targetEntry={
            recolorMode === "region"
              ? null // no palette-color context in region mode
              : (selectedHex ? (design.palette.find((e) => e.hex === selectedHex) ?? null) : null)
          }
          currentYarn={
            recolorMode === "region"
              ? selectedFillYarn
              : (selectedHex ? (recolor.current[selectedHex] ?? null) : null)
          }
          onPick={handleYarnPick}
          tierInfo={tierInfo}
          yarnLibraryName={yarnLibraryName}
        />
      </div>

      {/* Mobile: YarnPicker bottom sheet */}
      {selectedHex && (() => {
        const entry = design.palette.find((e) => e.hex === selectedHex);
        return entry ? (
          <div className="md:hidden">
            <YarnPicker
              yarns={yarns}
              targetEntry={entry}
              currentYarn={recolor.current[selectedHex] ?? null}
              onPick={handleYarnPick}
              onClose={handlePickerClose}
              tierInfo={tierInfo}
              yarnLibraryName={yarnLibraryName}
            />
          </div>
        ) : null;
      })()}

      {/* ColorPopover */}
      {canvasPick && (() => {
        const entry = design.palette.find((e) => e.hex === canvasPick.hex);
        if (!entry) return null;
        return (
          <ColorPopover
            entry={entry}
            paletteRank={
              sortedPalette.findIndex((e) => e.hex === canvasPick.hex) + 1
            }
            assignedYarn={recolor.current[canvasPick.hex] ?? null}
            initialYarn={initialColorMap?.[canvasPick.hex] ?? null}
            clientX={canvasPick.clientX}
            clientY={canvasPick.clientY}
            onOpenPicker={handlePopoverOpenPicker}
            onDismiss={() => setCanvasPick(null)}
            tierInfo={tierInfo}
            yarnLibraryName={yarnLibraryName}
          />
        );
      })()}

      {/* Submission form */}
      {showSubmissionForm && (
        <SubmissionForm
          designId={design.id}
          designName={design.name}
          palette={design.palette}
          colorMap={recolor.current}
          getSnapshot={getSnapshot}
          onClose={() => setShowSubmissionForm(false)}
        />
      )}

      {/* Save modal */}
      {showSaveModal && (
        <SaveModal
          onSave={handleSaveSubmit}
          onClose={() => setShowSaveModal(false)}
        />
      )}
    </div>
  );
}

// ─── PDF helpers ──────────────────────────────────────────────────────────────

function hexToRgbLocal(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.substring(0, 2), 16) || 0,
    g: parseInt(h.substring(2, 4), 16) || 0,
    b: parseInt(h.substring(4, 6), 16) || 0,
  };
}

function loadImageAsDataUrl(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d")!.drawImage(img, 0, 0);
      try {
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

