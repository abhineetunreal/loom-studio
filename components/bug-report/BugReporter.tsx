"use client";

/**
 * BugReporter — a floating "Report a problem" control shown across the app.
 *
 * On submit it bundles the user's note with the technical context that makes a
 * bug fixable in one shot: the current URL, any design/colourway id in the path,
 * the viewport + user agent, and the diagnostics ring buffer (console errors and
 * failed requests) captured since page load. An optional screenshot can be
 * pasted or chosen; it is downscaled client-side before upload.
 *
 * Everything is sent to /api/bug-report, which files it as a GitHub issue for
 * the triage agent. Nothing is captured or sent until the user clicks Send.
 */

import { useCallback, useEffect, useRef, useState } from "react";

type Diag = {
  errors?: unknown[];
  net?: unknown[];
  started?: number;
};

declare global {
  interface Window {
    __loomDiag?: Diag;
  }
}

const MAX_SHOT_DIM = 1600;

function idFromPath(path: string): { kind: string; id: string } | null {
  const m = path.match(/\/(studio|designs|customize|share)\/([^/?#]+)/);
  return m ? { kind: m[1], id: m[2] } : null;
}

async function downscale(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SHOT_DIM / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.82);
}

export default function BugReporter() {
  const [open, setOpen] = useState(false);
  const [desc, setDesc] = useState("");
  const [email, setEmail] = useState("");
  const [shot, setShot] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setDesc(""); setEmail(""); setShot(null); setState("idle");
  }, []);

  const addImage = useCallback(async (file: Blob) => {
    try { setShot(await downscale(file)); } catch { /* ignore bad image */ }
  }, []);

  // Paste-to-attach anywhere in the modal.
  useEffect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
      const file = item?.getAsFile();
      if (file) { e.preventDefault(); void addImage(file); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [open, addImage]);

  const submit = useCallback(async () => {
    if (!desc.trim()) return;
    setState("sending");
    const diag = typeof window !== "undefined" ? window.__loomDiag : undefined;
    const path = typeof location !== "undefined" ? location.pathname : "";
    const payload = {
      description: desc.trim().slice(0, 5000),
      email: email.trim().slice(0, 200) || null,
      context: {
        url: typeof location !== "undefined" ? location.href : "",
        path,
        target: idFromPath(path),
        viewport: typeof window !== "undefined" ? { w: window.innerWidth, h: window.innerHeight } : null,
        ua: typeof navigator !== "undefined" ? navigator.userAgent : "",
        at: new Date().toISOString(),
        errors: (diag?.errors ?? []).slice(-20),
        net: (diag?.net ?? []).slice(-15),
      },
      screenshot: shot,
    };
    try {
      const res = await fetch("/api/bug-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setState(res.ok ? "sent" : "error");
    } catch {
      setState("error");
    }
  }, [desc, email, shot]);

  return (
    <>
      {/* Launcher */}
      <button
        onClick={() => { reset(); setOpen(true); }}
        className="fixed bottom-4 right-4 z-[9998] flex items-center gap-2 px-3.5 py-2 rounded-full bg-stone-900 text-white text-[13px] shadow-lg hover:bg-stone-800 transition-colors"
        aria-label="Report a problem"
      >
        <BugIcon />
        Report a problem
      </button>

      {open && (
        <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-md rounded-xl bg-white shadow-2xl border border-stone-200 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-stone-100 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-stone-900">Report a problem</h2>
              <button onClick={() => setOpen(false)} className="text-stone-400 hover:text-stone-700 text-xl leading-none">×</button>
            </div>

            {state === "sent" ? (
              <div className="p-6 text-center">
                <p className="text-[15px] font-medium text-stone-900 mb-1">Thanks — we got it.</p>
                <p className="text-[13px] text-stone-500 mb-4">Your report is in. We&apos;ll look into it.</p>
                <button onClick={() => setOpen(false)} className="px-4 py-2 rounded-md bg-stone-900 text-white text-[13px]">Close</button>
              </div>
            ) : (
              <div className="p-5 space-y-3.5">
                <div>
                  <label className="block text-[12px] font-medium text-stone-600 mb-1">What went wrong?</label>
                  <textarea
                    value={desc}
                    onChange={(e) => setDesc(e.target.value)}
                    rows={4}
                    autoFocus
                    placeholder="What were you doing, and what happened? What did you expect instead?"
                    className="w-full px-3 py-2 rounded-md border border-stone-300 text-[13px] text-stone-800 placeholder:text-stone-400 focus:outline-none focus:border-stone-500 resize-none"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-medium text-stone-600 mb-1">Email <span className="text-stone-400 font-normal">(optional, so we can follow up)</span></label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full px-3 py-2 rounded-md border border-stone-300 text-[13px] text-stone-800 placeholder:text-stone-400 focus:outline-none focus:border-stone-500"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-medium text-stone-600 mb-1">Screenshot <span className="text-stone-400 font-normal">(optional — paste or choose)</span></label>
                  {shot ? (
                    <div className="relative inline-block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={shot} alt="" className="max-h-32 rounded-md border border-stone-200" />
                      <button onClick={() => setShot(null)} className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-stone-900 text-white text-[12px]">×</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => fileRef.current?.click()}
                      className="w-full py-3 rounded-md border border-dashed border-stone-300 text-[12px] text-stone-500 hover:border-stone-400 hover:bg-stone-50"
                    >
                      Paste a screenshot (Ctrl/⌘+V) or click to choose
                    </button>
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void addImage(f); }}
                  />
                </div>

                {state === "error" && (
                  <p className="text-[12px] text-red-600">Couldn&apos;t send that. Please try again in a moment.</p>
                )}

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button onClick={() => setOpen(false)} className="px-3.5 py-2 rounded-md text-[13px] text-stone-600 hover:bg-stone-100">Cancel</button>
                  <button
                    onClick={submit}
                    disabled={!desc.trim() || state === "sending"}
                    className="px-4 py-2 rounded-md bg-stone-900 text-white text-[13px] disabled:opacity-40"
                  >
                    {state === "sending" ? "Sending…" : "Send report"}
                  </button>
                </div>
                <p className="text-[11px] text-stone-400 leading-snug">
                  We attach your browser, the page you&apos;re on, and recent error logs to help us fix it. No passwords or form contents are included.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function BugIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2l1.5 1.5M16 2l-1.5 1.5" />
      <rect x="8" y="6" width="8" height="12" rx="4" />
      <path d="M3 9h3M18 9h3M3 14h3M18 14h3M3 19l3-2M18 17l3 2M12 6V4" />
    </svg>
  );
}
