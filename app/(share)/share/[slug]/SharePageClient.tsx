"use client";

import { useReducer, useState, useRef, useCallback, useEffect } from "react";
import Image from "next/image";
import type { RecolorCanvasHandle } from "@/components/design/RecolorCanvas";
import { type RegionFillDelta, type RegionUndoDelta } from "@/components/design/RecolorCanvas";
import CanvasZone from "@/components/design/CanvasZone";
import CompactPalette from "@/components/design/CompactPalette";
import InlineYarnPicker from "@/components/design/InlineYarnPicker";
import ColorPopover from "@/components/design/ColorPopover";
import type { PaletteEntry, TierInfo, YarnOption } from "@/types";
import type { ColorwayOperations, RegionFillOperation } from "@/components/design/DesignViewer";

// ─── Types ──────────────────────────────────────────────────────────────────

type DesignData = {
  id: string;
  name: string;
  slug: string;
  imageUrl: string;
  sourceBmpUrl: string;
  width: number;
  height: number;
  palette: PaletteEntry[];
  externalSku: string | null;
  collection: { id: string; name: string; slug: string } | null;
};

type PresetData = {
  colorwayId: string;
  displayName: string;
  operations: ColorwayOperations | null;
  snapshotUrl: string | null;
};

type ApprovalData = {
  id: string;
  designId: string;
  clientEmail: string;
  operations: unknown;
  thumbnail: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

type Props = {
  slug: string;
  shareLink: {
    id: string;
    clientName: string;
    clientEmail: string;
    createdBy: string;
  };
  tenant: {
    displayName: string;
    logoUrl: string | null;
  };
  primaryDesign: DesignData;
  additionalDesigns: (DesignData & { initialColorMap: Record<string, YarnOption> })[];
  yarns: YarnOption[];
  initialColorMap: Record<string, YarnOption>;
  presets: PresetData[];
  existingApprovals: ApprovalData[];
  yarnLibraryName: string;
};

// ─── Recolor reducer (same as DesignViewer) ─────────────────────────────────

type ColorMap = Record<string, YarnOption | null>;

type RecolorState = {
  current: ColorMap;
  past: ColorMap[];
  future: ColorMap[];
};

type RecolorAction =
  | { type: "ASSIGN"; hex: string; yarn: YarnOption }
  | { type: "REVERT"; hex: string; yarn: YarnOption | null }
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

// ─── Share tier info (always "full" — no admin features, no demo restrictions)
const SHARE_TIER_INFO: TierInfo = { tier: "full", pendingApproval: false };

// ─── Component ──────────────────────────────────────────────────────────────

export default function SharePageClient({
  slug,
  shareLink,
  tenant,
  primaryDesign,
  additionalDesigns,
  yarns,
  initialColorMap,
  presets,
  existingApprovals: initialApprovals,
  yarnLibraryName,
}: Props) {
  // ── Email gate ────────────────────────────────────────────────────────────
  const [clientEmail, setClientEmail] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(`share_email_${slug}`) ?? null;
  });
  const [emailInput, setEmailInput] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Check localStorage on mount (SSR safety)
  useEffect(() => {
    const stored = localStorage.getItem(`share_email_${slug}`);
    if (stored) setClientEmail(stored);
  }, [slug]);

  // ── Active design (primary or one of the additional) ──────────────────────
  const [activeDesignId, setActiveDesignId] = useState(primaryDesign.id);
  const activeDesign =
    activeDesignId === primaryDesign.id
      ? primaryDesign
      : additionalDesigns.find((d) => d.id === activeDesignId) ?? primaryDesign;
  const activeInitialColorMap =
    activeDesignId === primaryDesign.id
      ? initialColorMap
      : (additionalDesigns.find((d) => d.id === activeDesignId)?.initialColorMap ?? {});

  // ── Recolor state ─────────────────────────────────────────────────────────
  const [recolor, dispatch] = useReducer(
    recolorReducer,
    activeInitialColorMap,
    (initial): RecolorState => ({ current: initial as ColorMap, past: [], future: [] })
  );
  const [selectedHex, setSelectedHex] = useState<string | null>(null);
  const [textureEnabled, setTextureEnabled] = useState(true);
  const [recolorMode, setRecolorMode] = useState<"global" | "region">("global");
  const [selectedFillYarn, setSelectedFillYarn] = useState<YarnOption | null>(null);
  const [canvasReady, setCanvasReady] = useState(false);
  const [colorwayLoading, setColorwayLoading] = useState(false);
  const canvasRef = useRef<RecolorCanvasHandle | null>(null);

  // ── Canvas pick popover state ─────────────────────────────────────────────
  type CanvasPickState = { hex: string; clientX: number; clientY: number } | null;
  const [canvasPick, setCanvasPick] = useState<CanvasPickState>(null);

  // ── Before/after toggle ───────────────────────────────────────────────────
  const [showOriginal, setShowOriginal] = useState(false);

  // ── Active preset ─────────────────────────────────────────────────────────
  const [activePresetId, setActivePresetId] = useState<string | null>(
    presets.length > 0 ? presets[0].colorwayId : null
  );

  // ── Approvals ─────────────────────────────────────────────────────────────
  const [approvals, setApprovals] = useState<ApprovalData[]>(initialApprovals);
  const [savingStatus, setSavingStatus] = useState<"idle" | "saving" | "approving">("idle");
  const [saveToast, setSaveToast] = useState<string | null>(null);

  // ── Region fill tracking ──────────────────────────────────────────────────
  const overrideOriginalCountRef = useRef<Map<string, number>>(new Map());
  const overrideDisplayCountRef = useRef<Map<number, number>>(new Map());
  const overrideYarnByRgbRef = useRef<Map<number, YarnOption>>(new Map());
  const regionFillHistoryRef = useRef<RegionFillOperation[]>([]);
  const [effectivePalette, setEffectivePalette] = useState(activeDesign.palette);
  const totalPixels = activeDesign.palette.reduce((s, e) => s + e.pixelCount, 0);
  const sortedPalette = [...activeDesign.palette].sort((a, b) => b.percentage - a.percentage);

  function packedToHex(packed: number): string {
    const r = (packed >> 16) & 0xff;
    const g = (packed >> 8) & 0xff;
    const b = packed & 0xff;
    return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
  }

  function rebuildEffectivePalette() {
    const entries: PaletteEntry[] = [];
    for (const entry of activeDesign.palette) {
      const overridden = overrideOriginalCountRef.current.get(entry.hex) ?? 0;
      const visible = Math.max(0, entry.pixelCount - overridden);
      if (visible === 0) continue;
      entries.push({
        ...entry,
        pixelCount: visible,
        percentage: totalPixels > 0 ? (visible / totalPixels) * 100 : 0,
      });
    }
    const originalHexSet = new Set(activeDesign.palette.map((e) => e.hex));
    for (const [packedRgb, count] of overrideDisplayCountRef.current) {
      if (count <= 0) continue;
      const displayHex = packedToHex(packedRgb);
      if (originalHexSet.has(displayHex)) continue;
      const yarn = overrideYarnByRgbRef.current.get(packedRgb);
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

  const handleRegionFillDelta = useCallback((delta: RegionFillDelta) => {
    const oc = overrideOriginalCountRef.current;
    const dc = overrideDisplayCountRef.current;
    const ym = overrideYarnByRgbRef.current;
    const newlyOverridden = delta.pixelCount - delta.previousColors.size;
    oc.set(delta.originalHex, (oc.get(delta.originalHex) ?? 0) + newlyOverridden);
    for (const prevRgb of delta.previousColors.values()) {
      dc.set(prevRgb, (dc.get(prevRgb) ?? 0) - 1);
    }
    dc.set(delta.newRgb, (dc.get(delta.newRgb) ?? 0) + delta.pixelCount);
    ym.set(delta.newRgb, delta.yarn);
    regionFillHistoryRef.current.push({
      seedX: delta.seedX,
      seedY: delta.seedY,
      originalColor: delta.originalHex,
      newHex: delta.yarn.hex,
      newYarnCode: delta.yarn.code,
      newYarnId: delta.yarn.id,
      material: delta.yarn.library ?? undefined,
      renderType: delta.yarn.renderType,
      swatchImageUrl: delta.yarn.swatchImageUrl,
    });
    rebuildEffectivePalette();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRegionUndoDelta = useCallback((delta: RegionUndoDelta) => {
    const oc = overrideOriginalCountRef.current;
    const dc = overrideDisplayCountRef.current;
    dc.set(delta.removedRgb, (dc.get(delta.removedRgb) ?? 0) - delta.pixelCount);
    const restoredToOriginal = delta.pixelCount - delta.previousColors.size;
    oc.set(delta.originalHex, Math.max(0, (oc.get(delta.originalHex) ?? 0) - restoredToOriginal));
    for (const prevRgb of delta.previousColors.values()) {
      dc.set(prevRgb, (dc.get(prevRgb) ?? 0) + 1);
    }
    regionFillHistoryRef.current.pop();
    rebuildEffectivePalette();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRegionClear = useCallback(() => {
    overrideOriginalCountRef.current.clear();
    overrideDisplayCountRef.current.clear();
    overrideYarnByRgbRef.current.clear();
    regionFillHistoryRef.current = [];
    setEffectivePalette(activeDesign.palette);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDesign.palette]);

  // ── Rebuild effective palette when global colorMap changes ─────────────────
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { rebuildEffectivePalette(); }, [recolor.current]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        if (!canvasRef.current?.undoRegionFill()) dispatch({ type: "UNDO" });
      }
      if (e.key === "y" || (e.key === "z" && e.shiftKey)) {
        e.preventDefault();
        dispatch({ type: "REDO" });
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // ── Build operations JSON ─────────────────────────────────────────────────
  const buildOperations = useCallback((): ColorwayOperations => {
    const globalMap: ColorwayOperations["globalMap"] = {};
    for (const [hex, yarn] of Object.entries(recolor.current)) {
      if (!yarn) continue;
      globalMap[hex] = {
        hex: yarn.hex,
        yarnCode: yarn.code,
        yarnId: yarn.id,
        material: yarn.library ?? undefined,
        renderType: yarn.renderType,
        swatchImageUrl: yarn.swatchImageUrl,
      };
    }
    return { globalMap, regionFills: [...regionFillHistoryRef.current] };
  }, [recolor]);

  // ── Apply preset / restore operations ─────────────────────────────────────
  const applyOperations = useCallback((ops: ColorwayOperations) => {
    const yarnById = new Map(yarns.map((y) => [y.id, y]));
    const yarnByMaterialCode = new Map(
      yarns.map((y) => [`${y.library ?? ""}:${y.code}`, y])
    );
    function resolve(entry: { yarnId: string; yarnCode?: string; material?: string }): YarnOption | undefined {
      if (entry.material && entry.yarnCode) {
        const byMC = yarnByMaterialCode.get(`${entry.material}:${entry.yarnCode}`);
        if (byMC) return byMC;
      }
      return yarnById.get(entry.yarnId);
    }

    // Apply global map
    dispatch({ type: "RESET" });
    for (const [hex, entry] of Object.entries(ops.globalMap)) {
      const yarn = resolve(entry);
      if (yarn) dispatch({ type: "ASSIGN", hex, yarn });
    }

    // Clear + replay region fills
    canvasRef.current?.clearRegionFills();
    overrideOriginalCountRef.current.clear();
    overrideDisplayCountRef.current.clear();
    overrideYarnByRgbRef.current.clear();
    regionFillHistoryRef.current = [];
    for (const fill of ops.regionFills) {
      const yarn = resolve({ yarnId: fill.newYarnId, yarnCode: fill.newYarnCode, material: fill.material });
      if (!yarn) continue;
      canvasRef.current?.replayRegionFill(fill.seedX, fill.seedY, yarn);
    }
  }, [yarns]);

  // ── Auto-apply first preset on canvas ready ───────────────────────────────
  useEffect(() => {
    if (!canvasReady) return;
    if (presets.length > 0 && presets[0].operations) {
      setColorwayLoading(true);
      // Small delay to ensure canvas is fully rendered
      requestAnimationFrame(() => {
        applyOperations(presets[0].operations!);
        setColorwayLoading(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasReady]);

  // ── Event logging (fire-and-forget) ───────────────────────────────────────
  const logEvent = useCallback(
    (type: string, detail?: Record<string, unknown>) => {
      if (!sessionId) return;
      fetch(`/api/share/${slug}/event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, type, detail }),
      }).catch(() => {});
    },
    [sessionId, slug]
  );

  // ── Email submit handler ──────────────────────────────────────────────────
  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = emailInput.trim().toLowerCase();
    if (!email) return;

    const emailMatch = email === shareLink.clientEmail.toLowerCase();
    localStorage.setItem(`share_email_${slug}`, email);
    setClientEmail(email);

    // Create session
    try {
      const res = await fetch(`/api/share/${slug}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientEmail: email, emailMatch }),
      });
      if (res.ok) {
        const data = await res.json();
        setSessionId(data.sessionId);
      }
    } catch {
      // Non-blocking
    }
  };

  // Create session for returning visitors (email already in localStorage)
  useEffect(() => {
    if (!clientEmail || sessionId) return;
    const emailMatch = clientEmail.toLowerCase() === shareLink.clientEmail.toLowerCase();
    fetch(`/api/share/${slug}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientEmail, emailMatch }),
    })
      .then((r) => r.json())
      .then((d) => setSessionId(d.sessionId))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientEmail]);

  // ── Save / Approve handlers ───────────────────────────────────────────────
  const handleSave = useCallback(
    async (status: "draft" | "approved") => {
      if (!clientEmail) return;
      setSavingStatus(status === "approved" ? "approving" : "saving");

      try {
        const operations = buildOperations();
        const thumbnailDataUrl =
          canvasRef.current?.getSnapshot(800, "jpeg", 0.8) ?? undefined;

        const res = await fetch(`/api/share/${slug}/approval`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            clientEmail,
            designId: activeDesign.id,
            operations,
            thumbnailDataUrl,
            status,
          }),
        });

        if (!res.ok) throw new Error("Save failed");

        const data = await res.json();
        logEvent(status === "approved" ? "approved" : "colorway_saved", {
          approvalId: data.id,
        });

        // Refresh approvals
        const appRes = await fetch(`/api/share/${slug}/approvals`);
        if (appRes.ok) {
          const appData = await appRes.json();
          setApprovals(appData.approvals);
        }

        setSaveToast(
          status === "approved"
            ? "Colorway approved! Confirmation emails have been sent."
            : "Draft saved"
        );
        setTimeout(() => setSaveToast(null), 4000);
      } catch (err) {
        console.error("Save failed:", err);
        setSaveToast("Failed to save. Please try again.");
        setTimeout(() => setSaveToast(null), 3000);
      } finally {
        setSavingStatus("idle");
      }
    },
    [clientEmail, sessionId, slug, activeDesign.id, buildOperations, logEvent]
  );

  // ── Color pick handlers ───────────────────────────────────────────────────
  const handleCanvasColorPick = useCallback(
    (hex: string, clientX: number, clientY: number) => {
      setCanvasPick({ hex, clientX, clientY });
      setSelectedHex(null);
    },
    []
  );

  const handlePaletteColorPick = useCallback((hex: string) => {
    setSelectedHex(hex);
    setCanvasPick(null);
  }, []);

  function handlePopoverOpenPicker() {
    if (!canvasPick) return;
    setSelectedHex(canvasPick.hex);
  }

  function handleYarnPick(yarn: YarnOption) {
    if (recolorMode === "region") {
      setSelectedFillYarn(yarn);
      return;
    }
    if (!selectedHex) return;
    dispatch({ type: "ASSIGN", hex: selectedHex, yarn });
    logEvent("color_changed", { hex: selectedHex, yarnCode: yarn.code });
  }

  function handlePickerClose() {
    setSelectedHex(null);
    setCanvasPick(null);
  }

  function handleRevert(hex: string) {
    dispatch({ type: "REVERT", hex, yarn: activeInitialColorMap[hex] ?? null });
  }

  const hasChanges =
    Object.keys(recolor.current).length > 0 ||
    regionFillHistoryRef.current.length > 0;

  // ── Preset click handler ──────────────────────────────────────────────────
  function handlePresetClick(preset: PresetData) {
    if (!preset.operations) return;
    setActivePresetId(preset.colorwayId);
    setColorwayLoading(true);
    requestAnimationFrame(() => {
      applyOperations(preset.operations!);
      setColorwayLoading(false);
    });
    logEvent("preset_selected", { presetId: preset.colorwayId });
  }

  // ── Design switch handler ─────────────────────────────────────────────────
  function handleDesignSwitch(designId: string) {
    if (designId === activeDesignId) return;
    setActiveDesignId(designId);
    dispatch({ type: "RESET" });
    canvasRef.current?.clearRegionFills();
    overrideOriginalCountRef.current.clear();
    overrideDisplayCountRef.current.clear();
    overrideYarnByRgbRef.current.clear();
    regionFillHistoryRef.current = [];
    setCanvasReady(false);
    setSelectedHex(null);
    setCanvasPick(null);
    setActivePresetId(null);
    logEvent("design_viewed", { designId });
  }

  // ── Restore approval ──────────────────────────────────────────────────────
  function handleRestoreApproval(approval: ApprovalData) {
    const ops = approval.operations as ColorwayOperations | null;
    if (!ops) return;
    setColorwayLoading(true);
    requestAnimationFrame(() => {
      applyOperations(ops);
      setColorwayLoading(false);
    });
  }

  // The colorMap to pass to canvas: empty when showing original
  const displayColorMap = showOriginal ? {} : recolor.current;

  // ── Email gate screen ─────────────────────────────────────────────────────
  if (!clientEmail) {
    return (
      <div className="h-full flex items-center justify-center bg-stone-50">
        <div className="max-w-sm w-full mx-4 text-center">
          {/* Tenant logo */}
          {tenant.logoUrl ? (
            <Image
              src={tenant.logoUrl}
              alt={tenant.displayName}
              width={160}
              height={48}
              className="h-12 w-auto mx-auto mb-6 object-contain"
              priority
            />
          ) : (
            <h1 className="text-xl font-semibold text-stone-900 mb-6">
              {tenant.displayName}
            </h1>
          )}

          <p className="text-sm text-stone-600 mb-6">
            {tenant.displayName} has prepared a rug design for your review
          </p>

          <form onSubmit={handleEmailSubmit} className="space-y-3">
            <input
              type="email"
              required
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder="you@company.com"
              className="w-full px-4 py-3 text-sm border border-stone-200 rounded-lg bg-white placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/10"
            />
            <button
              type="submit"
              className="w-full px-4 py-3 text-sm font-medium bg-stone-900 text-white rounded-lg hover:bg-stone-700 transition-colors"
            >
              View designs
            </button>
          </form>

          <p className="text-[11px] text-stone-400 mt-4">
            Your email is used only to track your session for this link.
          </p>
        </div>
      </div>
    );
  }

  // ── Recolor view ──────────────────────────────────────────────────────────
  const draftCount = approvals.filter((a) => a.status === "draft").length;
  const approvedCount = approvals.filter((a) => a.status === "approved").length;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Toast */}
      {saveToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none px-4 py-2 rounded-full bg-stone-800/90 text-white text-xs font-medium shadow-lg whitespace-nowrap animate-fade-in"
        >
          {saveToast}
        </div>
      )}

      {/* Header */}
      <header className="shrink-0 border-b border-stone-200 px-4 py-2.5 flex items-center gap-3 bg-white">
        {tenant.logoUrl ? (
          <Image
            src={tenant.logoUrl}
            alt={tenant.displayName}
            width={100}
            height={28}
            className="h-7 w-auto object-contain"
          />
        ) : (
          <span className="font-semibold text-sm text-stone-900">
            {tenant.displayName}
          </span>
        )}
        <span className="flex-1" />
        <span className="text-xs text-stone-500">
          Prepared for{" "}
          <span className="font-medium text-stone-700">
            {shareLink.clientName}
          </span>
        </span>
        {draftCount > 0 && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-600 border border-stone-200">
            {draftCount} draft{draftCount !== 1 ? "s" : ""}
          </span>
        )}
        {approvedCount > 0 && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">
            {approvedCount} approved
          </span>
        )}
      </header>

      {/* Main three-zone layout */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left panel: presets + additional designs + saved drafts */}
        <div className="shrink-0 w-48 border-r border-stone-200 bg-white overflow-y-auto">
          {/* Presets */}
          {presets.length > 0 && (
            <div className="p-2 border-b border-stone-100">
              <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider px-1 mb-1.5">
                Preset Colorways
              </p>
              <div className="space-y-1">
                {presets.map((preset) => (
                  <button
                    key={preset.colorwayId}
                    onClick={() => handlePresetClick(preset)}
                    className={`w-full flex items-center gap-2 p-1.5 rounded-md text-left transition-colors ${
                      activePresetId === preset.colorwayId
                        ? "bg-stone-100 ring-1 ring-stone-300"
                        : "hover:bg-stone-50"
                    }`}
                  >
                    {preset.snapshotUrl && (
                      <div className="w-10 h-10 rounded bg-stone-100 overflow-hidden shrink-0">
                        <Image
                          src={preset.snapshotUrl}
                          alt={preset.displayName}
                          width={40}
                          height={40}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                    <span className="text-xs text-stone-700 truncate">
                      {preset.displayName}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Additional designs */}
          {additionalDesigns.length > 0 && (
            <div className="p-2 border-b border-stone-100">
              <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider px-1 mb-1.5">
                Designs
              </p>
              <div className="grid grid-cols-2 gap-1">
                <button
                  onClick={() => handleDesignSwitch(primaryDesign.id)}
                  className={`rounded-md overflow-hidden border-2 transition-colors ${
                    activeDesignId === primaryDesign.id
                      ? "border-stone-900"
                      : "border-transparent hover:border-stone-300"
                  }`}
                >
                  <Image
                    src={primaryDesign.imageUrl}
                    alt={primaryDesign.name}
                    width={80}
                    height={80}
                    className="w-full aspect-square object-cover"
                  />
                </button>
                {additionalDesigns.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => handleDesignSwitch(d.id)}
                    className={`rounded-md overflow-hidden border-2 transition-colors ${
                      activeDesignId === d.id
                        ? "border-stone-900"
                        : "border-transparent hover:border-stone-300"
                    }`}
                  >
                    <Image
                      src={d.imageUrl}
                      alt={d.name}
                      width={80}
                      height={80}
                      className="w-full aspect-square object-cover"
                    />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Saved drafts / approvals */}
          {approvals.length > 0 && (
            <div className="p-2">
              <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider px-1 mb-1.5">
                Your Saves
              </p>
              <div className="space-y-1">
                {approvals.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => handleRestoreApproval(a)}
                    className="w-full flex items-center gap-2 p-1.5 rounded-md text-left hover:bg-stone-50 transition-colors"
                  >
                    {a.thumbnail && (
                      <div className="w-10 h-10 rounded bg-stone-100 overflow-hidden shrink-0">
                        <Image
                          src={a.thumbnail}
                          alt="Saved colorway"
                          width={40}
                          height={40}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                    <div className="min-w-0">
                      <span
                        className={`text-[10px] font-medium px-1 py-0.5 rounded ${
                          a.status === "approved"
                            ? "bg-green-50 text-green-700"
                            : "bg-stone-100 text-stone-500"
                        }`}
                      >
                        {a.status}
                      </span>
                      <div className="text-[10px] text-stone-400 mt-0.5 truncate">
                        {new Date(a.updatedAt).toLocaleDateString()}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Primary design info (when no presets/additional) */}
          {presets.length === 0 && additionalDesigns.length === 0 && approvals.length === 0 && (
            <div className="p-3">
              <div className="rounded-lg overflow-hidden border border-stone-200">
                <Image
                  src={primaryDesign.imageUrl}
                  alt={primaryDesign.name}
                  width={180}
                  height={180}
                  className="w-full aspect-square object-cover"
                />
              </div>
              <p className="text-xs text-stone-700 font-medium mt-2 truncate">
                {primaryDesign.name}
              </p>
            </div>
          )}
        </div>

        {/* Center: Canvas + floating buttons */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 relative">
          {/* Before/after toggle */}
          <div className="absolute top-3 right-3 z-30 flex rounded-full bg-white/90 border border-stone-200 shadow-sm overflow-hidden">
            <button
              onClick={() => setShowOriginal(false)}
              className={`text-[11px] font-medium px-3 py-1 transition-colors ${
                !showOriginal
                  ? "bg-stone-900 text-white"
                  : "text-stone-500 hover:text-stone-700"
              }`}
            >
              Your version
            </button>
            <button
              onClick={() => setShowOriginal(true)}
              className={`text-[11px] font-medium px-3 py-1 transition-colors ${
                showOriginal
                  ? "bg-stone-900 text-white"
                  : "text-stone-500 hover:text-stone-700"
              }`}
            >
              Original
            </button>
          </div>

          <CanvasZone
            key={activeDesignId}
            design={activeDesign}
            colorMap={displayColorMap}
            selectedHex={canvasPick?.hex ?? selectedHex}
            onColorPick={handleCanvasColorPick}
            canvasRef={canvasRef}
            onUndo={() => {
              if (!canvasRef.current?.undoRegionFill()) dispatch({ type: "UNDO" });
            }}
            onRedo={() => dispatch({ type: "REDO" })}
            onReset={() => {
              regionFillHistoryRef.current = [];
              overrideOriginalCountRef.current = new Map();
              overrideDisplayCountRef.current = new Map();
              overrideYarnByRgbRef.current = new Map();
              dispatch({ type: "RESET" });
              canvasRef.current?.clearRegionFills();
              setEffectivePalette(activeDesign.palette);
              setActivePresetId(null);
            }}
            canUndo={!!recolor.past.length}
            canRedo={!!recolor.future.length}
            hasChanges={hasChanges}
            tierInfo={SHARE_TIER_INFO}
            canSave={false}
            colorwayLoading={colorwayLoading}
            onRenderComplete={() => setCanvasReady(true)}
            textureEnabled={textureEnabled}
            onToggleTexture={() => setTextureEnabled((v) => !v)}
            mode={recolorMode}
            onToggleMode={() =>
              setRecolorMode((m) => (m === "global" ? "region" : "global"))
            }
            selectedFillYarn={selectedFillYarn}
            onRegionFillDelta={handleRegionFillDelta}
            onRegionUndoDelta={handleRegionUndoDelta}
            onRegionClear={handleRegionClear}
          />

          {/* Floating action buttons — share-specific (save draft + approve) */}
          <div className="absolute bottom-4 right-4 z-30 flex flex-col gap-2 items-end pointer-events-none">
            <button
              onClick={() => handleSave("draft")}
              disabled={savingStatus !== "idle" || !hasChanges}
              className="pointer-events-auto text-xs px-4 py-2 rounded-lg border border-stone-300 bg-white/90 text-stone-700 shadow hover:bg-stone-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            >
              {savingStatus === "saving" ? "Saving\u2026" : "Save draft"}
            </button>
            <button
              onClick={() => handleSave("approved")}
              disabled={savingStatus !== "idle" || !hasChanges}
              className="pointer-events-auto text-xs px-4 py-2 rounded-lg bg-stone-900 text-white shadow hover:bg-stone-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            >
              {savingStatus === "approving"
                ? "Approving\u2026"
                : "Approve this colorway"}
            </button>
          </div>
        </div>

        {/* Right panel: CompactPalette + InlineYarnPicker */}
        <div className="shrink-0 w-[13%] min-w-[160px] flex flex-col border-l border-stone-200 bg-white overflow-hidden">
          <CompactPalette
            designName={activeDesign.name}
            palette={effectivePalette}
            colorMap={recolor.current}
            initialColorMap={activeInitialColorMap}
            selectedHex={canvasPick?.hex ?? selectedHex}
            onSelectColor={handlePaletteColorPick}
            onRevert={handleRevert}
            tierInfo={SHARE_TIER_INFO}
            isUserUpload={false}
            mode={recolorMode}
            onToggleMode={() =>
              setRecolorMode((m) => (m === "global" ? "region" : "global"))
            }
          />
        </div>

        <div className="flex flex-col shrink-0 w-[16%] min-w-[200px] border-l border-stone-200 bg-white overflow-hidden">
          <InlineYarnPicker
            yarns={yarns}
            targetEntry={
              recolorMode === "region"
                ? null
                : selectedHex
                  ? (activeDesign.palette.find((e) => e.hex === selectedHex) ?? null)
                  : null
            }
            currentYarn={
              recolorMode === "region"
                ? selectedFillYarn
                : selectedHex
                  ? (recolor.current[selectedHex] ?? null)
                  : null
            }
            onPick={handleYarnPick}
            tierInfo={SHARE_TIER_INFO}
            yarnLibraryName={yarnLibraryName}
          />
        </div>
      </div>

      {/* Color popover (canvas click) */}
      {canvasPick &&
        (() => {
          const entry = activeDesign.palette.find(
            (e) => e.hex === canvasPick.hex
          );
          if (!entry) return null;
          return (
            <ColorPopover
              entry={entry}
              paletteRank={
                sortedPalette.findIndex((e) => e.hex === canvasPick.hex) + 1
              }
              assignedYarn={recolor.current[canvasPick.hex] ?? null}
              initialYarn={activeInitialColorMap[canvasPick.hex] ?? null}
              clientX={canvasPick.clientX}
              clientY={canvasPick.clientY}
              onOpenPicker={handlePopoverOpenPicker}
              onDismiss={() => setCanvasPick(null)}
              tierInfo={SHARE_TIER_INFO}
              yarnLibraryName={yarnLibraryName}
            />
          );
        })()}
    </div>
  );
}
