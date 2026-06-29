"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

type SavedColorwayInfo = {
  colorCount: number;
  snapshotUrl: string | null;
  updatedAt: string;
} | null;

type DesignCard = {
  id: string;
  name: string;
  imageUrl: string;
  createdAt: string;
  savedColorway: SavedColorwayInfo;
};

type UserGroup = {
  user: { id: string; name: string | null; email: string };
  designs: DesignCard[];
};

// ─── Component ────────────────────────────────────────────────────────────────

export function UserUploadsTab() {
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // All groups expanded by default
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Expanded detail view: which card is showing its full colorMapping
  const [detailOpen, setDetailOpen] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/user-uploads")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load");
        return r.json() as Promise<{ groups: UserGroup[] }>;
      })
      .then((data) => {
        setGroups(data.groups);
        setExpanded(new Set(data.groups.map((g) => g.user.id)));
      })
      .catch(() => setError("Failed to load user uploads."))
      .finally(() => setLoading(false));
  }, []);

  const toggleGroup = (userId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(userId) ? next.delete(userId) : next.add(userId);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="py-16 text-center text-stone-400 text-sm">
        Loading uploads…
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-12 text-center text-red-500 text-sm">{error}</div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="py-16 text-center text-stone-400 text-sm">
        No user uploads yet.
      </div>
    );
  }

  const totalDesigns = groups.reduce((n, g) => n + g.designs.length, 0);

  return (
    <div className="space-y-6">
      <p className="text-sm text-stone-500">
        {totalDesigns} upload{totalDesigns !== 1 ? "s" : ""} from {groups.length} user{groups.length !== 1 ? "s" : ""}
      </p>

      {groups.map((group) => (
        <section key={group.user.id}>
          {/* Group header */}
          <button
            onClick={() => toggleGroup(group.user.id)}
            className="flex items-center gap-2 w-full text-left mb-3 group"
          >
            <ChevronIcon expanded={expanded.has(group.user.id)} />
            <div>
              <span className="font-medium text-stone-800 text-sm">
                {group.user.name ?? group.user.email}
              </span>
              {group.user.name && (
                <span className="ml-1.5 text-xs text-stone-400">
                  {group.user.email}
                </span>
              )}
              <span className="ml-2 text-xs text-stone-400">
                · {group.designs.length} design{group.designs.length !== 1 ? "s" : ""}
              </span>
            </div>
          </button>

          {expanded.has(group.user.id) && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {group.designs.map((design) => (
                <UploadCard
                  key={design.id}
                  design={design}
                  detailOpen={detailOpen === design.id}
                  onToggleDetail={() =>
                    setDetailOpen((prev) => (prev === design.id ? null : design.id))
                  }
                />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

// ─── UploadCard ───────────────────────────────────────────────────────────────

function UploadCard({
  design,
  detailOpen,
  onToggleDetail,
}: {
  design: DesignCard;
  detailOpen: boolean;
  onToggleDetail: () => void;
}) {
  const sc = design.savedColorway;

  return (
    <div className="bg-white border border-stone-200 rounded-xl overflow-hidden text-[10px] flex flex-col">
      {/* Original design thumbnail — links to the canvas */}
      <Link href={`/designs/${design.id}`} className="block group">
        <div className="aspect-square relative bg-stone-100">
          <Image
            src={design.imageUrl}
            alt={design.name}
            fill
            sizes="220px"
            className="object-contain p-1.5 group-hover:opacity-90 transition-opacity"
          />
        </div>
      </Link>

      <div className="p-2 flex-1 flex flex-col gap-1.5">
        {/* Design name */}
        <p className="font-medium text-stone-800 truncate leading-snug" title={design.name}>
          {design.name}
        </p>

        {/* Saved colorway section */}
        {sc ? (
          <div>
            <p className="text-stone-400 mb-1">Saved colorway</p>

            {/* Snapshot thumbnail */}
            {sc.snapshotUrl && (
              <div className="aspect-video relative bg-stone-100 rounded overflow-hidden mb-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={sc.snapshotUrl}
                  alt="Saved colorway snapshot"
                  className="w-full h-full object-contain"
                />
              </div>
            )}

            {/* Stats row */}
            <p className="text-stone-600">
              <span className="font-medium">{sc.colorCount}</span> color
              {sc.colorCount !== 1 ? "s" : ""} changed
            </p>
            <p className="text-stone-400">{formatDate(sc.updatedAt)}</p>

            {/* Expand/collapse full mapping */}
            <button
              onClick={onToggleDetail}
              className="mt-1 text-stone-400 hover:text-stone-700 underline underline-offset-2 transition-colors"
            >
              {detailOpen ? "Hide detail" : "Show yarns"}
            </button>
          </div>
        ) : (
          <p className="text-stone-400 italic">No save yet</p>
        )}

        {/* Upload date */}
        <p className="text-stone-400 mt-auto pt-1 border-t border-stone-100">
          Uploaded {formatDate(design.createdAt)}
        </p>
      </div>

      {/* Open-in-canvas link */}
      <Link
        href={`/designs/${design.id}`}
        className="flex items-center justify-center gap-1 border-t border-stone-100 py-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-50 transition-colors"
      >
        <CanvasIcon />
        <span>Open in canvas</span>
      </Link>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`w-3.5 h-3.5 text-stone-400 shrink-0 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

function CanvasIcon() {
  return (
    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path strokeLinecap="round" d="M3 9h18M9 21V9" />
    </svg>
  );
}
