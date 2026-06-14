"use client";

import { useState, useEffect, useRef, useCallback, useTransition } from "react";
import Image from "next/image";
import { assignDesignCollectionAction } from "@/app/actions/collections";
import type { CollectionSummary } from "./CollectionsTab";
import type { CatalogDesign } from "@/app/api/admin/designs/route";

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  collections: CollectionSummary[];
};

// ─── Queue types ──────────────────────────────────────────────────────────────

type QueueStatus = "queued" | "uploading" | "processing" | "done" | "error";

type QueueItem = {
  id: string;            // stable local key
  file: File;
  collectionId: string;  // collection assigned at enqueue time
  status: QueueStatus;
  progress: number;      // 0–100, meaningful only while uploading
  error?: string;
  thumbnailUrl?: string; // public PNG URL on completion
};

const MAX_CONCURRENT = 3;
const MAX_FILE_MB = 20;

// ─── CatalogTab ───────────────────────────────────────────────────────────────

export function CatalogTab({ collections }: Props) {
  const [selectedCollectionId, setSelectedCollectionId] = useState<string>("");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [designs, setDesigns] = useState<CatalogDesign[]>([]);
  const [designsLoading, setDesignsLoading] = useState(true);
  const [designsError, setDesignsError] = useState<string | null>(null);

  // Track how many items are currently uploading or processing
  const activeCount = useRef(0);

  // ── Load existing designs on mount ────────────────────────────────────────
  useEffect(() => {
    fetch("/api/admin/designs")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load designs");
        return r.json() as Promise<{ designs: CatalogDesign[] }>;
      })
      .then((data) => setDesigns(data.designs))
      .catch(() => setDesignsError("Failed to load catalog designs."))
      .finally(() => setDesignsLoading(false));
  }, []);

  // ── Process a single queue item ───────────────────────────────────────────
  const processItem = useCallback(
    async (itemId: string, file: File, collectionId: string) => {
      activeCount.current += 1;

      const patch = (updates: Partial<QueueItem>) =>
        setQueue((prev) =>
          prev.map((q) => (q.id === itemId ? { ...q, ...updates } : q))
        );

      try {
        // Step 1: get a signed upload URL
        const urlRes = await fetch(
          `/api/admin/designs/signed-upload-url?filename=${encodeURIComponent(file.name)}`
        );
        if (!urlRes.ok) {
          const { error } = (await urlRes.json()) as { error: string };
          throw new Error(error ?? "Could not get upload URL");
        }
        const { signedUrl, storagePath } = (await urlRes.json()) as {
          signedUrl: string;
          storagePath: string;
          slug: string;
        };

        // Step 2: XHR PUT directly to Supabase with progress events
        patch({ status: "uploading", progress: 0 });
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.upload.addEventListener("progress", (e) => {
            if (e.lengthComputable) {
              patch({ progress: Math.round((e.loaded / e.total) * 100) });
            }
          });
          xhr.addEventListener("load", () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve();
            else reject(new Error(`Upload failed (HTTP ${xhr.status})`));
          });
          xhr.addEventListener("error", () => reject(new Error("Network error during upload")));
          xhr.open("PUT", signedUrl);
          const contentType = file.name.toLowerCase().endsWith(".ctf")
            ? "application/octet-stream"
            : "image/bmp";
          xhr.setRequestHeader("Content-Type", contentType);
          xhr.send(file);
        });

        // Step 3: trigger server-side processing
        patch({ status: "processing", progress: 100 });
        const processRes = await fetch("/api/admin/designs/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storagePath,
            filename: file.name,
            ...(collectionId ? { collectionId } : {}),
          }),
        });
        if (!processRes.ok) {
          const { error } = (await processRes.json()) as { error: string };
          throw new Error(error ?? "Processing failed");
        }
        const { design } = (await processRes.json()) as { design: CatalogDesign };

        patch({ status: "done", thumbnailUrl: design.imageUrl });

        // Only prepend on 201 (newly created). On 200 the design already exists
        // in the list — adding it again causes duplicate React keys.
        if (processRes.status === 201) {
          setDesigns((prev) => [
            { ...design, colorCount: design.colorCount ?? 0 },
            ...prev,
          ]);
        }
      } catch (err) {
        patch({
          status: "error",
          error: err instanceof Error ? err.message : "Unknown error",
        });
      } finally {
        activeCount.current -= 1;
        // Kick off the next queued item, using its own stored collectionId
        setQueue((prev) => {
          const next = prev.find((q) => q.status === "queued");
          if (next && activeCount.current < MAX_CONCURRENT) {
            processItem(next.id, next.file, next.collectionId);
          }
          return prev;
        });
      }
    },
    []
  );

  // ── Add files to queue ─────────────────────────────────────────────────────
  const enqueue = useCallback(
    (files: File[]) => {
      const collectionId = selectedCollectionId;
      setQueue((prev) => {
        // Deduplicate: skip any file whose name is already in the queue
        const existingNames = new Set(prev.map((q) => q.file.name));
        const newFiles = files.filter((f) => !existingNames.has(f.name));
        if (newFiles.length === 0) return prev;

        const validated: { file: File; error?: string }[] = newFiles.map((file) => {
          const lower = file.name.toLowerCase();
          if (!lower.endsWith(".bmp") && !lower.endsWith(".ctf"))
            return { file, error: "Not a .bmp or .ctf file" };
          if (file.size > MAX_FILE_MB * 1024 * 1024)
            return { file, error: `Exceeds ${MAX_FILE_MB} MB limit` };
          return { file };
        });

        const newItems: QueueItem[] = validated.map(({ file, error }) => ({
          id: crypto.randomUUID(),
          file,
          collectionId,
          status: error ? "error" : "queued",
          progress: 0,
          error,
        }));

        // Kick off new queued items respecting MAX_CONCURRENT.
        // Check activeCount inside the loop — processItem increments it
        // synchronously, so the guard is accurate for each successive item.
        // Only iterate newItems (not the full combined array) to avoid
        // re-starting items that are already uploading or waiting in prev.
        for (const item of newItems) {
          if (item.status !== "queued") continue;
          if (activeCount.current >= MAX_CONCURRENT) break;
          processItem(item.id, item.file, item.collectionId);
        }

        return [...prev, ...newItems];
      });
    },
    [selectedCollectionId, processItem]
  );

  // ── Drag-and-drop handlers ─────────────────────────────────────────────────
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current += 1;
    setDragging(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) setDragging(false);
  };
  const onDragOver = (e: React.DragEvent) => e.preventDefault();
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) enqueue(files);
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length) enqueue(files);
    e.target.value = "";
  };

  // ── Queue stats ────────────────────────────────────────────────────────────
  const doneCount = queue.filter((q) => q.status === "done").length;
  const totalQueued = queue.length;
  const hasQueue = totalQueued > 0;

  // ── Handle design deletion ─────────────────────────────────────────────────
  const handleDelete = useCallback(async (id: string, name: string) => {
    if (!confirm(`Delete "${name}" from the catalog? This cannot be undone.`)) return;
    const res = await fetch(`/api/admin/designs/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const { error } = (await res.json().catch(() => ({ error: "Unknown error" }))) as {
        error: string;
      };
      alert(`Delete failed: ${error}`);
      return;
    }
    setDesigns((prev) => prev.filter((d) => d.id !== id));
  }, []);

  // ── Handle SKU update ─────────────────────────────────────────────────────
  const handleSkuChange = useCallback((designId: string, sku: string | null) => {
    setDesigns((prev) =>
      prev.map((d) => (d.id === designId ? { ...d, externalSku: sku } : d))
    );
  }, []);

  return (
    <div className="space-y-8">
      {/* ── Section 1: Upload Zone ─────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-stone-700">Upload Designs</h2>
          {hasQueue && (
            <span className="text-xs text-stone-500">
              {doneCount} of {totalQueued} processed
            </span>
          )}
        </div>

        {/* Collection selector */}
        <div className="flex items-center gap-2 mb-3">
          <label className="text-xs text-stone-500 shrink-0">Assign to collection:</label>
          <select
            value={selectedCollectionId}
            onChange={(e) => setSelectedCollectionId(e.target.value)}
            className="text-xs border border-stone-200 rounded-md px-2 py-1.5 bg-white text-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-900/10"
          >
            <option value="">Uncategorized</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Drop zone */}
        <div
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`relative border-2 border-dashed rounded-xl px-6 py-10 text-center cursor-pointer transition-colors select-none ${
            dragging
              ? "border-stone-500 bg-stone-100"
              : "border-stone-200 hover:border-stone-400 hover:bg-stone-50"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".bmp,.ctf"
            multiple
            className="sr-only"
            onChange={onFileChange}
          />
          <UploadCloudIcon className={`mx-auto mb-3 w-8 h-8 ${dragging ? "text-stone-600" : "text-stone-300"}`} />
          <p className="text-sm font-medium text-stone-600">
            {dragging ? "Drop files here" : "Drop .bmp or .ctf files here, or click to browse"}
          </p>
          <p className="text-xs text-stone-400 mt-1">
            .bmp and .ctf accepted · max {MAX_FILE_MB} MB each · max {MAX_CONCURRENT} uploading at once
          </p>
        </div>

        {/* Queue list */}
        {hasQueue && (
          <div className="mt-3 space-y-1.5">
            {queue.map((item) => (
              <QueueRow key={item.id} item={item} />
            ))}
          </div>
        )}
      </section>

      {/* ── Section 2: Existing Designs ───────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-stone-700 mb-3">
          Catalog Designs
        </h2>
        <DesignsList
          designs={designs}
          collections={collections}
          loading={designsLoading}
          error={designsError}
          onDelete={handleDelete}
          onSkuChange={handleSkuChange}
        />
      </section>
    </div>
  );
}

// ─── QueueRow ─────────────────────────────────────────────────────────────────

function QueueRow({ item }: { item: QueueItem }) {
  const statusText: Record<QueueStatus, string> = {
    queued: "Queued",
    uploading: `Uploading ${item.progress}%`,
    processing: "Processing…",
    done: "Done",
    error: item.error ?? "Error",
  };

  const statusColor: Record<QueueStatus, string> = {
    queued: "text-stone-400",
    uploading: "text-blue-600",
    processing: "text-amber-600",
    done: "text-emerald-600",
    error: "text-red-500",
  };

  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-white border border-stone-200 rounded-lg text-xs">
      {/* Thumbnail or status icon */}
      <div className="w-8 h-8 shrink-0 rounded overflow-hidden bg-stone-100 flex items-center justify-center">
        {item.status === "done" && item.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.thumbnailUrl}
            alt={item.file.name}
            className="w-full h-full object-contain"
          />
        ) : (
          <StatusIcon status={item.status} />
        )}
      </div>

      {/* Filename */}
      <span className="flex-1 font-medium text-stone-700 truncate min-w-0">
        {item.file.name}
      </span>

      {/* Upload progress bar (only while uploading) */}
      {item.status === "uploading" && (
        <div className="w-20 h-1.5 bg-stone-100 rounded-full overflow-hidden shrink-0">
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-150"
            style={{ width: `${item.progress}%` }}
          />
        </div>
      )}

      {/* Status text */}
      <span className={`shrink-0 ${statusColor[item.status]}`}>
        {statusText[item.status]}
      </span>
    </div>
  );
}

