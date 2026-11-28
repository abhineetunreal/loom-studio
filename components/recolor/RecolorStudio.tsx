"use client";

/**
 * RecolorStudio — the colour tool screen (approved mockup, Nov 2026).
 *
 * One window, a Manual / Auto switch top-left. Manual: scheme stepper, Shuffle,
 * Randomise and History on the left; the rug in the middle; Colours-used (with
 * locks) and the yarn picker on the right. Auto: four generated options fill the
 * stage; pick one and it drops back into Manual, editable.
 *
 * Reuses the real RecolorCanvas renderer, the InlineYarnPicker, and the
 * useRecolorStudio brain, so this is a thin presentation layer over the existing
 * engine — mountable here or anywhere a design needs colouring.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { PaletteEntry, TierInfo, YarnOption } from "@/types";
import type { RecolorCanvasHandle } from "@/components/design/RecolorCanvas";
import InlineYarnPicker from "@/components/design/InlineYarnPicker";
import SaveModal from "@/components/design/SaveModal";
import SubmissionForm from "@/components/design/SubmissionForm";
import { useRecolorStudio, type StudioColorMap } from "./useRecolorStudio";

const RecolorCanvas = dynamic(() => import("@/components/design/RecolorCanvas"), { ssr: false });
const Rug3DView = dynamic(() => import("./Rug3DView"), { ssr: false });

type Design = {
  id: string;
  name: string;
  imageUrl: string;
  width: number;
  height: number;
  externalSku: string | null;
  palette: PaletteEntry[];
};

type Props = {
  design: Design;
  yarns: YarnOption[];
  initialColorMap: StudioColorMap;
  tierInfo: TierInfo;
  productName: string;
  logoUrl: string | null;
  initialLibrary?: string;
};

function isLight(hex: string): boolean {
  const h = (hex || "").replace("#", "");
  if (h.length < 6) return false;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 210;
}

export default function RecolorStudio({
  design, yarns, initialColorMap, tierInfo, productName, logoUrl, initialLibrary,
}: Props) {
  const s = useRecolorStudio({ palette: design.palette, yarns, initialColorMap, initialLibrary });
  const canvasRef = useRef<RecolorCanvasHandle | null>(null);
  const [selectedHex, setSelectedHex] = useState<string | null>(null);
  const [mode, setMode] = useState<"manual" | "auto">("manual");
  const [autoKind, setAutoKind] = useState<"full" | "slight" | "family" | "shuffle">("full");
  const [autoOptions, setAutoOptions] = useState<StudioColorMap[]>([]);
  // Auto-mode loader: generating + rendering the four preview rugs takes a
  // moment. genId forces the tiles to remount each generation so each one fires
  // onRenderComplete again; we count them and clear the loader when all are done.
  const [autoBusy, setAutoBusy] = useState(false);
  const [genId, setGenId] = useState(0);
  const autoReady = useRef(0);
  const autoExpected = useRef(0);
  const runAuto = useCallback((kind: "full" | "slight" | "family" | "shuffle") => {
    const opts = s.generateFour(kind);
    autoReady.current = 0;
    autoExpected.current = Math.min(4, opts.length);
    setAutoKind(kind);
    setAutoBusy(true);
    setGenId((g) => g + 1);
    setAutoOptions(opts);
  }, [s]);
  const onTileRendered = useCallback(() => {
    autoReady.current += 1;
    if (autoReady.current >= autoExpected.current) setAutoBusy(false);
  }, []);
  // Stage loader: shown while the Manual canvas renders — on open, on returning
  // to Manual, and on every recolour action (scheme / shuffle / randomise /
  // assign / texture / undo / redo). RecolorCanvas fires onRenderComplete only
  // once per instance, so we bump a key to remount it on each colour change;
  // the fresh instance fires onRenderComplete again, clearing the loader. The
  // overlay also swallows clicks so nothing gets rage-clicked mid-render.
  const [canvasBusy, setCanvasBusy] = useState(true);
  const [manualGen, setManualGen] = useState(0);
  useEffect(() => { if (mode === "manual") setCanvasBusy(true); }, [mode]);
  const didMountManual = useRef(false);
  useEffect(() => {
    if (!didMountManual.current) { didMountManual.current = true; return; }
    setCanvasBusy(true);
    setManualGen((g) => g + 1);
  }, [s.colorMap, s.textureEnabled]);

  // ── 2D / 3D view ───────────────────────────────────────────────────────────
  // In 3D we map the recoloured rug onto a slab. The texture is produced by an
  // off-screen RecolorCanvas (same renderer as the 2D view): on each colour
  // change we remount it, and its onRenderComplete snapshots the result into a
  // data URL that Rug3DView uploads as the slab texture.
  const [view, setView] = useState<"2d" | "3d">("2d");
  const [tex3d, setTex3d] = useState<string | null>(null);
  const [tex3dBusy, setTex3dBusy] = useState(false);
  const tex3dRef = useRef<RecolorCanvasHandle | null>(null);
  // The off-screen 3D-texture canvas stays MOUNTED (no key remount): remounting
  // it per colour change re-ran the full pixel pipeline next to the live WebGL
  // context and made mobile GPUs drop the 3D context. Instead it repaints in
  // place on colourMap/texture change, and onRenderPaint re-snapshots the result.
  useEffect(() => { if (view === "3d") setTex3dBusy(true); }, [view]);
  useEffect(() => { if (view === "3d") setTex3dBusy(true); }, [s.colorMap, s.textureEnabled]); // eslint-disable-line react-hooks/exhaustive-deps
  const onTex3dRendered = useCallback(() => {
    const url = tex3dRef.current?.getSnapshot(1024, "jpeg", 0.88) ?? null;
    if (url) { setTex3d(url); setTex3dBusy(false); }
  }, []);

  const handleCanvasPick = useCallback((hex: string) => setSelectedHex(hex), []);
  const handleYarnPick = useCallback(
    (yarn: YarnOption) => { if (selectedHex) s.assign(selectedHex, yarn); },
    [selectedHex, s]
  );

  const generate = useCallback(() => runAuto(autoKind), [runAuto, autoKind]);
  const openOption = useCallback(
    (map: StudioColorMap) => { s.applyMap(map, "auto"); setMode("manual"); },
    [s]
  );

  const targetEntry = selectedHex
    ? design.palette.find((e) => e.hex === selectedHex) ?? null
    : null;

  // ── Shortlist (save) + Request colourway modals ────────────────────────────
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showSubmissionForm, setShowSubmissionForm] = useState(false);
  const [showSavedToast, setShowSavedToast] = useState(false);

  // ── Mobile layout ──────────────────────────────────────────────────────────
  const isMobile = useIsMobile();
  const [mobileTab, setMobileTab] = useState<"colours" | "design">("colours");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const getSnapshot = useCallback((): string | null => {
    return canvasRef.current?.getSnapshot(1200, "png") ?? null;
  }, []);

  const handleSaveSubmit = useCallback(async (name: string, folderId: string | null) => {
    const snapshot = getSnapshot();
    // Build the operations payload matching the classic save format
    const globalMap: Record<string, { hex: string; yarnCode: string; yarnId: string }> = {};
    for (const row of s.coloursUsed) {
      if (row.current) {
        globalMap[row.hex] = { hex: row.current.hex, yarnCode: row.current.code, yarnId: row.current.id };
      }
    }
    const res = await fetch("/api/colorways", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        designId: design.id,
        name,
        operations: { globalMap },
        folderId,
        snapshotDataUrl: snapshot,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error ?? "Save failed");
    }
    setShowSavedToast(true);
    setTimeout(() => setShowSavedToast(false), 2500);
  }, [getSnapshot, s.coloursUsed, design.id]);

  const handleDownload = useCallback(() => {
    const dataUrl = canvasRef.current?.getSnapshot(8000, "png", 1.0) ?? null;
    if (!dataUrl) return;
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `${design.name.replace(/[^a-zA-Z0-9_-]/g, "_")}_colourway.png`;
    a.click();
  }, [design.name]);

  const INK = "#2c2a24", SOFT = "#6f6a5d", FAINT = "#9a9484", HAIR = "#e7e0d2", PANEL = "#f6f2ea";

  // ───────────────────────────────────────────────────────────────────────────
  // MOBILE LAYOUT — stage on top, controls in a bottom panel, yarn picker and
  // menu as sheets. Reuses the same hook/state/handlers as the desktop tree.
  // ───────────────────────────────────────────────────────────────────────────
  if (isMobile) {
    const aspect = design.width / design.height;
    const openPicker = (hex: string) => { setSelectedHex(hex); setPickerOpen(true); };
    return (
      <div className="flex flex-col h-full w-full overflow-hidden" style={{ background: "#efe9dd", color: INK, fontFamily: "-apple-system, Inter, system-ui, sans-serif" }}>
        {/* HEADER */}
        <header className="shrink-0 flex items-center gap-2" style={{ height: 48, padding: "0 10px", background: PANEL, borderBottom: `1px solid ${HAIR}` }}>
          {logoUrl
            ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={logoUrl} alt="" crossOrigin="anonymous" style={{ height: 22, width: 22, borderRadius: 6, objectFit: "contain" }} />
            : <span style={{ height: 22, width: 22, borderRadius: 7, background: "#9a9566" }} />}
          <span style={{ fontSize: 14, fontWeight: 600 }} className="truncate">{design.name}</span>
          <div className="ml-auto flex items-center gap-0.5">
            <IconBtn label="Undo" disabled={!s.canUndo} onClick={s.undo}><UndoI /></IconBtn>
            <IconBtn label="Redo" disabled={!s.canRedo} onClick={s.redo}><RedoI /></IconBtn>
            <button aria-label="Menu" onClick={() => setMenuOpen(true)} style={{ width: 34, height: 34, border: 0, background: "transparent", borderRadius: 9, color: "#6f6a5d", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
            </button>
          </div>
        </header>

        {/* MODE + VIEW */}
        <div className="shrink-0 flex items-center gap-2" style={{ padding: "8px 10px", borderBottom: `1px solid ${HAIR}`, background: PANEL }}>
          <div className="flex flex-1" style={{ background: "#ece5d6", borderRadius: 10, padding: 3 }}>
            <Seg active={mode === "manual"} onClick={() => setMode("manual")}><PencilI /> Manual</Seg>
            <Seg active={mode === "auto"} onClick={() => { setMode("auto"); if (!autoOptions.length) runAuto(autoKind); }}><SparkI /> Auto</Seg>
          </div>
          {mode === "manual" && (
            <div className="flex" style={{ background: "#ece5d6", borderRadius: 10, padding: 3 }}>
              <ViewSeg active={view === "2d"} onClick={() => setView("2d")}><GridI /></ViewSeg>
              <ViewSeg active={view === "3d"} onClick={() => setView("3d")}><CubeI /></ViewSeg>
            </div>
          )}
        </div>

        {/* STAGE */}
        <main className="flex-1 min-h-0 relative" style={{ background: "#efe9dd" }}>
          {mode === "manual" ? (
            view === "2d" ? (
              <ZoomStage aspect={aspect} canvasRef={canvasRef} busy={canvasBusy}>
                <RecolorCanvas
                  key={manualGen} ref={canvasRef}
                  imageUrl={design.imageUrl} width={design.width} height={design.height}
                  palette={design.palette} colorMap={s.colorMap} selectedHex={selectedHex}
                  onColorPick={handleCanvasPick} textureEnabled={s.textureEnabled}
                  designName={design.name} swatchScale={2}
                  onRenderComplete={() => setCanvasBusy(false)} mode="global"
                />
              </ZoomStage>
            ) : (
              <div className="w-full h-full relative">
                <Rug3DView textureUrl={tex3d} aspect={aspect} />
                {tex3dBusy && <LoaderOverlay label="Rendering 3D…" />}
                {/* Off-screen texture source — FLAT (no wool texture) and small, so
                    it stays light next to the live WebGL scene (the textured detail
                    lives in the Top view). */}
                <div aria-hidden style={{ position: "absolute", left: -99999, top: 0, width: 560, height: Math.round(560 / aspect), pointerEvents: "none" }}>
                  <RecolorCanvas
                    ref={tex3dRef}
                    imageUrl={design.imageUrl} width={design.width} height={design.height}
                    palette={design.palette} colorMap={s.colorMap} selectedHex={null}
                    onColorPick={() => {}} textureEnabled={false}
                    designName={design.name} swatchScale={2}
                    onRenderPaint={onTex3dRendered} mode="global"
                  />
                </div>
              </div>
            )
          ) : (
            <div className="w-full h-full flex flex-col min-h-0 relative" style={{ padding: 12 }}>
              <div className="shrink-0" style={{ fontSize: 12, color: SOFT, textAlign: "center", marginBottom: 10 }}>Tap an option to open and edit it</div>
              <div className="flex-1 min-h-0 grid" style={{ gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 10 }}>
                {autoOptions.slice(0, 4).map((opt, i) => (
                  <Contain key={`${genId}-${i}`} aspect={aspect} onClick={() => openOption(opt)} boxStyle={{ borderRadius: 8, overflow: "hidden", boxShadow: "0 4px 16px rgba(44,42,36,.14)", background: "#fff", cursor: "pointer", border: 0, padding: 0 }}>
                    <div className="w-full h-full" style={{ pointerEvents: "none" }}>
                      <RecolorCanvas imageUrl={design.imageUrl} width={design.width} height={design.height} palette={design.palette} colorMap={opt} selectedHex={null} onColorPick={() => {}} textureEnabled={false} designName={design.name} onRenderComplete={onTileRendered} mode="global" />
                    </div>
                    <span className="absolute" style={{ left: 8, bottom: 8, background: "rgba(44,42,36,.8)", color: "#fff", fontSize: 10, padding: "2px 7px", borderRadius: 6, zIndex: 2 }}>{i + 1}</span>
                  </Contain>
                ))}
              </div>
              {autoBusy && <LoaderOverlay label="Generating options…" />}
            </div>
          )}
        </main>

        {/* BOTTOM CONTROLS */}
        <div className="shrink-0 flex flex-col" style={{ background: PANEL, borderTop: `1px solid ${HAIR}`, maxHeight: "42vh" }}>
          {/* tabs */}
          <div className="flex shrink-0" style={{ padding: "8px 10px 4px", gap: 6 }}>
            <MTab active={mobileTab === "colours"} onClick={() => setMobileTab("colours")}>Colours used</MTab>
            <MTab active={mobileTab === "design"} onClick={() => setMobileTab("design")}>{mode === "auto" ? "Style" : "Adjust"}</MTab>
          </div>

          {mobileTab === "colours" ? (
            <div className="overflow-x-auto" style={{ padding: "6px 10px 12px", WebkitOverflowScrolling: "touch" }}>
              <div className="flex gap-2" style={{ width: "max-content" }}>
                {s.coloursUsed.map((row) => {
                  const sel = selectedHex === row.hex;
                  const locked = s.lockedHexes.has(row.hex);
                  return (
                    <button key={row.hex} onClick={() => openPicker(row.hex)} className="flex flex-col items-center" style={{ width: 62, padding: 7, borderRadius: 11, background: sel ? "#fff" : "#fff", boxShadow: sel ? `0 0 0 2px ${INK}` : `0 0 0 1px ${HAIR}`, border: 0, flex: "none" }}>
                      <span style={{ width: 38, height: 38, borderRadius: 8, background: row.displayHex, border: isLight(row.displayHex) ? `1px solid #cfc6b2` : "none", position: "relative" }}>
                        {locked && <span style={{ position: "absolute", top: -4, right: -4, width: 15, height: 15, borderRadius: "50%", background: INK, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}><LockI open={false} /></span>}
                      </span>
                      <span className="truncate" style={{ fontSize: 10, fontFamily: "ui-monospace,monospace", marginTop: 4, maxWidth: 52 }}>{row.current?.code ?? row.hex}</span>
                      <span style={{ fontSize: 9, color: FAINT }}>{row.percentage.toFixed(1)}%</span>
                    </button>
                  );
                })}
              </div>
              <p style={{ fontSize: 11, color: FAINT, marginTop: 8 }}>Tap a colour to change its yarn.</p>
            </div>
          ) : (
            <div className="overflow-y-auto" style={{ padding: "6px 12px 14px" }}>
              {mode === "manual" ? (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-1.5">
                    <StepBtn label="Previous scheme" onClick={s.scheme.prev}>‹</StepBtn>
                    <div className="flex-1 flex items-center" style={{ height: 40, border: `1px solid ${HAIR}`, background: "#fff", borderRadius: 9, padding: "0 10px" }}>
                      <span className="flex gap-0.5">{s.coloursUsed.slice(0, 6).map((r) => <span key={r.hex} style={{ width: 9, height: 20, borderRadius: 2, background: r.displayHex, border: isLight(r.displayHex) ? `1px solid ${HAIR}` : "none" }} />)}</span>
                      <span className="ml-auto" style={{ fontSize: 11, color: FAINT, fontFamily: "ui-monospace,monospace" }}>{s.scheme.index < 0 ? "Orig" : `${s.scheme.index + 1}/${s.scheme.total}`}</span>
                    </div>
                    <StepBtn label="Next scheme" onClick={s.scheme.next}>›</StepBtn>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={s.scheme.random} style={{ ...softBtn, flex: 1, justifyContent: "center" }}><DiceI /> Random</button>
                    <button onClick={s.shuffle} disabled={!s.hasAssignments} style={{ ...softBtn, flex: 1, justifyContent: "center" }}><ShuffleI /> Shuffle</button>
                    <button onClick={s.randomise} disabled={!s.hasAssignments} style={{ ...softBtn, flex: 1, justifyContent: "center" }}><DiceI /> Mix</button>
                  </div>
                  <label className="flex items-center justify-between">
                    <span style={{ fontSize: 13 }}>Textured</span>
                    <Toggle on={s.textureEnabled} onClick={() => s.setTextureEnabled((v) => !v)} />
                  </label>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: SOFT, marginBottom: 6 }}>Colours from</div>
                    <LibraryPicker all={s.allLibraries} selected={s.libraries} onChange={s.setLibraries} />
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  <div className="grid grid-cols-2 gap-1.5">
                    {([["full", "Full variation"], ["slight", "Slight variation"], ["family", "Tone on tone"], ["shuffle", "Shuffle"]] as const).map(([k, t]) => (
                      <button key={k} onClick={() => runAuto(k)} className="text-left" style={{ padding: "10px 11px", border: `1px solid ${autoKind === k ? INK : HAIR}`, background: "#fff", borderRadius: 10, fontSize: 12.5, fontWeight: autoKind === k ? 600 : 500 }}>{t}</button>
                    ))}
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: SOFT, marginBottom: 6 }}>Colours from</div>
                    <LibraryPicker all={s.allLibraries} selected={s.libraries} onChange={s.setLibraries} />
                  </div>
                  <button onClick={generate} style={{ padding: 12, border: 0, background: INK, color: "#fff", borderRadius: 11, fontSize: 14, fontWeight: 500, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}><SparkI /> Generate four</button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* YARN PICKER SHEET */}
        {pickerOpen && (
          <div className="fixed inset-0 z-50 flex items-end" style={{ background: "rgba(44,42,36,.4)" }} onClick={() => setPickerOpen(false)}>
            <div onClick={(e) => e.stopPropagation()} className="w-full flex flex-col" style={{ height: "54vh", maxHeight: 440, background: PANEL, borderTopLeftRadius: 16, borderTopRightRadius: 16, overflow: "hidden", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
              <div className="shrink-0 flex items-center justify-between" style={{ padding: "12px 14px", borderBottom: `1px solid ${HAIR}` }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{selectedHex ? `Change ${s.colorMap[selectedHex]?.code ?? "colour"}` : "Pick a yarn"}</div>
                <button onClick={() => setPickerOpen(false)} style={{ width: 30, height: 30, border: 0, background: "#ece5d6", borderRadius: 8, fontSize: 16, color: INK }}>✕</button>
              </div>
              <div className="flex-1 min-h-0">
                <InlineYarnPicker
                  yarns={yarns}
                  targetEntry={targetEntry}
                  currentYarn={selectedHex ? (s.colorMap[selectedHex] ?? null) : null}
                  onPick={(yarn) => { handleYarnPick(yarn); }}
                  tierInfo={tierInfo}
                  yarnLibraryName={productName}
                  initialLibrary={initialLibrary}
                />
              </div>
            </div>
          </div>
        )}

        {/* OVERFLOW MENU SHEET */}
        {menuOpen && (
          <div className="fixed inset-0 z-50 flex items-end" style={{ background: "rgba(44,42,36,.4)" }} onClick={() => setMenuOpen(false)}>
            <div onClick={(e) => e.stopPropagation()} className="w-full flex flex-col" style={{ background: PANEL, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 10, paddingBottom: "calc(10px + env(safe-area-inset-bottom, 0px))", gap: 4 }}>
              <MenuRow onClick={() => { setMenuOpen(false); handleDownload(); }}>Download image</MenuRow>
              <MenuRow onClick={() => { setMenuOpen(false); setShowSaveModal(true); }}>Add to shortlist</MenuRow>
              <MenuRow onClick={() => { setMenuOpen(false); setShowSubmissionForm(true); }}>Request colourway</MenuRow>
              <a href={`/designs/${design.id}`} style={{ textDecoration: "none" }}><MenuRow>Classic editor</MenuRow></a>
              <button onClick={() => setMenuOpen(false)} style={{ marginTop: 4, padding: 13, border: 0, background: "#ece5d6", borderRadius: 11, fontSize: 14, fontWeight: 500, color: INK }}>Close</button>
            </div>
          </div>
        )}

        {showSaveModal && <SaveModal onSave={handleSaveSubmit} onClose={() => setShowSaveModal(false)} />}
        {showSubmissionForm && <SubmissionForm designId={design.id} designName={design.name} palette={design.palette} colorMap={s.colorMap} getSnapshot={getSnapshot} onClose={() => setShowSubmissionForm(false)} />}
        {showSavedToast && (
          <div className="fixed left-1/2 -translate-x-1/2 z-50 flex items-center gap-2" style={{ bottom: 24, background: INK, color: "#fff", padding: "10px 16px", borderRadius: 11, fontSize: 13, fontWeight: 500 }}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            Saved to shortlist
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full overflow-hidden" style={{ background: "#efe9dd", color: INK, fontFamily: "-apple-system, Inter, system-ui, sans-serif" }}>
      {/* HEADER */}
      <header className="shrink-0 flex items-center gap-4 px-4" style={{ height: 54, background: PANEL, borderBottom: `1px solid ${HAIR}` }}>
        <div className="flex items-center gap-2 min-w-0">
          {logoUrl
            ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={logoUrl} alt="" crossOrigin="anonymous" style={{ height: 24, width: 24, borderRadius: 6, objectFit: "contain" }} />
            : <span style={{ height: 23, width: 23, borderRadius: 7, background: "#9a9566" }} />}
          <span style={{ fontSize: 15, fontWeight: 600 }} className="truncate">{productName || "Loom Studio"}</span>
        </div>
        <div style={{ width: 1, height: 24, background: HAIR }} />
        <div className="flex items-baseline gap-2 min-w-0">
          <span style={{ fontSize: 14, fontWeight: 500 }} className="truncate">{design.name}</span>
          {design.externalSku && <span style={{ fontSize: 11, color: FAINT, fontFamily: "ui-monospace, monospace" }}>{design.externalSku}</span>}
        </div>
        <a
          href={`/designs/${design.id}`}
          title="Back to the classic editor"
          className="flex items-center gap-1"
          style={{ marginLeft: 10, fontSize: 12.5, color: FAINT, textDecoration: "none", whiteSpace: "nowrap" }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6" /></svg>
          Classic editor
        </a>
        <div className="ml-auto flex items-center gap-1">
          <IconBtn label="Undo" disabled={!s.canUndo} onClick={s.undo}><UndoI /></IconBtn>
          <IconBtn label="Redo" disabled={!s.canRedo} onClick={s.redo}><RedoI /></IconBtn>
          <div style={{ width: 1, height: 24, background: HAIR, margin: "0 7px" }} />
          <button onClick={handleDownload} title="Download the recoloured rug as a high-res PNG" style={{ padding: "7px 14px", border: `1px solid ${HAIR}`, background: "#fff", borderRadius: 10, fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 5 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m0 0l-6-6m6 6l6-6M5 19h14" /></svg>
            Download
          </button>
          <button onClick={() => setShowSaveModal(true)} style={{ padding: "7px 14px", border: `1px solid ${HAIR}`, background: "#fff", borderRadius: 10, fontSize: 13, fontWeight: 500 }}>Shortlist</button>
          <button onClick={() => setShowSubmissionForm(true)} style={{ padding: "7px 15px", border: 0, background: INK, color: "#fff", borderRadius: 10, fontSize: 13, fontWeight: 500 }}>Request colourway</button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* LEFT PANEL */}
        <aside className="shrink-0 flex flex-col" style={{ width: 252, background: PANEL, borderRight: `1px solid ${HAIR}` }}>
          {/* mode switch */}
          <div style={{ padding: "14px 16px 12px", borderBottom: `1px solid ${HAIR}` }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: FAINT, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 7 }}>Colour mode</div>
            <div className="flex" style={{ background: "#ece5d6", borderRadius: 11, padding: 3 }}>
              <Seg active={mode === "manual"} onClick={() => setMode("manual")}><PencilI /> Manual</Seg>
              <Seg active={mode === "auto"} onClick={() => { setMode("auto"); if (!autoOptions.length) runAuto(autoKind); }}><SparkI /> Auto</Seg>
            </div>
          </div>

          {mode === "manual" ? (
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4" style={{ padding: "14px 16px 16px" }}>
              {/* scheme */}
              <section>
                <h3 style={h3}>Scheme</h3>
                <div className="flex items-center gap-1.5">
                  <StepBtn label="Previous scheme" onClick={s.scheme.prev}>‹</StepBtn>
                  <div className="flex-1 min-w-0 flex items-center gap-2" style={{ height: 42, border: `1px solid ${HAIR}`, background: "#fff", borderRadius: 9, padding: "0 10px" }}>
                    <span className="flex gap-0.5">
                      {s.coloursUsed.slice(0, 5).map((r) => (
                        <span key={r.hex} style={{ width: 10, height: 22, borderRadius: 2, background: r.displayHex, border: isLight(r.displayHex) ? `1px solid ${HAIR}` : "none" }} />
                      ))}
                    </span>
                    <span className="ml-auto" style={{ fontSize: 11, color: FAINT, fontFamily: "ui-monospace,monospace" }}>{s.scheme.index < 0 ? "Orig" : s.scheme.index + 1}</span>
                  </div>
                  <StepBtn label="Next scheme" onClick={s.scheme.next}>›</StepBtn>
                </div>
                <p style={{ margin: "6px 2px 0", fontSize: 11.5, color: FAINT }}>{s.scheme.index < 0 ? "Original" : `Scheme ${s.scheme.index + 1}`} · 1 of {s.scheme.total}</p>
                <button onClick={s.scheme.random} style={{ ...softBtn, width: "100%", marginTop: 9, justifyContent: "center" }}><DiceI /> Random scheme</button>
              </section>

              <div style={{ height: 1, background: HAIR }} />

              {/* mix */}
              <section>
                <h3 style={h3}>Mix it up</h3>
                <div className="flex gap-1.5">
                  <button onClick={s.shuffle} disabled={!s.hasAssignments} style={{ ...softBtn, flex: 1, justifyContent: "center", fontWeight: 500 }}><ShuffleI /> Shuffle</button>
                  <button onClick={s.randomise} disabled={!s.hasAssignments} style={{ ...softBtn, flex: 1, justifyContent: "center", fontWeight: 500 }}><DiceI /> Randomise</button>
                </div>
                <label className="flex items-center justify-between" style={{ marginTop: 12, cursor: "pointer" }}>
                  <span style={{ fontSize: 13 }}>Available yarns only</span>
                  <Toggle on={s.availableOnly} onClick={() => s.setAvailableOnly((v) => !v)} />
                </label>
                <p style={{ margin: "9px 2px 0", fontSize: 11.5, lineHeight: 1.5, color: FAINT }}>Locked colours stay put. Shuffle swaps places; Randomise draws new yarns.</p>
              </section>

              <div style={{ height: 1, background: HAIR }} />

              {/* colours from — which yarn libraries the generators pull from */}
              <section>
                <h3 style={h3}>Colours from</h3>
                <LibraryPicker all={s.allLibraries} selected={s.libraries} onChange={s.setLibraries} />
              </section>

              <div style={{ height: 1, background: HAIR }} />

              {/* history */}
              <section>
                <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
                  <h3 style={{ ...h3, margin: 0 }}>History</h3>
                  <span style={{ fontSize: 11, color: FAINT }}>{s.history.length}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {s.history.slice(0, 12).map((v) => (
                    <button key={v.id} onClick={() => s.restoreVersion(v.id)} className="text-left" title={v.label}>
                      <span className="block rounded-md overflow-hidden" style={{ boxShadow: v.id === s.currentVersionId ? `0 0 0 2.5px ${INK}` : `0 0 0 1px ${HAIR}` }}>
                        <span className="flex" style={{ height: 34 }}>
                          {rowsFromMap(v.map, design.palette).map((hex, i) => (
                            <span key={i} style={{ flex: 1, background: hex }} />
                          ))}
                        </span>
                      </span>
                      <span className="block truncate" style={{ fontSize: 10, color: FAINT, marginTop: 3 }}>{v.id === s.currentVersionId ? "Now" : v.label}</span>
                    </button>
                  ))}
                </div>
              </section>
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4" style={{ padding: "16px" }}>
              <section>
                <h3 style={h3}>Style of change</h3>
                <div className="flex flex-col gap-1.5">
                  {([["full", "Full variation", "bold, all-new palette"], ["slight", "Slight variation", "keeps it recognisable"], ["family", "Tone on tone", "one colour family"], ["shuffle", "Shuffle", "same colours, new places"]] as const).map(([k, t, d]) => (
                    <button key={k} onClick={() => runAuto(k)} className="flex items-center gap-2.5 text-left" style={{ padding: "11px 12px", border: `1px solid ${autoKind === k ? INK : HAIR}`, background: "#fff", borderRadius: 11 }}>
                      <span style={{ width: 15, height: 15, borderRadius: "50%", border: autoKind === k ? `5px solid ${INK}` : `1.5px solid #cfc6b2`, flex: "none" }} />
                      <span><span className="block" style={{ fontSize: 13, fontWeight: autoKind === k ? 600 : 500 }}>{t}</span><span className="block" style={{ fontSize: 11, color: FAINT }}>{d}</span></span>
                    </button>
                  ))}
                </div>
              </section>
              <section>
                <h3 style={h3}>Colours from</h3>
                <LibraryPicker all={s.allLibraries} selected={s.libraries} onChange={s.setLibraries} />
              </section>
              <button onClick={generate} style={{ padding: 12, border: 0, background: INK, color: "#fff", borderRadius: 11, fontSize: 14, fontWeight: 500, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}><SparkI /> Generate four</button>
              <p style={{ margin: "auto 2px 0", fontSize: 11.5, lineHeight: 1.5, color: FAINT }}>Tap an option in the middle to open it full-size and keep editing in Manual.</p>
            </div>
          )}
        </aside>

        {/* STAGE */}
        <main className="flex-1 min-w-0 min-h-0 relative flex flex-col" style={{ padding: mode === "auto" ? 20 : 30, background: "#efe9dd" }}>
          {mode === "manual" ? (
            <div className="w-full h-full flex flex-col min-h-0 relative">
              {/* 2D / 3D view switch */}
              <div className="shrink-0 flex justify-center" style={{ marginBottom: 12 }}>
                <div className="flex" style={{ background: "#ece5d6", borderRadius: 10, padding: 3 }}>
                  <ViewSeg active={view === "2d"} onClick={() => setView("2d")}><GridI /> Top view</ViewSeg>
                  <ViewSeg active={view === "3d"} onClick={() => setView("3d")}><CubeI /> 3D view</ViewSeg>
                </div>
              </div>

              <div className="flex-1 min-h-0 relative">
                {view === "2d" ? (
                  <ZoomStage
                    aspect={design.width / design.height}
                    canvasRef={canvasRef}
                    busy={canvasBusy}
                    footerLeft={
                      <button onClick={() => s.setTextureEnabled((v) => !v)} className="flex items-center gap-2" style={{ padding: "7px 12px", border: `1px solid ${HAIR}`, background: "rgba(255,255,255,.94)", borderRadius: 9, fontSize: 12 }}>
                        <span style={{ width: 12, height: 12, borderRadius: 4, background: s.textureEnabled ? INK : "transparent", border: s.textureEnabled ? "none" : `1px solid ${HAIR}` }} /> Textured
                      </button>
                    }
                  >
                    <RecolorCanvas
                      key={manualGen}
                      ref={canvasRef}
                      imageUrl={design.imageUrl}
                      width={design.width}
                      height={design.height}
                      palette={design.palette}
                      colorMap={s.colorMap}
                      selectedHex={selectedHex}
                      onColorPick={handleCanvasPick}
                      textureEnabled={s.textureEnabled}
                      designName={design.name}
                      swatchScale={2}
                      onRenderComplete={() => setCanvasBusy(false)}
                      mode="global"
                    />
                  </ZoomStage>
                ) : (
                  <div className="w-full h-full relative" style={{ borderRadius: 12, overflow: "hidden" }}>
                    <Rug3DView textureUrl={tex3d} aspect={design.width / design.height} />
                    <div className="absolute" style={{ right: 14, bottom: 14, fontSize: 11, color: SOFT, background: "rgba(255,255,255,.85)", padding: "5px 10px", borderRadius: 8, zIndex: 3 }}>Drag to orbit · scroll to zoom</div>
                    {tex3dBusy && <LoaderOverlay label="Rendering 3D…" />}
                    {/* Off-screen texture source — FLAT + small, for a light, stable
                        3D view (textured detail is in the Top view). */}
                    <div aria-hidden style={{ position: "absolute", left: -99999, top: 0, width: 560, height: Math.round(560 * (design.height / design.width)), pointerEvents: "none" }}>
                      <RecolorCanvas
                        ref={tex3dRef}
                        imageUrl={design.imageUrl}
                        width={design.width}
                        height={design.height}
                        palette={design.palette}
                        colorMap={s.colorMap}
                        selectedHex={null}
                        onColorPick={() => {}}
                        textureEnabled={false}
                        designName={design.name}
                        swatchScale={2}
                        onRenderPaint={onTex3dRendered}
                        mode="global"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="w-full h-full flex flex-col min-h-0 relative">
              <div className="shrink-0 flex items-center justify-center gap-2" style={{ marginBottom: 14, fontSize: 13, color: SOFT }}>
                Four ways to colour {design.name} — tap the one you like to open it and edit
              </div>
              <div className="flex-1 min-h-0 grid" style={{ gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 18 }}>
                {autoOptions.slice(0, 4).map((opt, i) => (
                  <Contain
                    key={`${genId}-${i}`}
                    aspect={design.width / design.height}
                    onClick={() => openOption(opt)}
                    boxStyle={{ borderRadius: 8, overflow: "hidden", boxShadow: "0 6px 22px rgba(44,42,36,.14)", background: "#fff", cursor: "pointer", border: 0, padding: 0 }}
                  >
                    {/* real recoloured rug preview (flat — no wool texture — for speed) */}
                    <div className="w-full h-full" style={{ pointerEvents: "none" }}>
                      <RecolorCanvas
                        imageUrl={design.imageUrl}
                        width={design.width}
                        height={design.height}
                        palette={design.palette}
                        colorMap={opt}
                        selectedHex={null}
                        onColorPick={() => {}}
                        textureEnabled={false}
                        designName={design.name}
                        onRenderComplete={onTileRendered}
                        mode="global"
                      />
                    </div>
                    <span className="absolute" style={{ left: 10, bottom: 10, background: "rgba(44,42,36,.8)", color: "#fff", fontSize: 11, padding: "3px 9px", borderRadius: 7, zIndex: 2 }}>Option {i + 1}</span>
                  </Contain>
                ))}
              </div>
              {autoBusy && <LoaderOverlay label="Generating options…" />}
            </div>
          )}
        </main>

        {/* COLOURS USED */}
        <aside className="shrink-0 flex flex-col" style={{ width: 212, background: PANEL, borderLeft: `1px solid ${HAIR}` }}>
          <div style={{ padding: "14px 16px 10px", borderBottom: `1px solid ${HAIR}` }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Colours used</div>
            <div style={{ fontSize: 11.5, color: FAINT, marginTop: 2 }}>{s.coloursUsed.length} · tap to change · lock to keep</div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto" style={{ padding: "8px 10px" }}>
            {s.coloursUsed.map((row) => {
              const locked = s.lockedHexes.has(row.hex);
              const sel = selectedHex === row.hex;
              return (
                <div key={row.hex} className="flex items-center gap-2.5" style={{ padding: 8, borderRadius: 10, marginBottom: 3, background: sel ? "#fff" : "transparent", boxShadow: sel ? `0 0 0 1.5px ${INK}` : "none" }}>
                  <button onClick={() => setSelectedHex(row.hex)} className="flex items-center gap-2.5 flex-1 min-w-0 text-left">
                    <span style={{ width: 28, height: 28, borderRadius: 7, flex: "none", background: row.displayHex, border: isLight(row.displayHex) ? `1px solid #cfc6b2` : "none" }} />
                    <span className="flex-1 min-w-0">
                      <span className="block truncate" style={{ fontSize: 12, fontFamily: "ui-monospace,monospace" }}>{row.current?.code ?? row.hex}</span>
                      <span className="block" style={{ fontSize: 10, color: FAINT }}>{row.percentage.toFixed(1)}%</span>
                    </span>
                  </button>
                  <button aria-label={locked ? "Unlock" : "Lock"} onClick={() => s.toggleLock(row.hex)} style={{ width: 26, height: 26, flex: "none", border: 0, background: locked ? INK : "transparent", borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", color: locked ? "#fff" : "#c3bba6" }}>
                    <LockI open={!locked} />
                  </button>
                </div>
              );
            })}
          </div>
        </aside>

        {/* YARN PICKER (reused) */}
        <aside className="shrink-0 flex flex-col overflow-hidden" style={{ width: 238, background: PANEL, borderLeft: `1px solid ${HAIR}` }}>
          <InlineYarnPicker
            yarns={yarns}
            targetEntry={targetEntry}
            currentYarn={selectedHex ? (s.colorMap[selectedHex] ?? null) : null}
            onPick={handleYarnPick}
            tierInfo={tierInfo}
            yarnLibraryName={productName}
            initialLibrary={initialLibrary}
          />
        </aside>
      </div>

      {/* ── Modals ──────────────────────────────────────────────────────────── */}
      {showSaveModal && (
        <SaveModal
          onSave={handleSaveSubmit}
          onClose={() => setShowSaveModal(false)}
        />
      )}

      {showSubmissionForm && (
        <SubmissionForm
          designId={design.id}
          designName={design.name}
          palette={design.palette}
          colorMap={s.colorMap}
          getSnapshot={getSnapshot}
          onClose={() => setShowSubmissionForm(false)}
        />
      )}

      {/* Saved toast */}
      {showSavedToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-lg" style={{ background: INK, color: "#fff" }}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <span style={{ fontSize: 13, fontWeight: 500 }}>Saved to shortlist</span>
        </div>
      )}
    </div>
  );
}

// ── small style helpers ─────────────────────────────────────────────────────────
const h3: React.CSSProperties = { margin: "0 0 9px", fontSize: 12, fontWeight: 600, color: "#6f6a5d" };
const softBtn: React.CSSProperties = { display: "flex", alignItems: "center", gap: 7, padding: "9px 6px", border: "1px solid #e7e0d2", background: "#fff", borderRadius: 10, fontSize: 12.5, cursor: "pointer" };

function ChevI() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9a9484" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>;
}
function Check({ on }: { on: boolean }) {
  return (
    <span style={{ width: 15, height: 15, flex: "none", borderRadius: 4, border: on ? "none" : "1.5px solid #cfc6b2", background: on ? "#2c2a24" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
      {on && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5"><path d="M20 6L9 17l-5-5" /></svg>}
    </span>
  );
}

/**
 * LibraryPicker — choose which yarn libraries the generators draw from:
 * "Any library" (all), one library only ("current palette"), or a chosen few.
 */
function LibraryPicker({ all, selected, onChange }: { all: string[]; selected: Set<string>; onChange: (s: Set<string>) => void }) {
  const [open, setOpen] = useState(false);
  if (all.length <= 1) {
    return <div style={{ ...softBtn, width: "100%", justifyContent: "space-between", cursor: "default", color: "#6f6a5d" }}>{all[0] ?? "—"}</div>;
  }
  const isAll = selected.size === 0 || selected.size >= all.length;
  const label = isAll ? "Any library" : selected.size === 1 ? [...selected][0] : `${selected.size} libraries`;
  const toggle = (lib: string) => {
    if (isAll) { onChange(new Set([lib])); return; }
    const next = new Set(selected);
    if (next.has(lib)) { if (next.size > 1) next.delete(lib); } else next.add(lib);
    onChange(next.size >= all.length ? new Set(all) : next);
  };
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between" style={{ ...softBtn, width: "100%" }}>
        <span className="truncate" style={{ fontSize: 12.5 }}>{label}</span>
        <ChevI />
      </button>
      {open && (
        <>
          <div className="fixed inset-0" style={{ zIndex: 19 }} onClick={() => setOpen(false)} />
          <div className="absolute" style={{ zIndex: 20, top: "calc(100% + 4px)", left: 0, right: 0, background: "#fff", border: "1px solid #e7e0d2", borderRadius: 10, boxShadow: "0 10px 30px rgba(44,42,36,.16)", padding: 6, maxHeight: 240, overflowY: "auto" }}>
            <button onClick={() => onChange(new Set(all))} className="w-full flex items-center gap-2 text-left" style={{ padding: "8px 9px", borderRadius: 8, border: 0, background: isAll ? "#f3eee2" : "transparent", fontSize: 12.5, cursor: "pointer" }}>
              <Check on={isAll} /> Any library
            </button>
            <div style={{ height: 1, background: "#efe9dd", margin: "4px 2px" }} />
            {all.map((lib) => (
              <button key={lib} onClick={() => toggle(lib)} className="w-full flex items-center gap-2 text-left" style={{ padding: "8px 9px", borderRadius: 8, border: 0, background: "transparent", fontSize: 12.5, cursor: "pointer" }}>
                <Check on={!isAll && selected.has(lib)} /> <span className="truncate">{lib}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Full-cover loading overlay with a spinner; swallows clicks (no rage-clicking).
function LoaderOverlay({ label }: { label: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ zIndex: 5, background: "rgba(239,233,221,.72)", cursor: "default" }}>
      <svg width="34" height="34" viewBox="0 0 50 50" aria-label="Loading">
        <circle cx="25" cy="25" r="20" fill="none" stroke="#d8d0be" strokeWidth="5" />
        <circle cx="25" cy="25" r="20" fill="none" stroke="#2c2a24" strokeWidth="5" strokeLinecap="round" strokeDasharray="90 160">
          <animateTransform attributeName="transform" type="rotate" from="0 25 25" to="360 25 25" dur="0.9s" repeatCount="indefinite" />
        </circle>
      </svg>
      <span style={{ marginTop: 12, fontSize: 12.5, color: "#6f685a" }}>{label}</span>
    </div>
  );
}

function rowsFromMap(map: StudioColorMap, palette: PaletteEntry[]): string[] {
  // distinct display colours, ordered by area, for lightweight previews/strips
  const sorted = palette.filter((e) => e.percentage >= 0.05).slice().sort((a, b) => b.percentage - a.percentage);
  const out = sorted.map((e) => map[e.hex]?.hex ?? e.hex);
  return out.length ? out : ["#DDDDD3"];
}

// Keep the panned rug inside the viewport once zoomed in.
function clampPan(panX: number, panY: number, zoom: number, fitW: number, fitH: number, zoneW: number, zoneH: number) {
  if (zoom <= 1) return { x: 0, y: 0 };
  const maxX = Math.max(0, (fitW * zoom - zoneW) / 2);
  const maxY = Math.max(0, (fitH * zoom - zoneH) / 2);
  return { x: Math.max(-maxX, Math.min(maxX, panX)), y: Math.max(-maxY, Math.min(maxY, panY)) };
}

/**
 * ZoomStage — the Manual rug stage with object-contain fit, scroll/pinch zoom,
 * drag-to-pan and a zoom slider. The rug is laid out at its contain-fit size
 * (×zoom) and centred, so it never shrinks or top-aligns; a transparent overlay
 * distinguishes a pan-drag from a tap (which forwards to the canvas colour pick).
 */
function ZoomStage({
  aspect,
  canvasRef,
  children,
  footerLeft,
  busy,
}: {
  aspect: number;
  canvasRef: React.RefObject<RecolorCanvasHandle | null>;
  children: React.ReactNode;
  footerLeft?: React.ReactNode;
  busy?: boolean;
}) {
  const HAIR = "#e7e0d2", INK = "#2c2a24", FAINT = "#9a9484";
  const zoneRef = useRef<HTMLDivElement>(null);
  const [zone, setZone] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const zoomRef = useRef(1), panRef = useRef({ x: 0, y: 0 }), zoneR = useRef({ w: 0, h: 0 });
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panRef.current = pan; }, [pan]);
  useEffect(() => { zoneR.current = zone; }, [zone]);

  useEffect(() => {
    const el = zoneRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setZone((p) => (Math.round(p.w) === Math.round(r.width) && Math.round(p.h) === Math.round(r.height) ? p : { w: r.width, h: r.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitOf = (zw: number, zh: number) => (zw > 0 && zh > 0 ? (zw / zh > aspect ? { fw: zh * aspect, fh: zh } : { fw: zw, fh: zw / aspect }) : { fw: 0, fh: 0 });
  const fit = fitOf(zone.w, zone.h);

  // wheel zoom toward the cursor
  useEffect(() => {
    const el = zoneRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const { w: zw, h: zh } = zoneR.current;
      const cz = zoomRef.current, cp = panRef.current;
      const f = zw / zh > aspect ? { fw: zh * aspect, fh: zh } : { fw: zw, fh: zw / aspect };
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const nz = Math.max(1, Math.min(4, cz * factor));
      const r = el!.getBoundingClientRect();
      const mx = e.clientX - r.left - zw / 2, my = e.clientY - r.top - zh / 2;
      const ratio = nz / cz;
      const np = clampPan(mx * (1 - ratio) + cp.x * ratio, my * (1 - ratio) + cp.y * ratio, nz, f.fw, f.fh, zw, zh);
      zoomRef.current = nz; panRef.current = np; setZoom(nz); setPan(np);
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [aspect]);

  // Gestures: one finger pans / taps-to-pick; two fingers pinch-zoom.
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ dist: number; zoom: number; panX: number; panY: number; midX: number; midY: number } | null>(null);

  const beginPinch = () => {
    const el = zoneRef.current;
    if (!el || pointersRef.current.size < 2) return;
    const [p1, p2] = [...pointersRef.current.values()];
    const r = el.getBoundingClientRect();
    pinchRef.current = {
      dist: Math.hypot(p2.x - p1.x, p2.y - p1.y),
      zoom: zoomRef.current, panX: panRef.current.x, panY: panRef.current.y,
      midX: (p1.x + p2.x) / 2 - r.left, midY: (p1.y + p2.y) / 2 - r.top,
    };
    draggingRef.current = true; // a pinch is never a tap
  };

  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointer not capturable */ }
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) { beginPinch(); return; }
    startRef.current = { x: e.clientX, y: e.clientY };
    draggingRef.current = false; setDragging(false);
  };

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const pt = pointersRef.current.get(e.pointerId);
    if (pt) { pt.x = e.clientX; pt.y = e.clientY; }

    // Two-finger pinch zoom (toward the pinch midpoint) + two-finger pan.
    if (pointersRef.current.size >= 2 && pinchRef.current) {
      const el = zoneRef.current;
      if (!el) return;
      const [p1, p2] = [...pointersRef.current.values()];
      const base = pinchRef.current;
      const { w: zw, h: zh } = zoneR.current;
      const r = el.getBoundingClientRect();
      const curMidX = (p1.x + p2.x) / 2 - r.left, curMidY = (p1.y + p2.y) / 2 - r.top;
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const nz = Math.max(1, Math.min(4, base.zoom * (dist / base.dist)));
      const ratio = nz / base.zoom;
      const mx = base.midX - zw / 2, my = base.midY - zh / 2;
      const nx = mx * (1 - ratio) + base.panX * ratio + (curMidX - base.midX);
      const ny = my * (1 - ratio) + base.panY * ratio + (curMidY - base.midY);
      const np = clampPan(nx, ny, nz, fit.fw, fit.fh, zw, zh);
      zoomRef.current = nz; panRef.current = np; setZoom(nz); setPan(np);
      return;
    }

    // Single-finger pan / tap.
    if (!startRef.current) return;
    const dx = e.clientX - startRef.current.x, dy = e.clientY - startRef.current.y;
    if (!draggingRef.current && Math.hypot(dx, dy) > 4) { draggingRef.current = true; setDragging(true); }
    if (draggingRef.current && zoomRef.current > 1) {
      const { w: zw, h: zh } = zoneR.current;
      const np = clampPan(panRef.current.x + dx, panRef.current.y + dy, zoomRef.current, fit.fw, fit.fh, zw, zh);
      startRef.current = { x: e.clientX, y: e.clientY }; panRef.current = np; setPan(np);
    }
  };

  const up = (e: React.PointerEvent<HTMLDivElement>) => {
    const hadTwo = pointersRef.current.size >= 2;
    pointersRef.current.delete(e.pointerId);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 1) {
      // One finger lifted mid-pinch — keep panning with the finger still down.
      const [rem] = [...pointersRef.current.values()];
      startRef.current = { x: rem.x, y: rem.y };
      draggingRef.current = true;
      return;
    }
    if (pointersRef.current.size === 0) {
      if (!draggingRef.current && !hadTwo) canvasRef.current?.pickColorAt(e.clientX, e.clientY);
      startRef.current = null; draggingRef.current = false; setDragging(false);
    }
  };

  const setZoomTo = (z: number) => {
    const nz = Math.max(1, Math.min(4, z));
    const np = clampPan(panRef.current.x, panRef.current.y, nz, fit.fw, fit.fh, zone.w, zone.h);
    zoomRef.current = nz; panRef.current = np; setZoom(nz); setPan(np);
  };

  const cursor = zoom === 1 ? "crosshair" : dragging ? "grabbing" : "grab";

  return (
    <div ref={zoneRef} className="absolute inset-0 min-h-0 min-w-0 overflow-hidden">
      {fit.fw > 0 && (
        <div
          className="absolute"
          style={{ left: "50%", top: "50%", transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px))`, width: fit.fw * zoom, height: fit.fh * zoom, boxShadow: "0 10px 36px rgba(44,42,36,.15)", borderRadius: 4, overflow: "hidden" }}
        >
          {children}
        </div>
      )}
      {/* transparent overlay: pan when zoomed, tap to pick */}
      <div className="absolute inset-0" style={{ cursor, zIndex: 1, touchAction: "none" }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
      {footerLeft && <div className="absolute" style={{ left: 12, bottom: 12, zIndex: 2 }}>{footerLeft}</div>}
      {/* zoom control */}
      <div className="absolute flex items-center gap-1.5" style={{ right: 12, bottom: 12, zIndex: 2, background: "rgba(255,255,255,.94)", border: `1px solid ${HAIR}`, borderRadius: 9, padding: "5px 9px" }}>
        <button aria-label="Zoom out" onClick={() => setZoomTo(zoom - 0.25)} style={{ width: 18, height: 18, border: 0, background: "transparent", color: INK, cursor: "pointer", fontSize: 16, lineHeight: 1 }}>−</button>
        <input type="range" min={1} max={4} step={0.1} value={zoom} onChange={(e) => setZoomTo(parseFloat(e.target.value))} aria-label="Zoom level" style={{ width: 92, accentColor: INK }} />
        <button aria-label="Zoom in" onClick={() => setZoomTo(zoom + 0.25)} style={{ width: 18, height: 18, border: 0, background: "transparent", color: INK, cursor: "pointer", fontSize: 16, lineHeight: 1 }}>+</button>
        <span style={{ width: 30, textAlign: "right", fontSize: 11, color: FAINT, fontVariantNumeric: "tabular-nums" }}>{zoom.toFixed(1)}×</span>
      </div>
      {/* loading overlay — covers the stage while the first render runs, and
          swallows clicks so nothing gets rage-clicked during the ~2–3s wait */}
      {busy && <LoaderOverlay label="Loading colours…" />}
    </div>
  );
}

/**
 * Contain — measures its area and renders a centred box that fits a given
 * aspect ratio inside it (object-contain), so the rug fills the stage without
 * dead space or distortion. Mirrors the fit maths the production CanvasZone
 * uses, but as a reusable wrapper for the single Manual stage and each Auto tile.
 */
function Contain({
  aspect,
  onClick,
  boxStyle,
  children,
}: {
  aspect: number;
  onClick?: () => void;
  boxStyle?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setBox((prev) => (Math.round(prev.w) === Math.round(r.width) && Math.round(prev.h) === Math.round(r.height) ? prev : { w: r.width, h: r.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  let fw = 0, fh = 0;
  if (box.w > 0 && box.h > 0 && aspect > 0) {
    if (box.w / box.h > aspect) { fh = box.h; fw = fh * aspect; }
    else { fw = box.w; fh = fw / aspect; }
  }

  const Box: React.ElementType = onClick ? "button" : "div";
  return (
    <div ref={ref} className="flex-1 min-h-0 min-w-0 w-full flex items-center justify-center">
      {fw > 0 && (
        <Box onClick={onClick} style={{ width: fw, height: fh, position: "relative", padding: 0, ...boxStyle }}>
          {children}
        </Box>
      )}
    </div>
  );
}

function Seg({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="flex-1 flex items-center justify-center gap-1.5" style={{ padding: "9px 0", borderRadius: 8, fontSize: 13.5, fontWeight: active ? 600 : 400, background: active ? "#fff" : "transparent", color: active ? "#2c2a24" : "#6f6a5d", boxShadow: active ? "0 1px 2px rgba(44,42,36,.1)" : "none", border: 0, cursor: "pointer" }}>
      {children}
    </button>
  );
}
function StepBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button aria-label={label} onClick={onClick} style={{ width: 28, height: 42, flex: "none", border: "1px solid #e7e0d2", background: "#fff", borderRadius: 9, cursor: "pointer", color: "#6f6a5d", fontSize: 14 }}>{children}</button>;
}
// 2D / 3D view switch segment
function ViewSeg({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="flex items-center justify-center gap-1.5" style={{ padding: "7px 16px", borderRadius: 8, fontSize: 12.5, fontWeight: active ? 600 : 500, background: active ? "#fff" : "transparent", color: active ? "#2c2a24" : "#6f6a5d", boxShadow: active ? "0 1px 2px rgba(44,42,36,.1)" : "none", border: 0, cursor: "pointer" }}>
      {children}
    </button>
  );
}
function GridI() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>; }
// Mobile helpers
function useIsMobile(breakpoint = 768) {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [breakpoint]);
  return mobile;
}
function MTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} style={{ padding: "7px 14px", borderRadius: 9, fontSize: 13, fontWeight: active ? 600 : 500, background: active ? "#fff" : "transparent", color: active ? "#2c2a24" : "#6f6a5d", boxShadow: active ? "0 1px 2px rgba(44,42,36,.1)" : "none", border: 0, cursor: "pointer" }}>{children}</button>;
}
function MenuRow({ onClick, children }: { onClick?: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className="w-full text-left" style={{ padding: 13, border: 0, background: "#fff", borderRadius: 11, fontSize: 14, color: "#2c2a24", display: "flex", alignItems: "center" }}>{children}</button>;
}
function CubeI() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5M12 22V12" /></svg>; }
function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return <button aria-label={label} onClick={onClick} disabled={disabled} style={{ width: 34, height: 34, border: 0, background: "transparent", borderRadius: 9, cursor: "pointer", color: disabled ? "#c3bba6" : "#6f6a5d", display: "flex", alignItems: "center", justifyContent: "center" }}>{children}</button>;
}
function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return <button onClick={onClick} style={{ width: 40, height: 24, borderRadius: 12, background: on ? "#2c2a24" : "#d8cfbb", position: "relative", flex: "none", border: 0, cursor: "pointer" }}><span style={{ position: "absolute", top: 2, left: on ? 18 : 2, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left .12s" }} /></button>;
}

// icons
function UndoI() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-1" /></svg>; }
function RedoI() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m15 14 5-5-5-5" /><path d="M20 9H9a5 5 0 0 0 0 10h1" /></svg>; }
function PencilI() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m15 5 4 4L8 20H4v-4L15 5Z" /></svg>; }
function SparkI() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></svg>; }
function ShuffleI() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></svg>; }
function DiceI() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="8" cy="8" r="1.3" fill="currentColor" /><circle cx="16" cy="16" r="1.3" fill="currentColor" /><circle cx="12" cy="12" r="1.3" fill="currentColor" /></svg>; }
function LockI({ open }: { open: boolean }) { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="9" rx="1.5" />{open ? <path d="M8 11V7a4 4 0 0 1 7.5-2" /> : <path d="M8 11V7a4 4 0 0 1 8 0v4" />}</svg>; }
