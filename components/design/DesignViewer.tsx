"use client";

import { useReducer, useState, useRef, useCallback, useEffect } from "react";
import type { RecolorCanvasHandle } from "./RecolorCanvas";
import CanvasZone from "./CanvasZone";
import CompactPalette from "./CompactPalette";
import InlineYarnPicker from "./InlineYarnPicker";
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
  const canvasRef = useRef<RecolorCanvasHandle | null>(null);

  // Palette sorted by coverage — used to derive 1-based rank for the popover
  const sortedPalette = [...design.palette].sort((a, b) => b.percentage - a.percentage);

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

  const hasChanges = Object.keys(recolor.current).length > 0;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Zone B — canvas */}
      <CanvasZone
        design={design}
        colorMap={recolor.current}
        selectedHex={canvasPick?.hex ?? selectedHex}
        onColorPick={handleCanvasColorPick}
        canvasRef={canvasRef}
        onUndo={() => dispatch({ type: "UNDO" })}
        onRedo={() => dispatch({ type: "REDO" })}
        onReset={() => dispatch({ type: "RESET" })}
        canUndo={!!recolor.past.length}
        canRedo={!!recolor.future.length}
        hasChanges={hasChanges}
      />

      {/* Zone C — compact palette. Mobile: max-h-40 overflow-hidden; desktop: full height */}
      <div className="shrink-0 w-[13%] min-w-[160px] flex flex-col border-l border-stone-200 bg-white overflow-hidden">
        <CompactPalette
          designName={design.name}
          palette={design.palette}
          colorMap={recolor.current}
          initialColorMap={initialColorMap ?? {}}
          selectedHex={canvasPick?.hex ?? selectedHex}
          onSelectColor={handlePaletteColorPick}
          onRevert={handleRevert}
          onRequestColorway={() => setShowSubmissionForm(true)}
        />
      </div>

      {/* Zone D — inline yarn picker, desktop only */}
      <div className="flex flex-col shrink-0 w-[16%] min-w-[200px] border-l border-stone-200 bg-white overflow-hidden">
        <InlineYarnPicker
          yarns={yarns}
          targetEntry={selectedHex ? (design.palette.find((e) => e.hex === selectedHex) ?? null) : null}
          currentYarn={selectedHex ? (recolor.current[selectedHex] ?? null) : null}
          onPick={handleYarnPick}
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
    </div>
  );
}
