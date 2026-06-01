"use client";

import { useReducer, useState, useRef, useCallback, useEffect } from "react";
import RecolorCanvas, { type RecolorCanvasHandle } from "./RecolorCanvas";
import PalettePanel from "./PalettePanel";
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
};

export default function DesignViewer({ design, yarns }: Props) {
  const [recolor, dispatch] = useReducer(recolorReducer, initialRecolorState);
  // Which palette hex is currently selected (opens YarnPicker when set)
  const [selectedHex, setSelectedHex] = useState<string | null>(null);
  const [showSubmissionForm, setShowSubmissionForm] = useState(false);
  const canvasRef = useRef<RecolorCanvasHandle>(null);

  const paletteByHex = new Map<string, PaletteEntry>(
    design.palette.map((e) => [e.hex, e])
  );
  const selectedEntry = selectedHex ? paletteByHex.get(selectedHex) ?? null : null;

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
  const handleColorPick = useCallback((hex: string) => {
    setSelectedHex(hex);
  }, []);

  function handleYarnPick(yarn: YarnOption) {
    if (!selectedHex) return;
    dispatch({ type: "ASSIGN", hex: selectedHex, yarn });
    setSelectedHex(null);
  }

  function handlePickerClose() {
    setSelectedHex(null);
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
          selectedHex={selectedHex}
          onColorPick={handleColorPick}
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
            selectedHex={selectedHex}
            onSelectColor={handleColorPick}
          />

          <button
            onClick={() => setShowSubmissionForm(true)}
            className="w-full bg-stone-900 text-white text-sm font-medium py-3 rounded-xl hover:bg-stone-700 transition-colors"
          >
            Request this colorway
          </button>
        </div>
      </aside>

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
