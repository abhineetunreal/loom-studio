"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Image from "next/image";

// ─── Folder types ────────────────────────────────────────────────────────────
type AdminFolder = {
  id: string;
  name: string;
  isPrivate: boolean;
  userId: string;
  createdAt: string;
  _count: { colorways: number };
};

type FolderAccessRow = {
  id: string;
  userEmail: string;
  createdAt: string;
};

type TenantMember = {
  id: string;
  email: string;
  name: string | null;
  role: string;
};

type AdminColorway = {
  id: string;
  name: string;
  userEmail: string | null;
  snapshotUrl: string | null;
  bmpUrl: string | null;
  pdfUrl: string | null;
  yarnSheetUrl: string | null;
  createdAt: string;
  design: { id: string; name: string };
  folder: { id: string; name: string } | null;
};

type GroupedColorways = Map<string, AdminColorway[]>;

export function SavedColorwaysAdminTab() {
  const [view, setView] = useState<"colorways" | "folders">("colorways");

  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-stone-100 mb-2">
        <button
          onClick={() => setView("colorways")}
          className={`px-3 py-1.5 text-sm font-medium border-b-2 transition-colors ${
            view === "colorways"
              ? "border-stone-900 text-stone-900"
              : "border-transparent text-stone-500 hover:text-stone-700"
          }`}
        >
          Colorways
        </button>
        <button
          onClick={() => setView("folders")}
          className={`px-3 py-1.5 text-sm font-medium border-b-2 transition-colors ${
            view === "folders"
              ? "border-stone-900 text-stone-900"
              : "border-transparent text-stone-500 hover:text-stone-700"
          }`}
        >
          Folders
        </button>
      </div>

      {view === "colorways" && <ColorwaysSubTab />}
      {view === "folders" && <FoldersSubTab />}
    </div>
  );
}

// ─── Colorways sub-tab (original content) ────────────────────────────────────

