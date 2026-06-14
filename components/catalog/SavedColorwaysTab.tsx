"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

type ColorwaySummary = {
  id: string;
  name: string;
  folderId: string | null;
  snapshotUrl: string | null;
  createdAt: string;
  updatedAt: string;
  design: { id: string; name: string; imageUrl: string };
};

type Folder = {
  id: string;
  name: string;
  createdAt: string;
  _count: { colorways: number };
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function SavedColorwaysTab({ onNavigate }: { onNavigate: () => void }) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [rootColorways, setRootColorways] = useState<ColorwaySummary[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [folderColorways, setFolderColorways] = useState<Record<string, ColorwaySummary[]>>({});
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [fRes, cRes] = await Promise.all([
        fetch("/api/colorways/folders"),
        fetch("/api/colorways"),
      ]);
      const fData = await fRes.json() as { folders?: Folder[] };
      const cData = await cRes.json() as { colorways?: ColorwaySummary[] };
      setFolders(fData.folders ?? []);
      setRootColorways((cData.colorways ?? []).filter((c) => !c.folderId));
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  async function loadFolderColorways(folderId: string) {
    if (folderColorways[folderId]) return; // already loaded
    try {
      const res = await fetch(`/api/colorways?folderId=${folderId}`);
      const data = await res.json() as { colorways?: ColorwaySummary[] };
      setFolderColorways((prev) => ({ ...prev, [folderId]: data.colorways ?? [] }));
    } catch { /* ignore */ }
  }

  function toggleFolder(id: string) {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); return next; }
      next.add(id);
      loadFolderColorways(id);
      return next;
    });
  }

  function handleDelete(colorwayId: string) {
    fetch(`/api/colorways/${colorwayId}`, { method: "DELETE" }).catch(() => {});
    setRootColorways((prev) => prev.filter((c) => c.id !== colorwayId));
    setFolderColorways((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        next[k] = next[k].filter((c) => c.id !== colorwayId);
      }
      return next;
    });
  }

  if (loading) {
    return <div className="p-4 text-xs text-stone-400 text-center">Loading…</div>;
  }

  const isEmpty = folders.length === 0 && rootColorways.length === 0;

  if (isEmpty) {
    return (
      <div className="py-10 text-center px-4">
        <BookmarkIcon className="w-8 h-8 text-stone-300 mx-auto mb-3" />
        <p className="text-xs font-medium text-stone-500">No saved colorways</p>
        <p className="text-xs text-stone-400 mt-1 leading-relaxed">
          Open a design, customize it, then click Save.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Folders */}
      {folders.map((folder) => {
        const isOpen = expandedFolders.has(folder.id);
        const items = folderColorways[folder.id] ?? [];
        return (
          <div key={folder.id}>
            <button
              onClick={() => toggleFolder(folder.id)}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-stone-500 hover:text-stone-700 hover:bg-stone-50 transition-colors"
            >
              <FolderChevron expanded={isOpen} />
              <span className="flex-1 text-left truncate">{folder.name}</span>
              <span className="text-stone-400 font-normal">{folder._count.colorways}</span>
            </button>
            {isOpen && (
              <div className="grid grid-cols-2 gap-1 px-1 pb-1">
                {items.length === 0 ? (
                  <p className="col-span-2 text-[10px] text-stone-400 px-1 py-1">Empty folder</p>
                ) : (
                  items.map((c) => (
                    <ColorwayThumb
                      key={c.id}
                      colorway={c}
                      onDelete={handleDelete}
                      onNavigate={onNavigate}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Root (no folder) colorways */}
      {rootColorways.length > 0 && (
        <div className="mt-1">
          {folders.length > 0 && (
            <p className="text-[10px] font-medium text-stone-400 uppercase tracking-wide px-2 py-1">Unsorted</p>
          )}
          <div className="grid grid-cols-2 gap-1 px-1 pb-1">
            {rootColorways.map((c) => (
              <ColorwayThumb
                key={c.id}
                colorway={c}
                onDelete={handleDelete}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ColorwayThumb ────────────────────────────────────────────────────────────
// Same visual treatment as DesignThumb in the Designs tab: square image,
// name label below, heart-style three-dot menu on hover.

function ColorwayThumb({
  colorway,
  onDelete,
  onNavigate,
}: {
  colorway: ColorwaySummary;
  onDelete: (id: string) => void;
  onNavigate: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  // Prefer the recolored snapshot; fall back to original design image
  const thumb = colorway.snapshotUrl ?? colorway.design.imageUrl;
  const dateStr = new Date(colorway.updatedAt).toLocaleDateString(undefined, {
    month: "short", day: "numeric",
  });

  return (
    <div className="relative group">
      <Link
        href={`/designs/${colorway.design.id}?colorway=${colorway.id}`}
        onClick={onNavigate}
        className="block rounded-lg overflow-hidden border border-stone-200 hover:border-stone-400 hover:shadow-sm transition-all"
        title={`Restore "${colorway.name}"`}
      >
        {/* Square thumbnail */}
        <div className="aspect-square relative bg-stone-100">
          <Image
            src={thumb}
            alt={colorway.name}
            fill
            sizes="120px"
            className="object-contain p-0.5"
          />
        </div>

        {/* Label area */}
        <div className="px-1.5 py-1 bg-white">
          <p className="text-[11px] font-medium text-stone-700 truncate leading-tight">
            {colorway.name}
          </p>
          <p className="text-[10px] text-stone-400 truncate leading-tight">
            from {colorway.design.name}
          </p>
          <p className="text-[10px] text-stone-400 truncate leading-tight">
            {dateStr}
          </p>
        </div>
      </Link>

      {/* Three-dot overflow menu */}
      <div className="absolute top-1 right-1">
        <button
          onClick={(e) => { e.preventDefault(); setMenuOpen((v) => !v); }}
          className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded-full bg-white/90 shadow-sm text-stone-400 hover:text-stone-700 transition-all"
          aria-label="More options"
        >
          <DotsIcon />
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-stone-200 rounded-lg shadow-lg py-1 min-w-[120px]">
              <button
                onClick={() => { setMenuOpen(false); onDelete(colorway.id); }}
                className="w-full text-left px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 transition-colors"
              >
                Delete
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function FolderChevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`w-3 h-3 shrink-0 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

function BookmarkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="5" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="19" r="1.5" />
    </svg>
  );
}
