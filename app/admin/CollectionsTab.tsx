"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import {
  createCollectionAction,
  renameCollectionAction,
  deleteCollectionAction,
  assignDesignCollectionAction,
  toggleDesignHiddenAction,
  setCollectionPrivacyAction,
} from "@/app/actions/collections";

export type CollectionSummary = {
  id: string;
  name: string;
  slug: string;
  isPrivate: boolean;
  designCount: number;
  accessEmails: string[];
};

export type DesignBrief = {
  id: string;
  name: string;
  slug: string;
  collectionId: string | null;
  isHidden: boolean;
};

type TenantMember = { id: string; email: string; name: string | null; role: string };

type Props = {
  collections: CollectionSummary[];
  designs: DesignBrief[];
};

export function CollectionsTab({ collections, designs }: Props) {
  const [isPending, startTransition] = useTransition();
  const [newName, setNewName] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const designsByCollection = new Map<string | null, DesignBrief[]>();
  for (const d of designs) {
    const key = d.collectionId ?? null;
    if (!designsByCollection.has(key)) designsByCollection.set(key, []);
    designsByCollection.get(key)!.push(d);
  }

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) return;
    startTransition(async () => {
      await createCollectionAction(name);
      setNewName("");
    });
  };

  const handleDelete = (id: string, name: string) => {
    if (!confirm(`Delete collection "${name}"? Designs will become unassigned.`)) return;
    startTransition(() => deleteCollectionAction(id));
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const collectionOptions = [
    { value: "", label: "— Unassigned —" },
    ...collections.map((c) => ({ value: c.id, label: c.name })),
  ];

  const handleMove = (designId: string, collectionId: string) => {
    startTransition(() =>
      assignDesignCollectionAction(designId, collectionId || null)
    );
  };

  const handleToggleHidden = (designId: string, current: boolean) => {
    startTransition(() => toggleDesignHiddenAction(designId, !current));
  };

  return (
    <div>
      {/* Create new collection */}
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          placeholder="New collection name…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          className="flex-1 px-3 py-2 text-sm border border-stone-200 rounded-lg bg-white placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/10"
        />
        <button
          onClick={handleCreate}
          disabled={isPending || !newName.trim()}
          className="px-3 py-2 text-sm font-medium bg-stone-900 text-white rounded-lg hover:bg-stone-700 disabled:opacity-50 transition-colors"
        >
          Create
        </button>
      </div>

      {collections.length === 0 && (
        <p className="text-center text-stone-400 text-sm py-8">
          No collections yet. Create one above.
        </p>
      )}

      {/* Collection list */}
      <div className="space-y-2">
        {collections.map((col) => (
          <CollectionRow
            key={col.id}
            collection={col}
            designs={designsByCollection.get(col.id) ?? []}
            expanded={expanded.has(col.id)}
            onToggleExpand={() => toggleExpand(col.id)}
            onDelete={() => handleDelete(col.id, col.name)}
            collectionOptions={collectionOptions}
            onMove={handleMove}
            onToggleHidden={handleToggleHidden}
            isPending={isPending}
          />
        ))}

        {/* Unassigned designs */}
        {(designsByCollection.get(null)?.length ?? 0) > 0 && (
          <UnassignedRow
            designs={designsByCollection.get(null) ?? []}
            expanded={expanded.has("__unassigned__")}
            onToggleExpand={() => toggleExpand("__unassigned__")}
            collectionOptions={collectionOptions}
            onMove={handleMove}
            onToggleHidden={handleToggleHidden}
            isPending={isPending}
          />
        )}
      </div>
    </div>
  );
}

// ─── CollectionRow ─────────────────────────────────────────────────────────────

type CollectionRowProps = {
  collection: CollectionSummary;
  designs: DesignBrief[];
  expanded: boolean;
  onToggleExpand: () => void;
  onDelete: () => void;
  collectionOptions: { value: string; label: string }[];
  onMove: (designId: string, collectionId: string) => void;
  onToggleHidden: (designId: string, current: boolean) => void;
  isPending: boolean;
};