function ColorwaysSubTab() {
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

// ─── Folders sub-tab ─────────────────────────────────────────────────────────

function FoldersSubTab() {
  const [folders, setFolders] = useState<AdminFolder[]>([]);
  const [members, setMembers] = useState<TenantMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingFolder, setEditingFolder] = useState<AdminFolder | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [foldersRes, membersRes] = await Promise.all([
        fetch("/api/colorways/folders"),
        fetch("/api/admin/users"),
      ]);
      if (!foldersRes.ok || !membersRes.ok) { setError("Failed to load"); return; }
      const foldersData = await foldersRes.json();
      const membersData = await membersRes.json();
      setFolders(foldersData.folders ?? []);
      setMembers(membersData.users ?? []);
    } catch { setError("Failed to load"); } finally { setLoading(false); }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  async function handleTogglePrivate(folder: AdminFolder) {
    const newPrivate = !folder.isPrivate;
    const res = await fetch(`/api/colorways/folders/${folder.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: folder.name, isPrivate: newPrivate }),
    });
    if (res.ok) {
      setFolders((prev) =>
        prev.map((f) => (f.id === folder.id ? { ...f, isPrivate: newPrivate } : f))
      );
    }
  }

  if (loading) return <div className="py-8 text-center text-sm text-stone-400">Loading…</div>;
  if (error) return <div className="py-8 text-center text-sm text-red-500">{error}</div>;
  if (folders.length === 0) return <div className="py-8 text-center text-sm text-stone-400">No folders yet.</div>;

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl border border-stone-200 divide-y divide-stone-100">
        {folders.map((folder) => (
          <div key={folder.id} className="flex items-center gap-3 px-4 py-3">
            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-stone-800 truncate">{folder.name}</p>
              <p className="text-xs text-stone-400">
                {folder._count.colorways} colorway{folder._count.colorways !== 1 ? "s" : ""}
              </p>
            </div>
            {/* Private badge */}
            <button
              onClick={() => handleTogglePrivate(folder)}
              className={`shrink-0 px-2.5 py-1 text-xs font-medium rounded-full transition-colors ${
                folder.isPrivate
                  ? "bg-amber-100 text-amber-700 hover:bg-amber-200"
                  : "bg-stone-100 text-stone-500 hover:bg-stone-200"
              }`}
              title={folder.isPrivate ? "Click to make public" : "Click to make private"}
            >
              {folder.isPrivate ? "Private" : "Public"}
            </button>
            {/* Manage access (only for private) */}
            {folder.isPrivate && (
              <button
                onClick={() => setEditingFolder(folder)}
                className="shrink-0 px-2.5 py-1 text-xs text-stone-600 hover:bg-stone-100 rounded-md transition-colors"
              >
                Manage access
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Access modal */}
      {editingFolder && (
        <FolderAccessModal
          folder={editingFolder}
          members={members}
          onClose={() => setEditingFolder(null)}
        />
      )}
    </div>
  );
}

// ─── Folder access modal ─────────────────────────────────────────────────────

function FolderAccessModal({
  folder,
  members,
  onClose,
}: {
  folder: AdminFolder;
  members: TenantMember[];
  onClose: () => void;
}) {
  const [accessEmails, setAccessEmails] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  // Load current access list
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/colorways/folders/${folder.id}/access`);
        if (res.ok) {
          const data = await res.json();
          const rows = data.access as FolderAccessRow[];
          setAccessEmails(new Set(rows.map((r) => r.userEmail)));
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [folder.id]);

  // Only show non-admin members (admins always have access)
  const eligibleMembers = useMemo(
    () =>
      members.filter(
        (m) => m.role !== "OWNER" && m.role !== "ADMIN" && m.role !== "PENDING"
      ),
    [members]
  );

  const filteredMembers = useMemo(() => {
    if (!search.trim()) return eligibleMembers;
    const q = search.toLowerCase();
    return eligibleMembers.filter(
      (m) =>
        m.email.toLowerCase().includes(q) ||
        (m.name ?? "").toLowerCase().includes(q)
    );
  }, [eligibleMembers, search]);

  const toggleEmail = (email: string) => {
    setAccessEmails((prev) => {
      const next = new Set(prev);
      next.has(email) ? next.delete(email) : next.add(email);
      return next;
    });
  };

  const removeEmail = (email: string) => {
    setAccessEmails((prev) => {
      const next = new Set(prev);
      next.delete(email);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      await fetch(`/api/colorways/folders/${folder.id}/access`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails: [...accessEmails] }),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-stone-100">
          <p className="text-xs text-stone-400 mb-0.5">Manage access for</p>
          <p className="font-medium text-stone-900 truncate">{folder.name}</p>
        </div>

        {loading ? (
          <div className="px-5 py-8 text-center text-sm text-stone-400">Loading…</div>
        ) : (
          <>
            {/* Assigned users chips */}
            {accessEmails.size > 0 && (
              <div className="px-5 pt-3 flex flex-wrap gap-1.5">
                {[...accessEmails].map((email) => (
                  <span
                    key={email}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-stone-100 text-stone-700 rounded-full"
                  >
                    {email}
                    <button
                      onClick={() => removeEmail(email)}
                      className="text-stone-400 hover:text-stone-700 ml-0.5"
                      aria-label={`Remove ${email}`}
                    >
                      x
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Search */}
            <div className="px-5 pt-3 pb-2">
              <input
                type="text"
                placeholder="Search users…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg bg-white placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/10"
              />
            </div>

            {/* User checkboxes */}
            <div className="px-5 pb-3 max-h-60 overflow-y-auto space-y-1">
              {filteredMembers.length === 0 ? (
                <p className="text-xs text-stone-400 py-4 text-center">
                  No matching users.
                </p>
              ) : (
                filteredMembers.map((member) => (
                  <label
                    key={member.id}
                    className="flex items-center gap-3 cursor-pointer py-1 group"
                  >
                    <input
                      type="checkbox"
                      checked={accessEmails.has(member.email)}
                      onChange={() => toggleEmail(member.email)}
                      className="rounded border-stone-300 shrink-0"
                    />
                    <span className="text-sm text-stone-700 flex-1 truncate">
                      {member.name ? `${member.name} (${member.email})` : member.email}
                    </span>
                  </label>
                ))
              )}
            </div>

            <p className="px-5 pb-2 text-[11px] text-stone-400">
              Admins and owners always have access to private folders.
            </p>
          </>
        )}

        {/* Footer */}
        <div className="px-5 py-4 border-t border-stone-100 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-stone-600 hover:text-stone-900 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || loading}
            className="px-4 py-1.5 text-sm font-medium bg-stone-900 text-white rounded-lg hover:bg-stone-700 disabled:opacity-50 transition-colors"
          >
            Save
          </button>
        </div>
      </div>
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
        {colorway.pdfUrl && (
          <a
            href={colorway.pdfUrl}
            download
            className="px-2 py-1 text-[11px] text-stone-600 hover:bg-stone-100 rounded-md transition-colors"
            title="Download PDF"
          >
            PDF
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
        {!colorway.bmpUrl && !colorway.pdfUrl && (
          <span className="text-[10px] text-stone-400 italic">no exports</span>
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
