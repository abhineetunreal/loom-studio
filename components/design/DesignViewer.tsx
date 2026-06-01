"use client";

import { useReducer, useState, useRef, useCallback, useEffect } from "react";
import RecolorCanvas, { type RecolorCanvasHandle } from "./RecolorCanvas";
import PalettePanel from "./PalettePanel";
import ColorPopover from "./ColorPopover";
import YarnPicker from "./YarnPicker";
import SubmissionForm from "./SubmissionForm";
import type { DesignDetail, PaletteEntry, YarnOption } from "@/types";

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
};

// State for the floating popover shown on canvas click (before the full picker opens)
type CanvasPickState = {
  hex: string;
  clientX: number;
  clientY: number;
} | null;

export default function DesignViewer({ design, yarns, initialColorMap }: Props) {
  const [recolor, dispatch] = useReducer(
    recolorReducer,
    initialColorMap ?? {},
    (initial): RecolorState => ({ current: initial as ColorMap, past: [], future: [] })
  );
  // Set when YarnPicker should be open (from palette row click OR popover "choose yarn")
  const [selectedHex, setSelectedHex] = useState<string | null>(null);
  // Set when the floating popover should be shown (canvas click, before picker opens)
  const [canvasPick, setCanvasPick] = useState<CanvasPickState>(null);
  const [showSubmissionForm, setShowSubmissionForm] = useState(false);
  const canvasRef = useRef<RecolorCanvasHandle>(null);

  const paletteByHex = new Map<string, PaletteEntry>(
    design.palette.map((e) => [e.hex, e])
  );
  const selectedEntry = selectedHex ? paletteByHex.get(selectedHex) ?? null : null;

  // Palette sorted by coverage — used to derive 1-based rank for the popover
  const sortedPalette = [...design.palette].sort((a, b) => b.percentage - a.percentage);
  const paletteRankByHex = new Map(sortedPalette.map((e, i) => [e.hex, i + 1]));

  // ── Keyboard shortcuts ───────────────────────────────────────────────────────
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        dispatch({ type: "UNDO" });
      }
      if (e.key === "y" || (e.key === "z" && e.shiftKey)) {
        e.preventDefault();
        dispatch({ type: "REDO" });
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // ── Color pick handlers ──────────────────────────────────────────────────────

  // Canvas click → show the floating popover (does NOT open YarnPicker directly)
  const handleCanvasColorPick = useCallback(
    (hex: string, clientX: number, clientY: number) => {
      setCanvasPick({ hex, clientX, clientY });
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
    if (!selectedHex) return;
    dispatch({ type: "ASSIGN", hex: selectedHex, yarn });
    setSelectedHex(null);
    // canvasPick stays set — popover remains and will re-render with the new yarn
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

  const hasChanges = Object.keys(recolor.current).length > 0;

  return (
    <div className="flex flex-col lg:flex-row gap-8 lg:items-start">
      {/* ── Left: canvas + toolbar ───────────────────────────────────────── */}
      <div className="flex-1 min-w-0">
        <RecolorCanvas
          ref={canvasRef}
          imageUrl={design.imageUrl}
          width={design.width}
          height={design.height}
          palette={design.palette}
          colorMap={recolor.current}
          selectedHex={canvasPick?.hex ?? selectedHex}
          onColorPick={handleCanvasColorPick}
        />

        {/* Undo / Redo / Reset — sits below the canvas */}
        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={() => dispatch({ type: "UNDO" })}
            disabled={!recolor.past.length}
            title="Undo (Ctrl+Z)"
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-stone-200 hover:bg-stone-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <UndoIcon /> Undo
          </button>
          <button
            onClick={() => dispatch({ type: "REDO" })}
            disabled={!recolor.future.length}
            title="Redo (Ctrl+Y)"
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-stone-200 hover:bg-stone-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <RedoIcon /> Redo
          </button>
          <button
            onClick={() => dispatch({ type: "RESET" })}
            disabled={!hasChanges}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-stone-200 hover:bg-stone-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Reset
          </button>
          <p className="text-xs text-stone-400 ml-1 hidden sm:block">
            {hasChanges
              ? `${Object.keys(recolor.current).length} color${Object.keys(recolor.current).length !== 1 ? "s" : ""} changed`
              : "Click a color region to start"}
          </p>
        </div>
      </div>

      {/* ── Right: palette + request button (sticky on desktop) ─────────── */}
      <aside className="w-full lg:w-72 xl:w-80 shrink-0">
        <div className="lg:sticky lg:top-6 flex flex-col gap-4">
          <div>
            <h1 className="text-xl font-semibold leading-tight">{design.name}</h1>
            <p className="text-sm text-stone-400 mt-0.5">
              {design.width} × {design.height} px
            </p>
          </div>

          <PalettePanel
            palette={design.palette}
            colorMap={recolor.current}
            initialColorMap={initialColorMap ?? {}}
            selectedHex={canvasPick?.hex ?? selectedHex}
            onSelectColor={handlePaletteColorPick}
            onRevert={handleRevert}
          />

          <button
            onClick={() => setShowSubmissionForm(true)}
            className="w-full bg-stone-900 text-white text-sm font-medium py-3 rounded-xl hover:bg-stone-700 transition-colors"
          >
            Request this colorway
          </button>
        </div>
      </aside>

      {/* ── Canvas click popover ────────────────────────────────────────── */}
      {canvasPick && (() => {
        const popoverEntry = paletteByHex.get(canvasPick.hex);
        if (!popoverEntry) return null;
        return (
          <ColorPopover
            entry={popoverEntry}
            paletteRank={paletteRankByHex.get(canvasPick.hex) ?? 1}
            assignedYarn={recolor.current[canvasPick.hex] ?? null}
            initialYarn={initialColorMap?.[canvasPick.hex] ?? null}
            clientX={canvasPick.clientX}
            clientY={canvasPick.clientY}
            onOpenPicker={handlePopoverOpenPicker}
            onDismiss={() => setCanvasPick(null)}
          />
        );
      })()}

      {/* ── YarnPicker modal ─────────────────────────────────────────────── */}
      {selectedHex && selectedEntry && (
        <YarnPicker
          yarns={yarns}
          targetEntry={selectedEntry}
          currentYarn={recolor.current[selectedHex] ?? null}
          onPick={handleYarnPick}
          onClose={handlePickerClose}
        />
      )}

      {/* ── Submission form modal ────────────────────────────────────────── */}
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
    </div>
  );
}

// ─── Micro icons ─────────────────────────────────────────────────────────────

function UndoIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3" />
    </svg>
  );
}