function CollectionRow({
  collection,
  designs,
  expanded,
  onToggleExpand,
  onDelete,
  collectionOptions,
  onMove,
  onToggleHidden,
  isPending,
}: CollectionRowProps) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(collection.name);
  const [editPending, startEditTransition] = useTransition();
  const [showPrivacy, setShowPrivacy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commitRename = () => {
    const name = editName.trim();
    if (!name || name === collection.name) {
      setEditing(false);
      setEditName(collection.name);
      return;
    }
    startEditTransition(async () => {
      await renameCollectionAction(collection.id, name);
      setEditing(false);
    });
  };

  return (
    <div className={`border rounded-lg overflow-hidden bg-white ${
      collection.isPrivate ? "border-violet-200" : "border-stone-200"
    }`}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        {/* Expand toggle */}
        <button
          onClick={onToggleExpand}
          className="text-stone-400 hover:text-stone-600 shrink-0"
        >
          <ChevronIcon expanded={expanded} />
        </button>

        {/* Name / inline edit */}
        {editing ? (
          <input
            ref={inputRef}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") {
                setEditing(false);
                setEditName(collection.name);
              }
            }}
            className="flex-1 text-sm font-medium border-b border-stone-400 focus:outline-none bg-transparent"
          />
        ) : (
          <span className="flex-1 text-sm font-medium text-stone-800 truncate">
            {collection.name}
          </span>
        )}

        {/* Private badge */}
        {collection.isPrivate && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-violet-100 text-violet-700">
            Private
          </span>
        )}

        <span className="text-xs text-stone-400 shrink-0">
          {collection.designCount} {collection.designCount === 1 ? "design" : "designs"}
        </span>

        {/* Privacy settings */}
        <button
          onClick={() => setShowPrivacy(!showPrivacy)}
          title="Privacy settings"
          className={`shrink-0 transition-colors ${
            showPrivacy || collection.isPrivate
              ? "text-violet-500 hover:text-violet-700"
              : "text-stone-400 hover:text-stone-600"
          }`}
        >
          <LockIcon />
        </button>

        {/* Rename */}
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            title="Rename"
            className="shrink-0 text-stone-400 hover:text-stone-600 transition-colors"
          >
            <PencilIcon />
          </button>
        )}

        {/* Delete */}
        <button
          onClick={onDelete}
          disabled={isPending || editPending}
          title="Delete collection"
          className="shrink-0 text-stone-300 hover:text-red-500 disabled:opacity-50 transition-colors"
        >
          <TrashIcon />
        </button>
      </div>

      {/* Privacy panel */}
      {showPrivacy && (
        <PrivacyPanel
          collection={collection}
        />
      )}

      {expanded && (
        <div className="border-t border-stone-100">
          {designs.length === 0 ? (
            <p className="px-4 py-3 text-xs text-stone-400">No designs in this collection.</p>
          ) : (
            <table className="w-full text-xs">
              <tbody>
                {designs.map((d) => (
                  <DesignRow
                    key={d.id}
                    design={d}
                    collectionOptions={collectionOptions}
                    onMove={onMove}
                    onToggleHidden={onToggleHidden}
                    isPending={isPending}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ─── PrivacyPanel ─────────────────────────────────────────────────────────────

function PrivacyPanel({ collection }: { collection: CollectionSummary }) {
  const [isPrivate, setIsPrivate] = useState(collection.isPrivate);
  const [emails, setEmails] = useState<Set<string>>(new Set(collection.accessEmails));
  const [members, setMembers] = useState<TenantMember[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [dirty, setDirty] = useState(false);

  // Fetch tenant members when panel opens
  useEffect(() => {
    let cancelled = false;
    setLoadingMembers(true);
    fetch("/api/admin/users")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data.users) {
          // Filter out OWNER/ADMIN — they always see everything
          setMembers(
            (data.users as TenantMember[]).filter(
              (u) => u.role !== "OWNER" && u.role !== "ADMIN"
            )
          );
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingMembers(false); });
    return () => { cancelled = true; };
  }, []);

  const toggleEmail = (email: string) => {
    setEmails((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
    setDirty(true);
  };

  const removeEmail = (email: string) => {
    setEmails((prev) => {
      const next = new Set(prev);
      next.delete(email);
      return next;
    });
    setDirty(true);
  };

  const handleTogglePrivate = (checked: boolean) => {
    setIsPrivate(checked);
    setDirty(true);
  };

  const handleSave = () => {
    startTransition(async () => {
      await setCollectionPrivacyAction(
        collection.id,
        isPrivate,
        [...emails]
      );
      setDirty(false);
    });
  };

  const filteredMembers = memberSearch.trim()
    ? members.filter(
        (m) =>
          m.email.toLowerCase().includes(memberSearch.toLowerCase()) ||
          (m.name ?? "").toLowerCase().includes(memberSearch.toLowerCase())
      )
    : members;

  return (
    <div className="border-t border-stone-100 bg-stone-50 px-4 py-3 space-y-3">
      {/* Private toggle */}
      <label className="flex items-center gap-3 cursor-pointer">
        <div
          className={`relative w-9 h-5 rounded-full transition-colors ${
            isPrivate ? "bg-violet-500" : "bg-stone-300"
          }`}
          onClick={() => handleTogglePrivate(!isPrivate)}
        >
          <div
            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
              isPrivate ? "translate-x-4" : "translate-x-0.5"
            }`}
          />
        </div>
        <span className="text-sm font-medium text-stone-700">Private collection</span>
      </label>

      {isPrivate && (
        <>
          <p className="text-xs text-stone-500">
            Only assigned users (and admins) can see this collection.
          </p>

          {/* Assigned user chips */}
          {emails.size > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {[...emails].map((email) => (
                <span
                  key={email}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 text-xs"
                >
                  {email}
                  <button
                    onClick={() => removeEmail(email)}
                    className="hover:text-violet-900 transition-colors"
                    title="Remove access"
                  >
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Search + user list */}
          <div>
            <input
              type="text"
              placeholder="Search users…"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              className="w-full px-3 py-1.5 text-xs border border-stone-200 rounded-lg bg-white placeholder:text-stone-400 focus:outline-none focus:ring-1 focus:ring-violet-400"
            />
          </div>

          <div className="max-h-40 overflow-y-auto space-y-1">
            {loadingMembers ? (
              <p className="text-xs text-stone-400 py-2 text-center">Loading users…</p>
            ) : filteredMembers.length === 0 ? (
              <p className="text-xs text-stone-400 py-2 text-center">
                {memberSearch ? "No users match" : "No assignable users"}
              </p>
            ) : (
              filteredMembers.map((m) => (
                <label
                  key={m.id}
                  className="flex items-center gap-2 cursor-pointer py-1 px-1 rounded hover:bg-stone-100"
                >
                  <input
                    type="checkbox"
                    checked={emails.has(m.email)}
                    onChange={() => toggleEmail(m.email)}
                    className="rounded border-stone-300 shrink-0 text-violet-600 focus:ring-violet-500"
                  />
                  <span className="text-xs text-stone-700 flex-1 truncate">
                    {m.name ? `${m.name} (${m.email})` : m.email}
                  </span>
                  <span className="text-[10px] text-stone-400">{m.role}</span>
                </label>
              ))
            )}
          </div>
        </>
      )}

      {/* Save button */}
      {dirty && (
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={isPending}
            className="px-3 py-1.5 text-xs font-medium bg-violet-600 text-white rounded-lg hover:bg-violet-500 disabled:opacity-50 transition-colors"
          >
            {isPending ? "Saving…" : "Save privacy settings"}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── UnassignedRow ─────────────────────────────────────────────────────────────

function UnassignedRow({
  designs,
  expanded,
  onToggleExpand,
  collectionOptions,
  onMove,
  onToggleHidden,
  isPending,
}: {
  designs: DesignBrief[];
  expanded: boolean;
  onToggleExpand: () => void;
  collectionOptions: { value: string; label: string }[];
  onMove: (designId: string, collectionId: string) => void;
  onToggleHidden: (designId: string, current: boolean) => void;
  isPending: boolean;
}) {
  return (
    <div className="border border-dashed border-stone-200 rounded-lg overflow-hidden bg-stone-50">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button onClick={onToggleExpand} className="text-stone-400 hover:text-stone-600 shrink-0">
          <ChevronIcon expanded={expanded} />
        </button>
        <span className="flex-1 text-sm font-medium text-stone-500">Unassigned</span>
        <span className="text-xs text-stone-400">{designs.length}</span>
      </div>
      {expanded && (
        <div className="border-t border-stone-200">
          <table className="w-full text-xs">
            <tbody>
              {designs.map((d) => (
                <DesignRow
                  key={d.id}
                  design={d}
                  collectionOptions={collectionOptions}
                  onMove={onMove}
                  onToggleHidden={onToggleHidden}
                  isPending={isPending}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── DesignRow ─────────────────────────────────────────────────────────────────

function DesignRow({
  design,
  collectionOptions,
  onMove,
  onToggleHidden,
  isPending,
}: {
  design: DesignBrief;
  collectionOptions: { value: string; label: string }[];
  onMove: (designId: string, collectionId: string) => void;
  onToggleHidden: (designId: string, current: boolean) => void;
  isPending: boolean;
}) {
  return (
    <tr className="border-b border-stone-100 last:border-0 hover:bg-stone-50">
      <td className="pl-9 pr-2 py-2 text-stone-700 truncate max-w-[200px]">{design.name}</td>
      <td className="px-2 py-2">
        <select
          value={design.collectionId ?? ""}
          onChange={(e) => onMove(design.id, e.target.value)}
          disabled={isPending}
          className="text-xs border border-stone-200 rounded px-1.5 py-1 bg-white text-stone-600 focus:outline-none disabled:opacity-50"
        >
          {collectionOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-2 text-right">
        <button
          onClick={() => onToggleHidden(design.id, design.isHidden)}
          disabled={isPending}
          title={design.isHidden ? "Show design" : "Hide design"}
          className={`text-xs px-2 py-0.5 rounded border transition-colors disabled:opacity-50 ${
            design.isHidden
              ? "border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100"
              : "border-stone-200 text-stone-500 hover:bg-stone-100"
          }`}
        >
          {design.isHidden ? "Hidden" : "Visible"}
        </button>
      </td>
    </tr>
  );
}

// ─── Icons ─────────────────────────────────────────────────────────────────────

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`w-3.5 h-3.5 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 7.125L18 10.5" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0110 0v4" />
    </svg>
  );
}
