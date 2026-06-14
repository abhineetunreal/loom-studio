"use client";

import { useState, useEffect } from "react";

type Folder = { id: string; name: string };

type Props = {
  onSave: (name: string, folderId: string | null) => Promise<void>;
  onClose: () => void;
};

export default function SaveModal({ onSave, onClose }: Props) {
  const [name, setName] = useState("My Colorway");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load user's folders
  useEffect(() => {
    fetch("/api/colorways/folders")
      .then((r) => r.json())
      .then((data: { folders?: Folder[] }) => setFolders(data.folders ?? []))
      .catch(() => {});
  }, []);

  async function handleCreateFolder() {
    const n = newFolderName.trim();
    if (!n) return;
    try {
      const res = await fetch("/api/colorways/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: n }),
      });
      const data = await res.json() as { folder?: Folder; error?: string };
      if (!res.ok) { setError(data.error ?? "Failed to create folder"); return; }
      const folder = data.folder!;
      setFolders((prev) => [...prev, folder].sort((a, b) => a.name.localeCompare(b.name)));
      setFolderId(folder.id);
      setNewFolderName("");
      setShowNewFolder(false);
    } catch {
      setError("Failed to create folder");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Name is required"); return; }
    setSaving(true);
    setError(null);
    try {
      await onSave(name.trim(), folderId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b border-stone-100">
          <h2 className="text-sm font-semibold text-stone-900">Save colorway</h2>
          <p className="text-xs text-stone-400 mt-0.5">Give your colorway a name and optionally put it in a folder.</p>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-stone-700 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              autoFocus
              className="w-full px-3 py-2 text-sm rounded-lg border border-stone-200 focus:outline-none focus:ring-1 focus:ring-stone-400 placeholder:text-stone-400"
              placeholder="My Colorway"
            />
          </div>

          {/* Folder */}
          <div>
            <label className="block text-xs font-medium text-stone-700 mb-1">Folder <span className="font-normal text-stone-400">(optional)</span></label>
            <select
              value={folderId ?? ""}
              onChange={(e) => setFolderId(e.target.value || null)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-stone-200 focus:outline-none focus:ring-1 focus:ring-stone-400 bg-white"
            >
              <option value="">No folder</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>

            {showNewFolder ? (
              <div className="flex gap-2 mt-2">
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Folder name"
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleCreateFolder())}
                  className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-stone-200 focus:outline-none focus:ring-1 focus:ring-stone-400 placeholder:text-stone-400"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={handleCreateFolder}
                  className="px-3 py-1.5 text-xs bg-stone-800 text-white rounded-lg hover:bg-stone-700 transition-colors"
                >
                  Create
                </button>
                <button
                  type="button"
                  onClick={() => { setShowNewFolder(false); setNewFolderName(""); }}
                  className="px-2 py-1.5 text-xs text-stone-400 hover:text-stone-700 transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowNewFolder(true)}
                className="mt-1.5 text-xs text-stone-400 hover:text-stone-700 transition-colors"
              >
                + New folder
              </button>
            )}
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="flex-1 px-4 py-2 text-sm rounded-lg bg-stone-900 text-white hover:bg-stone-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
