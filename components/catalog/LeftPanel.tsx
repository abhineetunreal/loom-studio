"use client";

import { useState, useEffect, useMemo } from "react";
import { usePathname } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import type { DesignSummary } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "designs" | "visualizations" | "favorites";

type Props = {
  designs: DesignSummary[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function LeftPanel({
  designs,
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onMobileClose,
}: Props) {
  const pathname = usePathname();

  const [activeTab, setActiveTab] = useState<Tab>("designs");
  const [search, setSearch] = useState("");
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => {
    const all = new Set<string>();
    for (const d of designs) all.add(d.collection ?? "Uncategorized");
    return all;
  });
  // Favorites loaded from localStorage after mount to avoid SSR mismatch
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const saved = localStorage.getItem("loom-favorites");
      if (saved) setFavorites(new Set(JSON.parse(saved) as string[]));
    } catch {
      // ignore parse errors
    }
  }, []);

  // Active design ID extracted from pathname like /designs/[id]
  const activeDesignId = useMemo(() => {
    const m = pathname.match(/^\/designs\/([^/]+)/);
    return m ? m[1] : null;
  }, [pathname]);

  const toggleFavorite = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem("loom-favorites", JSON.stringify([...next]));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  const toggleFolder = (name: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  // Designs grouped by collection, filtered by search
  const groupedDesigns = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? designs.filter((d) => d.name.toLowerCase().includes(q))
      : designs;
    const map = new Map<string, DesignSummary[]>();
    for (const d of filtered) {
      const key = d.collection ?? "Uncategorized";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }
    return map;
  }, [designs, search]);

  const favoriteDesigns = useMemo(
    () => designs.filter((d) => favorites.has(d.id)),
    [designs, favorites]
  );

  // ── Shared panel content ───────────────────────────────────────────────────

  const panelContent = (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center border-b border-stone-200 shrink-0 bg-white">
        <div className="flex flex-1">
          {(["designs", "visualizations", "favorites"] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 px-0.5 py-2.5 text-[10px] font-medium capitalize transition-colors whitespace-nowrap ${
                activeTab === tab
                  ? "text-stone-900 border-b-2 border-stone-900 -mb-px"
                  : "text-stone-400 hover:text-stone-600"
              }`}
            >
              {tab === "favorites" ? "Favorites" : tab === "visualizations" ? "Rooms" : "Designs"}
            </button>
          ))}
        </div>
        {/* Collapse button (desktop) */}
        <button
          onClick={onToggleCollapse}
          title="Collapse panel"
          className="hidden lg:flex items-center justify-center w-8 h-8 shrink-0 mr-1 rounded hover:bg-stone-100 text-stone-400 hover:text-stone-600 transition-colors"
        >
          <ChevronLeftIcon />
        </button>
        {/* Close button (mobile) */}
        <button
          onClick={onMobileClose}
          className="lg:hidden flex items-center justify-center w-8 h-8 shrink-0 mr-1 rounded hover:bg-stone-100 text-stone-400 hover:text-stone-600 transition-colors"
        >
          <CloseIcon />
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {/* ── Designs tab ── */}
        {activeTab === "designs" && (
          <div>
            <div className="p-1.5">
              <div className="relative">
                <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 w-3.5 h-3.5 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search designs…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-stone-200 bg-white focus:outline-none focus:ring-1 focus:ring-stone-400 placeholder:text-stone-400"
                />
              </div>
            </div>

            {groupedDesigns.size === 0 ? (
              <p className="px-3 py-6 text-xs text-stone-400 text-center">
                No designs match &ldquo;{search}&rdquo;
              </p>
            ) : (
              [...groupedDesigns.entries()].map(([collection, items]) => (
                <div key={collection}>
                  <button
                    onClick={() => toggleFolder(collection)}
                    className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-stone-500 hover:text-stone-700 hover:bg-stone-50 transition-colors"
                  >
                    <FolderChevron expanded={expandedFolders.has(collection)} />
                    <span className="flex-1 text-left truncate">{collection}</span>
                    <span className="text-stone-400 font-normal">{items.length}</span>
                  </button>

                  {expandedFolders.has(collection) && (
                    <div className="grid grid-cols-2 gap-[3px] px-1 pb-1">
                      {items.map((d) => (
                        <DesignThumb
                          key={d.id}
                          design={d}
                          isActive={d.id === activeDesignId}
                          isFavorite={favorites.has(d.id)}
                          onFavoriteToggle={toggleFavorite}
                          onNavigate={onMobileClose}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* ── Favorites tab ── */}
        {activeTab === "favorites" && (
          <div className="p-2">
            {favoriteDesigns.length === 0 ? (
              <div className="py-10 text-center px-4">
                <HeartIcon
                  filled={false}
                  className="w-8 h-8 text-stone-300 mx-auto mb-3"
                />
                <p className="text-xs font-medium text-stone-500">No favorites yet</p>
                <p className="text-xs text-stone-400 mt-1 leading-relaxed">
                  Tap the heart on any design thumbnail to save it here.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-[3px]">
                {favoriteDesigns.map((d) => (
                  <DesignThumb
                    key={d.id}
                    design={d}
                    isActive={d.id === activeDesignId}
                    isFavorite={true}
                    onFavoriteToggle={toggleFavorite}
                    onNavigate={onMobileClose}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Rooms / Visualizations tab ── */}
        {activeTab === "visualizations" && (
          <div className="flex flex-col items-center justify-center px-5 py-12 text-center">
            <div className="w-12 h-12 rounded-2xl bg-stone-100 flex items-center justify-center mb-4">
              <RoomIcon />
            </div>
            <p className="text-sm font-medium text-stone-700">
              Room visualization coming soon
            </p>
            <p className="text-xs text-stone-400 mt-2 leading-relaxed">
              See how your custom colorway looks placed in a room setting. We&apos;re building
              this feature for a future update.
            </p>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* ── Desktop panel ──────────────────────────────────────────────────── */}
      <aside
        className={`hidden lg:flex flex-col shrink-0 border-r border-stone-200 bg-white transition-all duration-200 overflow-hidden ${
          collapsed ? "w-8" : "w-[15%] min-w-[180px]"
        }`}
      >
        {collapsed ? (
          /* Thin strip with expand button when collapsed */
          <button
            onClick={onToggleCollapse}
            title="Expand panel"
            className="flex flex-col items-center justify-start w-full flex-1 pt-3 hover:bg-stone-50 text-stone-400 hover:text-stone-600 transition-colors"
          >
            <ChevronRightIcon />
          </button>
        ) : (
          panelContent
        )}
      </aside>

      {/* ── Mobile: backdrop + slide-in drawer ─────────────────────────────── */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/40"
          onClick={onMobileClose}
        />
      )}
      <aside
        className={`lg:hidden fixed inset-y-0 left-0 z-50 w-[180px] bg-white border-r border-stone-200 flex flex-col transform transition-transform duration-200 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {panelContent}
      </aside>
    </>
  );
}

// ─── DesignThumb ──────────────────────────────────────────────────────────────

type ThumbProps = {
  design: DesignSummary;
  isActive: boolean;
  isFavorite: boolean;
  onFavoriteToggle: (id: string, e: React.MouseEvent) => void;
  onNavigate: () => void;
};

function DesignThumb({
  design,
  isActive,
  isFavorite,
  onFavoriteToggle,
  onNavigate,
}: ThumbProps) {
  return (
    <div className="relative group">
      <Link
        href={`/designs/${design.id}`}
        onClick={onNavigate}
        className={`block rounded-lg overflow-hidden border transition-all ${
          isActive
            ? "border-stone-700 ring-1 ring-stone-700"
            : "border-stone-200 hover:border-stone-400 hover:shadow-sm"
        }`}
      >
        <div className="aspect-square relative bg-stone-100">
          <Image
            src={design.imageUrl}
            alt={design.name}
            fill
            sizes="90px"
            className="object-contain p-1"
          />
        </div>
        <p className="text-[10px] text-stone-600 truncate px-1.5 py-1 leading-tight bg-white">
          {design.name}
        </p>
      </Link>

      {/* Heart / favorite toggle */}
      <button
        onClick={(e) => onFavoriteToggle(design.id, e)}
        aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
        className={`absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded-full bg-white/90 shadow-sm transition-all ${
          isFavorite
            ? "opacity-100 text-red-500 hover:text-red-600"
            : "opacity-0 group-hover:opacity-100 text-stone-400 hover:text-red-400"
        }`}
      >
        <HeartIcon filled={isFavorite} className="w-3 h-3" />
      </button>
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function FolderChevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`w-3 h-3 shrink-0 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="11" cy="11" r="8" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35" />
    </svg>
  );
}

function HeartIcon({ filled, className }: { filled: boolean; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
      />
    </svg>
  );
}

function RoomIcon() {
  return (
    <svg className="w-6 h-6 text-stone-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
    </svg>
  );
}
