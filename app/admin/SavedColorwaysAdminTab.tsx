"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";

type AdminColorway = {
  id: string;
  name: string;
  userEmail: string | null;
  snapshotUrl: string | null;
  bmpUrl: string | null;
  ctfUrl: string | null;
  yarnSheetUrl: string | null;
  createdAt: string;
  design: { id: string; name: string };
  folder: { id: string; name: string } | null;
};

type GroupedColorways = Map<string, AdminColorway[]>;

export function SavedColorwaysAdminTab() {
  const [colorways, setColorways] = useState<AdminColorway[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/colorways");
      if (!res.ok) { setError("Failed to load"); return; }
      const data = await res.json() as { colorways: AdminColorway[] };
      setColorways(data.colorways);
    } catch { setError("Failed to load"); } finally { setLoading(false); }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  async function handleDelete(id: string) {
    await fetch(`/api/colorways/${id}`, { method: "DELETE" });
    setColorways((prev) => prev.filter((c) => c.id !== id));
  }

  if (loading) return <div className="py-8 text-center text-sm text-stone-400">Loading…</div>;
  if (error) return <div className="py-8 text-center text-sm text-red-500">{error}</div>;
  if (colorways.length === 0) return <div className="py-8 text-center text-sm text-stone-400">No saved colorways yet.</div>;

  // Group by email
  const groups: GroupedColorways = new Map();
  for (const c of colorways) {
    const key = c.userEmail ?? "Unknown";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }

  return (
    <div className="space-y-6">
      {[...groups.entries()].map(([email, items]) => (
        <div key={email}>
          <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">{email}</h3>
          <div className="bg-white rounded-xl border border-stone-200 divide-y divide-stone-100">
            {items.map((c) => (
              <ColorwayAdminRow key={c.id} colorway={c} onDelete={handleDelete} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ColorwayAdminRow({
  colorway,
  onDelete,
}: {
  colorway: AdminColorway;
  onDelete: (id: string) => void;
}) {
  const dateStr = new Date(colorway.createdAt).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      {/* Thumbnail */}
      {colorway.snapshotUrl && (
        <div className="w-12 h-12 rounded border border-stone-200 overflow-hidden bg-stone-100 relative shrink-0">
          <Image
            src={colorway.snapshotUrl}
            alt={colorway.name}
            fill
            sizes="48px"
            className="object-contain p-0.5"
          />
        </div>
      )}
      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-stone-800 truncate">{colorway.name}</p>
        <p className="text-xs text-stone-400 truncate">
          {colorway.design.name}
          {colorway.folder && <> · <span className="italic">{colorway.folder.name}</span></>}
          {" · "}{dateStr}
        </p>
      </div>
      {/* Downloads */}
      <div className="flex items-center gap-1 shrink-0">
        {colorway.bmpUrl && (
          <a
            href={colorway.bmpUrl}
            download
            className="px-2 py-1 text-[11px] text-stone-600 hover:bg-stone-100 rounded-md transition-colors"
            title="Download BMP"
          >
            BMP
          </a>
        )}
        {colorway.ctfUrl && (
          <a
            href={colorway.ctfUrl}
            download
            className="px-2 py-1 text-[11px] text-stone-600 hover:bg-stone-100 rounded-md transition-colors"
            title="Download CTF"
          >
            CTF
          </a>
        )}
        {colorway.yarnSheetUrl && (
          <a
            href={colorway.yarnSheetUrl}
            download
            className="px-2 py-1 text-[11px] text-stone-600 hover:bg-stone-100 rounded-md transition-colors"
            title="Download Yarn Sheet"
          >
            Yarns
          </a>
        )}
        {!colorway.bmpUrl && !colorway.ctfUrl && (
          <span className="text-[10px] text-stone-300 italic">no exports</span>
        )}
      </div>
      {/* Delete */}
      <button
        onClick={() => {
          if (confirm(`Delete "${colorway.name}"?`)) onDelete(colorway.id);
        }}
        className="shrink-0 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 rounded-lg transition-colors"
      >
        Delete
      </button>
    </div>
  );
}
