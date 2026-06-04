"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import {
  createCollectionAction,
  renameCollectionAction,
  deleteCollectionAction,
  assignDesignCollectionAction,
  toggleDesignHiddenAction,
} from "@/app/actions/collections";

export type CollectionSummary = {
  id: string;
  name: string;
  slug: string;
  designCount: number;
};

export type DesignBrief = {
  id: string;
  name: string;
  slug: string;
  collectionId: string | null;
  isHidden: boolean;
};

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
    <div className="border border-stone-200 rounded-lg overflow-hidden bg-white">
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

        <span className="text-xs text-stone-400 shrink-0">
          {collection.designCount} {collection.designCount === 1 ? "design" : "designs"}
        </span>

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