// ─── DesignsList ──────────────────────────────────────────────────────────────

function DesignsList({
  designs,
  collections,
  loading,
  error,
  onDelete,
  onSkuChange,
}: {
  designs: CatalogDesign[];
  collections: CollectionSummary[];
  loading: boolean;
  error: string | null;
  onDelete: (id: string, name: string) => void;
  onSkuChange: (designId: string, sku: string | null) => void;
}) {
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();

  const filtered = search.trim()
    ? designs.filter((d) =>
        d.name.toLowerCase().includes(search.toLowerCase())
      )
    : designs;

  const handleCollectionChange = (designId: string, collectionId: string) => {
    startTransition(() =>
      assignDesignCollectionAction(designId, collectionId || null)
    );
  };

  if (loading) {
    return (
      <div className="py-16 text-center text-stone-400 text-sm">
        Loading catalog…
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-10 text-center text-red-500 text-sm">{error}</div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <input
          type="text"
          placeholder="Search designs…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-3 py-2 text-sm border border-stone-200 rounded-lg bg-white placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/10"
        />
        <span className="text-sm text-stone-400 shrink-0">
          {filtered.length} design{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="py-16 text-center text-stone-400 text-sm">
          {search ? "No designs match your search." : "No catalog designs yet."}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {filtered.map((design) => (
            <DesignCard
              key={design.id}
              design={design}
              collections={collections}
              isPending={isPending}
              onCollectionChange={handleCollectionChange}
              onDelete={onDelete}
              onSkuChange={onSkuChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── DesignCard ───────────────────────────────────────────────────────────────

function DesignCard({
  design,
  collections,
  isPending,
  onCollectionChange,
  onDelete,
  onSkuChange,
}: {
  design: CatalogDesign;
  collections: CollectionSummary[];
  isPending: boolean;
  onCollectionChange: (designId: string, collectionId: string) => void;
  onDelete: (id: string, name: string) => void;
  onSkuChange: (designId: string, sku: string | null) => void;
}) {
  const [editingSku, setEditingSku] = useState(false);
  const [skuInput, setSkuInput] = useState(design.externalSku ?? "");
  const [skuSaving, setSkuSaving] = useState(false);
  const [skuError, setSkuError] = useState<string | null>(null);

  async function saveSku() {
    const trimmed = skuInput.trim();
    const newSku = trimmed || null;
    if (newSku === design.externalSku) {
      setEditingSku(false);
      return;
    }
    setSkuSaving(true);
    setSkuError(null);
    try {
      const res = await fetch(`/api/admin/designs/${design.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ externalSku: newSku }),
      });
      const data = await res.json() as { ok?: boolean; error?: string; externalSku?: string | null };
      if (!res.ok) {
        setSkuError(data.error ?? "Failed to save SKU");
      } else {
        onSkuChange(design.id, data.externalSku ?? null);
        setEditingSku(false);
      }
    } catch {
      setSkuError("Network error");
    } finally {
      setSkuSaving(false);
    }
  }

  function handleSkuKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") saveSku();
    if (e.key === "Escape") {
      setSkuInput(design.externalSku ?? "");
      setSkuError(null);
      setEditingSku(false);
    }
  }

  return (
    <div className="bg-white border border-stone-200 rounded-xl overflow-hidden flex flex-col hover:shadow-md transition-shadow group">
      {/* Thumbnail — clickable, opens design in new tab */}
      <a
        href={`/designs/${design.id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="block relative bg-stone-100 shrink-0"
        style={{ paddingBottom: "133%" /* 3:4 aspect ratio */ }}
        title="Preview design"
      >
        <Image
          src={design.imageUrl}
          alt={design.name}
          fill
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
          className="object-contain p-3"
          unoptimized
        />
        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/8 transition-colors flex items-center justify-center">
          <span className="opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 text-stone-700 text-xs font-medium px-2.5 py-1 rounded-full shadow-sm">
            Preview
          </span>
        </div>
      </a>

      {/* Card body */}
      <div className="flex flex-col gap-2 p-3 flex-1">
        {/* Name */}
        <p className="text-sm font-semibold text-stone-800 leading-snug line-clamp-2">
          {design.name}
        </p>

        {/* Meta */}
        <p className="text-xs text-stone-400">
          {design.colorCount} color{design.colorCount !== 1 ? "s" : ""}
          <span className="mx-1">·</span>
          {design.width}×{design.height}
        </p>

        {/* SKU field */}
        {editingSku ? (
          <div className="flex flex-col gap-1">
            <div className="flex gap-1">
              <input
                autoFocus
                type="text"
                value={skuInput}
                onChange={(e) => setSkuInput(e.target.value)}
                onKeyDown={handleSkuKeyDown}
                onBlur={saveSku}
                placeholder="e.g. 3740"
                disabled={skuSaving}
                className="flex-1 text-xs border border-stone-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-stone-900/10 disabled:opacity-50"
              />
            </div>
            {skuError && (
              <p className="text-[10px] text-red-500 leading-tight">{skuError}</p>
            )}
          </div>
        ) : (
          <button
            onClick={() => {
              setSkuInput(design.externalSku ?? "");
              setSkuError(null);
              setEditingSku(true);
            }}
            className="flex items-center gap-1 text-left w-full"
            title="Edit SKU"
          >
            {design.externalSku ? (
              <span className="text-xs text-stone-500 font-mono">
                SKU: {design.externalSku}
              </span>
            ) : (
              <span className="text-xs text-stone-300 italic">No SKU</span>
            )}
            <PencilIcon />
          </button>
        )}

        {/* Collection dropdown */}
        <select
          value={design.collectionId ?? ""}
          onChange={(e) => onCollectionChange(design.id, e.target.value)}
          disabled={isPending}
          className="w-full text-xs border border-stone-200 rounded-md px-2 py-1.5 bg-white text-stone-600 focus:outline-none focus:ring-2 focus:ring-stone-900/10 disabled:opacity-50 mt-auto"
        >
          <option value="">Uncategorized</option>
          {collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        {/* Delete */}
        <button
          onClick={() => onDelete(design.id, design.name)}
          title="Delete design"
          className="flex items-center justify-center gap-1.5 w-full py-1.5 rounded-md text-xs text-stone-400 hover:text-red-600 hover:bg-red-50 transition-colors border border-transparent hover:border-red-100"
        >
          <TrashIcon />
          Delete
        </button>
      </div>
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function UploadCloudIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.338-2.32 5.75 5.75 0 011.344 11.095H6.75z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg className="w-3 h-3 text-stone-300 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
    </svg>
  );
}

function StatusIcon({ status }: { status: QueueStatus }) {
  if (status === "queued")
    return <svg className="w-4 h-4 text-stone-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="9" /><path strokeLinecap="round" d="M12 7v5l3 3" /></svg>;
  if (status === "uploading" || status === "processing")
    return (
      <svg className="w-4 h-4 text-stone-400 animate-spin" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={3} />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
      </svg>
    );
  if (status === "done")
    return <svg className="w-4 h-4 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>;
  // error
  return <svg className="w-4 h-4 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>;
}
