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

import { useCallback, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { PaletteEntry, TierInfo, YarnOption } from "@/types";
import type { RecolorCanvasHandle } from "@/components/design/RecolorCanvas";
import InlineYarnPicker from "@/components/design/InlineYarnPicker";
import { useRecolorStudio, type StudioColorMap } from "./useRecolorStudio";

const RecolorCanvas = dynamic(() => import("@/components/design/RecolorCanvas"), { ssr: false });

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
  const s = useRecolorStudio({ palette: design.palette, yarns, initialColorMap });
  const canvasRef = useRef<RecolorCanvasHandle | null>(null);
  const [selectedHex, setSelectedHex] = useState<string | null>(null);
  const [mode, setMode] = useState<"manual" | "auto">("manual");
  const [autoKind, setAutoKind] = useState<"full" | "slight" | "family" | "shuffle">("full");
  const [autoOptions, setAutoOptions] = useState<StudioColorMap[]>([]);

  const handleCanvasPick = useCallback((hex: string) => setSelectedHex(hex), []);
  const handleYarnPick = useCallback(
    (yarn: YarnOption) => { if (selectedHex) s.assign(selectedHex, yarn); },
    [selectedHex, s]
  );

  const generate = useCallback(() => setAutoOptions(s.generateFour(autoKind)), [s, autoKind]);
  const openOption = useCallback(
    (map: StudioColorMap) => { s.applyMap(map, "auto"); setMode("manual"); },
    [s]
  );

  const targetEntry = selectedHex
    ? design.palette.find((e) => e.hex === selectedHex) ?? null
    : null;

  const INK = "#2c2a24", SOFT = "#6f6a5d", FAINT = "#9a9484", HAIR = "#e7e0d2", PANEL = "#f6f2ea";

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
        <div className="ml-auto flex items-center gap-1">
          <IconBtn label="Undo" disabled={!s.canUndo} onClick={s.undo}><UndoI /></IconBtn>
          <IconBtn label="Redo" disabled={!s.canRedo} onClick={s.redo}><RedoI /></IconBtn>
          <div style={{ width: 1, height: 24, background: HAIR, margin: "0 7px" }} />
          <button style={{ padding: "7px 14px", border: `1px solid ${HAIR}`, background: "#fff", borderRadius: 10, fontSize: 13, fontWeight: 500 }}>Shortlist</button>
          <button style={{ padding: "7px 15px", border: 0, background: INK, color: "#fff", borderRadius: 10, fontSize: 13, fontWeight: 500 }}>Request colourway</button>
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
              <Seg active={mode === "auto"} onClick={() => { setMode("auto"); if (!autoOptions.length) setAutoOptions(s.generateFour(autoKind)); }}><SparkI /> Auto</Seg>
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
                    <button key={k} onClick={() => { setAutoKind(k); setAutoOptions(s.generateFour(k)); }} className="flex items-center gap-2.5 text-left" style={{ padding: "11px 12px", border: `1px solid ${autoKind === k ? INK : HAIR}`, background: "#fff", borderRadius: 11 }}>
                      <span style={{ width: 15, height: 15, borderRadius: "50%", border: autoKind === k ? `5px solid ${INK}` : `1.5px solid #cfc6b2`, flex: "none" }} />
                      <span><span className="block" style={{ fontSize: 13, fontWeight: autoKind === k ? 600 : 500 }}>{t}</span><span className="block" style={{ fontSize: 11, color: FAINT }}>{d}</span></span>
                    </button>
                  ))}
                </div>
              </section>
              <button onClick={generate} style={{ padding: 12, border: 0, background: INK, color: "#fff", borderRadius: 11, fontSize: 14, fontWeight: 500, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}><SparkI /> Generate four</button>
              <p style={{ margin: "auto 2px 0", fontSize: 11.5, lineHeight: 1.5, color: FAINT }}>Tap an option in the middle to open it full-size and keep editing in Manual.</p>
            </div>
          )}
        </aside>

        {/* STAGE */}
        <main className="flex-1 min-w-0 relative flex items-center justify-center" style={{ padding: mode === "auto" ? 20 : 30, background: "#efe9dd" }}>
          {mode === "manual" ? (
            <div className="relative" style={{ height: "100%", aspectRatio: `${design.width}/${design.height}`, maxWidth: "100%", boxShadow: "0 10px 36px rgba(44,42,36,.15)", borderRadius: 4 }}>
              <RecolorCanvas
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
                mode="global"
              />
              <button onClick={() => s.setTextureEnabled((v) => !v)} className="absolute flex items-center gap-2" style={{ left: 12, bottom: 12, padding: "7px 12px", border: `1px solid ${HAIR}`, background: "rgba(255,255,255,.94)", borderRadius: 9, fontSize: 12 }}>
                <span style={{ width: 12, height: 12, borderRadius: 4, background: s.textureEnabled ? INK : "transparent", border: s.textureEnabled ? "none" : `1px solid ${HAIR}` }} /> Textured
              </button>
            </div>
          ) : (
            <div className="w-full h-full flex flex-col">
              <div className="shrink-0 flex items-center justify-center gap-2" style={{ marginBottom: 14, fontSize: 13, color: SOFT }}>
                Four ways to colour {design.name} — tap the one you like to open it and edit
              </div>
              <div className="flex-1 min-h-0 grid" style={{ gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 18, justifyItems: "center" }}>
                {autoOptions.slice(0, 4).map((opt, i) => (
                  <button key={i} onClick={() => openOption(opt)} className="relative" style={{ height: "100%", aspectRatio: `${design.width}/${design.height}`, maxWidth: "100%", borderRadius: 8, overflow: "hidden", boxShadow: "0 6px 22px rgba(44,42,36,.14)", background: "#fff" }}>
                    <span className="flex flex-col w-full h-full">
                      {chunk(rowsFromMap(opt, design.palette), 1).map((hex, r) => (
                        <span key={r} style={{ flex: 1, background: hex[0] }} />
                      ))}
                    </span>
                    <span className="absolute" style={{ left: 10, bottom: 10, background: "rgba(44,42,36,.8)", color: "#fff", fontSize: 11, padding: "3px 9px", borderRadius: 7 }}>Option {i + 1}</span>
                  </button>
                ))}
              </div>
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
    </div>
  );
}

// ── small style helpers ─────────────────────────────────────────────────────────
const h3: React.CSSProperties = { margin: "0 0 9px", fontSize: 12, fontWeight: 600, color: "#6f6a5d" };
const softBtn: React.CSSProperties = { display: "flex", alignItems: "center", gap: 7, padding: "9px 6px", border: "1px solid #e7e0d2", background: "#fff", borderRadius: 10, fontSize: 12.5, cursor: "pointer" };

function rowsFromMap(map: StudioColorMap, palette: PaletteEntry[]): string[] {
  // distinct display colours, ordered by area, for lightweight previews/strips
  const sorted = palette.filter((e) => e.percentage >= 0.05).slice().sort((a, b) => b.percentage - a.percentage);
  const out = sorted.map((e) => map[e.hex]?.hex ?? e.hex);
  return out.length ? out : ["#DDDDD3"];
}
function chunk<T>(arr: T[], n: number): T[][] {
  const r: T[][] = [];
  for (let i = 0; i < arr.length; i += n) r.push(arr.slice(i, i + n));
  return r;
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
