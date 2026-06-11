"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

type UploadedDesign = {
  id: string;
  name: string;
  imageUrl: string;
  width: number;
  height: number;
  isActive: boolean;
  createdAt: string;
};

type Phase =
  | { type: "idle" }
  | { type: "warn"; message: string; file: File }
  | { type: "uploading"; progress: number }
  | { type: "processing"; step: number }
  | { type: "error"; message: string };

const PROCESSING_STEPS = [
  "Downloading from storage…",
  "Converting BMP to PNG…",
  "Extracting palette…",
  "Saving design…",
];

// ─── BMP client-side validation ──────────────────────────────────────────────
// Reads the first 54 bytes (BMP file header + full BITMAPINFOHEADER).
// Mirrors the header parsing in scripts/process-designs.ts.

type BmpCheck =
  | { ok: true; warn?: string }
  | { ok: false; error: string };

async function checkBmp(file: File): Promise<BmpCheck> {
  const headerBuf = await file.slice(0, 54).arrayBuffer();
  if (headerBuf.byteLength < 54) {
    return { ok: false, error: "File too small to be a valid BMP." };
  }

  const view = new DataView(headerBuf);

  // Bytes 0–1: "BM" signature
  if (view.getUint8(0) !== 0x42 || view.getUint8(1) !== 0x4d) {
    return { ok: false, error: "Not a valid BMP file." };
  }

  // Byte 28: biBitCount (bits per pixel), 2-byte little-endian
  const bitsPerPixel = view.getUint16(28, true);
  if (bitsPerPixel > 8) {
    return {
      ok: false,
      error: `This BMP is not palette-indexed (${bitsPerPixel}bpp). Please export as an indexed BMP from your CAD software.`,
    };
  }

  // Byte 46: biClrUsed (0 = 2^bpp), 4-byte little-endian
  const colorsUsed = view.getUint32(46, true);
  const effectiveColors = colorsUsed || Math.pow(2, bitsPerPixel);
  if (effectiveColors > 100) {
    return {
      ok: true,
      warn: `This design has ${effectiveColors} palette colors, which is unusual for rug designs. Verify it's the correct export before continuing.`,
    };
  }

  return { ok: true };
}

// ─── Component ────────────────────────────────────────────────────────────────

type Props = {
  onNavigate: () => void; // called on design card click (closes mobile drawer)
};

