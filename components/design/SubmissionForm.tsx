"use client";

import { useState, useEffect } from "react";
import { submitColorway } from "@/app/actions/submitColorway";
import type { PaletteEntry, YarnOption } from "@/types";

type Props = {
  designId: string;
  designName: string;
  palette: PaletteEntry[];
  colorMap: Record<string, YarnOption | null>;
  getSnapshot: () => string | null;
  onClose: () => void;
};

export default function SubmissionForm({
  designId,
  designName,
  palette,
  colorMap,
  getSnapshot,
  onClose,
}: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && status !== "submitting") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, status]);

  // Assigned mappings only (skip unswapped colors)
  const assignments = palette
    .filter((e) => colorMap[e.hex] != null)
    .map((e) => ({ entry: e, yarn: colorMap[e.hex]! }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (assignments.length === 0) {
      setErrorMsg("Please assign at least one yarn color before submitting.");
      return;
    }
    setStatus("submitting");
    setErrorMsg("");

    const snapshotDataUrl = getSnapshot();
    if (!snapshotDataUrl) {
      setStatus("error");
      setErrorMsg("Could not capture image snapshot. Please try again.");
      return;
    }

    const result = await submitColorway({
      designId,
      customerName: name.trim(),
      customerEmail: email.trim(),
      notes: notes.trim() || undefined,
      colorMappings: assignments.map(({ entry, yarn }) => ({
        originalHex: entry.hex,
        percentage: entry.percentage,
        yarnId: yarn.id,
      })),
      snapshotDataUrl,
    });

    if (result.ok) {
      setStatus("success");
    } else {
      setStatus("error");
      setErrorMsg(result.error);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={status !== "submitting" ? onClose : undefined}
        aria-hidden
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal
        aria-label="Request this colorway"
        className="fixed z-50 inset-x-4 top-1/2 -translate-y-1/2 max-w-md mx-auto bg-white rounded-2xl shadow-2xl overflow-hidden"
      >
        {status === "success" ? (
          <SuccessState designName={designName} onClose={onClose} />
        ) : (
          <form onSubmit={handleSubmit}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-stone-100">
              <h2 className="font-semibold text-stone-900">Request this colorway</h2>
              <button
                type="button"
                onClick={onClose}
                disabled={status === "submitting"}
                className="text-stone-400 hover:text-stone-700 transition-colors"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-5 py-4 flex flex-col gap-4 max-h-[70vh] overflow-y-auto">
              {/* Colorway summary */}
              <div className="rounded-xl bg-stone-50 border border-stone-200 p-3">
                <p className="text-xs text-stone-500 font-medium mb-2">
                  {designName} · {assignments.length} color{assignments.length !== 1 ? "s" : ""} assigned
                </p>
                {assignments.length === 0 ? (
                  <p className="text-xs text-stone-400 italic">
                    No colors assigned yet — go back and pick some yarns.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {assignments.map(({ entry, yarn }) => (
                      <li key={entry.hex} className="flex items-center gap-2">
                        <span
                          className="w-5 h-5 rounded shrink-0 border border-black/10"
                          style={{ backgroundColor: entry.hex }}
                        />
                        <span className="text-stone-400 text-xs">→</span>
                        <span
                          className="w-5 h-5 rounded shrink-0 border border-black/10"
                          style={{ backgroundColor: yarn.hex }}
                        />
                        <span className="text-xs text-stone-700 truncate">
                          {yarn.code} · {yarn.name}
                        </span>
                        <span className="text-xs text-stone-400 ml-auto shrink-0">
                          {entry.percentage.toFixed(1)}%
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Fields */}
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-stone-600">Your name *</span>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={status === "submitting"}
                  className="text-sm px-3 py-2 rounded-lg border border-stone-200 focus:outline-none focus:ring-2 focus:ring-stone-400 disabled:opacity-60"
                  placeholder="Jane Smith"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-stone-600">Email address *</span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={status === "submitting"}
                  className="text-sm px-3 py-2 rounded-lg border border-stone-200 focus:outline-none focus:ring-2 focus:ring-stone-400 disabled:opacity-60"
                  placeholder="jane@example.com"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-stone-600">Notes (optional)</span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={status === "submitting"}
                  rows={3}
                  className="text-sm px-3 py-2 rounded-lg border border-stone-200 focus:outline-none focus:ring-2 focus:ring-stone-400 disabled:opacity-60 resize-none"
                  placeholder="Any specific requirements or questions…"
                />
              </label>

              {errorMsg && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {errorMsg}
                </p>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 pb-5 pt-2">
              <button
                type="submit"
                disabled={status === "submitting" || assignments.length === 0}
                className="w-full bg-stone-900 text-white text-sm font-medium py-2.5 rounded-xl hover:bg-stone-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {status === "submitting" ? "Sending…" : "Send request"}
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}

function SuccessState({ designName, onClose }: { designName: string; onClose: () => void }) {
  return (
    <div className="px-5 py-8 flex flex-col items-center text-center gap-3">
      <div className="w-12 h-12 rounded-full bg-stone-100 flex items-center justify-center">
        <svg className="w-6 h-6 text-stone-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h2 className="font-semibold text-stone-900 text-lg">Request sent!</h2>
      <p className="text-sm text-stone-500 max-w-xs">
        Your colorway request for <strong>{designName}</strong> has been received.
        We&apos;ll be in touch soon.
      </p>
      <button
        onClick={onClose}
        className="mt-2 text-sm font-medium text-stone-700 hover:text-stone-900 transition-colors"
      >
        Close
      </button>
    </div>
  );
}