export default function UploadsTab({ onNavigate }: Props) {
  const [designs, setDesigns] = useState<UploadedDesign[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [phase, setPhase] = useState<Phase>({ type: "idle" });
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Fetch existing uploads ─────────────────────────────────────────────────
  const fetchDesigns = useCallback(async () => {
    try {
      const res = await fetch("/api/designs/my-uploads");
      if (!res.ok) return;
      const data = (await res.json()) as { designs: UploadedDesign[] };
      setDesigns(data.designs ?? []);
    } catch {
      // Silently fail — user sees empty list, can retry by re-opening tab
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDesigns();
  }, [fetchDesigns]);

  // Advance the processing step label every 2 s so the user sees activity.
  useEffect(() => {
    if (phase.type !== "processing") return;
    const id = setInterval(() => {
      setPhase((prev) =>
        prev.type === "processing" && prev.step < PROCESSING_STEPS.length - 1
          ? { type: "processing", step: prev.step + 1 }
          : prev
      );
    }, 2000);
    return () => clearInterval(id);
  }, [phase.type]);

  // ── Upload flow ────────────────────────────────────────────────────────────

  const doUpload = useCallback(async (file: File) => {
    try {
      // Step 1: Get signed upload URL from our API
      const urlRes = await fetch(
        `/api/designs/signed-upload-url?filename=${encodeURIComponent(file.name)}`
      );
      if (!urlRes.ok) {
        const body = (await urlRes.json()) as { error?: string };
        throw new Error(body.error ?? "Failed to get upload URL");
      }
      const { signedUrl, storagePath } = (await urlRes.json()) as {
        signedUrl: string;
        storagePath: string;
      };

      // Step 2: PUT the BMP directly to Supabase Storage with XHR for progress
      setPhase({ type: "uploading", progress: 0 });
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setPhase({ type: "uploading", progress: Math.round((e.loaded / e.total) * 100) });
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Upload failed (HTTP ${xhr.status})`));
          }
        };
        xhr.onerror = () => reject(new Error("Network error during upload"));
        xhr.open("PUT", signedUrl);
        xhr.setRequestHeader("Content-Type", "image/bmp");
        xhr.send(file);
      });

      // Step 3: Trigger server-side processing
      setPhase({ type: "processing", step: 0 });
      const processRes = await fetch("/api/designs/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storagePath, filename: file.name }),
      });
      if (!processRes.ok) {
        const body = (await processRes.json()) as { error?: string };
        throw new Error(body.error ?? "Processing failed");
      }
      const { design } = (await processRes.json()) as { design: UploadedDesign };

      // Prepend to list and return to idle
      setDesigns((prev) => [design, ...prev]);
      setPhase({ type: "idle" });
    } catch (err) {
      setPhase({
        type: "error",
        message: err instanceof Error ? err.message : "Upload failed",
      });
    }
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      // Client-side validation
      if (!file.name.toLowerCase().endsWith(".bmp")) {
        setPhase({ type: "error", message: "Only .bmp files are accepted." });
        return;
      }
      if (file.size > 20 * 1024 * 1024) {
        setPhase({ type: "error", message: "File must be under 20 MB." });
        return;
      }

      const check = await checkBmp(file);
      if (!check.ok) {
        setPhase({ type: "error", message: check.error });
        return;
      }
      if (check.warn) {
        setPhase({ type: "warn", message: check.warn, file });
        return;
      }

      await doUpload(file);
    },
    [doUpload]
  );

  // ── Drop zone event handlers ───────────────────────────────────────────────

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const onDragLeave = () => setIsDragging(false);
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) await handleFile(file);
  };

  const isIdle = phase.type === "idle" || phase.type === "warn" || phase.type === "error";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-2 space-y-2.5">

      {/* Drop zone — shown in idle, warn, and error states */}
      {isIdle && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Upload BMP file"
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer select-none transition-colors ${
            isDragging
              ? "border-stone-400 bg-stone-50"
              : "border-stone-200 hover:border-stone-300 hover:bg-stone-50"
          }`}
        >
          <UploadIcon className="w-6 h-6 text-stone-300 mx-auto mb-1.5" />
          <p className="text-[10px] font-medium text-stone-600">Drop BMP file here</p>
          <p className="text-[9px] text-stone-400 mt-0.5">or click to browse</p>
          <p className="text-[9px] text-stone-400">Indexed BMP · max 20 MB</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".bmp"
            className="sr-only"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) await handleFile(file);
              // Reset so the same file can be re-selected after an error
              e.target.value = "";
            }}
          />
        </div>
      )}

      {/* Palette-size warning — user must confirm before upload continues */}
      {phase.type === "warn" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-2.5">
          <p className="text-[10px] font-semibold text-amber-800 mb-1">Unusual palette size</p>
          <p className="text-[9px] text-amber-700 leading-relaxed">{phase.message}</p>
          <div className="flex gap-2 mt-2.5">
            <button
              onClick={() => {
                const { file } = phase;
                doUpload(file);
              }}
              className="flex-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg py-1.5 text-[10px] font-medium transition-colors"
            >
              Continue anyway
            </button>
            <button
              onClick={() => setPhase({ type: "idle" })}
              className="flex-1 border border-stone-200 hover:bg-stone-50 text-stone-600 rounded-lg py-1.5 text-[10px] transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Error message */}
      {phase.type === "error" && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-2.5">
          <p className="text-[10px] font-semibold text-red-800 mb-0.5">Upload failed</p>
          <p className="text-[9px] text-red-700 leading-relaxed">{phase.message}</p>
          <button
            onClick={() => setPhase({ type: "idle" })}
            className="mt-2 text-[9px] text-red-600 underline underline-offset-2 hover:no-underline"
          >
            Try again
          </button>
        </div>
      )}

      {/* Upload progress bar */}
      {phase.type === "uploading" && (
        <div className="rounded-xl border border-stone-200 bg-white p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-medium text-stone-700">Uploading…</span>
            <span className="text-[10px] text-stone-400 tabular-nums">{phase.progress}%</span>
          </div>
          <div className="w-full h-1 bg-stone-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-stone-800 rounded-full transition-all duration-100"
              style={{ width: `${phase.progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Processing spinner */}
      {phase.type === "processing" && (
        <div className="rounded-xl border border-stone-200 bg-white p-3">
          <div className="flex items-center gap-2.5 mb-2">
            <SpinnerIcon className="w-4 h-4 text-stone-500 shrink-0 animate-spin" />
            <p className="text-[10px] text-stone-600">{PROCESSING_STEPS[phase.step]}</p>
          </div>
          <div className="w-full h-0.5 bg-stone-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-stone-400 rounded-full transition-all duration-700"
              style={{ width: `${((phase.step + 1) / PROCESSING_STEPS.length) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Uploads list */}
      <div>
        {listLoading ? (
          <div className="grid grid-cols-2 gap-[3px]">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="aspect-square rounded-lg bg-stone-100 animate-pulse"
              />
            ))}
          </div>
        ) : designs.length === 0 ? (
          phase.type === "idle" && (
            <p className="text-[10px] text-stone-400 text-center py-3">
              No uploads yet
            </p>
          )
        ) : (
          <>
            <p className="text-[9px] font-medium text-stone-400 uppercase tracking-wide mb-1.5 px-0.5">
              Your uploads · {designs.length}
            </p>
            <div className="grid grid-cols-2 gap-[3px]">
              {designs.map((d) => (
                <UploadThumb key={d.id} design={d} onNavigate={onNavigate} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Upload thumbnail card ────────────────────────────────────────────────────

function UploadThumb({
  design,
  onNavigate,
}: {
  design: UploadedDesign;
  onNavigate: () => void;
}) {
  return (
    <div className="relative group">
      <Link
        href={`/designs/${design.id}`}
        onClick={onNavigate}
        className="block rounded-lg overflow-hidden border border-stone-200 hover:border-stone-400 hover:shadow-sm transition-all"
      >
        <div className="aspect-square bg-stone-100">
          {/* Plain img — signed URLs have expiring tokens that break next/image caching */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={design.imageUrl}
            alt={design.name}
            className="w-full h-full object-contain p-1"
          />
        </div>
        <p className="text-[10px] text-stone-600 truncate px-1.5 py-1 leading-tight bg-white">
          {design.name}
        </p>
      </Link>

      {/* "Pending review" badge for inactive designs */}
      {!design.isActive && (
        <span className="absolute top-1 left-1 bg-amber-500 text-white text-[8px] font-medium rounded px-1 py-0.5 leading-none pointer-events-none">
          Pending
        </span>
      )}
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
      />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        d="M12 3a9 9 0 109 9"
      />
    </svg>
  );
}
