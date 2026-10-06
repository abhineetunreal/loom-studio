"use client";

import { useState, useEffect, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type UnresolvedColor = {
  hex: string;
  designCount: number;
  firstDesign: { id: string; name: string } | null;
};

type ColorMapping = {
  id: string;
  renderedHex: string;
  yarnCode: string;
  catalogHex: string | null;
  library: string;
  createdAt: string;
};

// ─── ColorMappingTab ──────────────────────────────────────────────────────────

export function ColorMappingTab() {
  const [section, setSection] = useState<"unresolved" | "all">("unresolved");

  return (
    <div className="space-y-4">
      {/* Sub-nav */}
      <div className="flex gap-1 border-b border-stone-200">
        <SubTabButton
          active={section === "unresolved"}
          onClick={() => setSection("unresolved")}
        >
          Unresolved Colors
        </SubTabButton>
        <SubTabButton
          active={section === "all"}
          onClick={() => setSection("all")}
        >
          All Mappings
        </SubTabButton>
      </div>

      {section === "unresolved" && <UnresolvedSection />}
      {section === "all" && <AllMappingsSection />}
    </div>
  );
}

// ─── UnresolvedSection ────────────────────────────────────────────────────────

function UnresolvedSection() {
  const [colors, setColors] = useState<UnresolvedColor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Map from hex → current input value
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch("/api/admin/color-mapping/unresolved")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load unresolved colors");
        return r.json() as Promise<{ unresolved: UnresolvedColor[] }>;
      })
      .then((data) => {
        setColors(data.unresolved);
        const init: Record<string, string> = {};
        data.unresolved.forEach((c) => { init[c.hex] = ""; });
        setInputs(init);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Error"))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = useCallback(async (hex: string) => {
    const yarnCode = inputs[hex]?.trim();
    if (!yarnCode) return;

    setSaving((prev) => ({ ...prev, [hex]: true }));
    try {
      const res = await fetch("/api/admin/color-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hex, yarnCode }),
      });
      if (!res.ok) {
        const { error: err } = (await res.json()) as { error: string };
        throw new Error(err ?? "Save failed");
      }
      const { updatedDesigns } = (await res.json()) as { updatedDesigns: number };
      setSaved((prev) => ({ ...prev, [hex]: true }));
      // Remove from unresolved list
      setColors((prev) => prev.filter((c) => c.hex !== hex));
      if (updatedDesigns > 0) {
        // brief flash then clear
        setTimeout(() => setSaved((prev) => ({ ...prev, [hex]: false })), 2000);
      }
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving((prev) => ({ ...prev, [hex]: false }));
    }
  }, [inputs]);

  if (loading) {
    return <div className="py-16 text-center text-stone-400 text-sm">Loading…</div>;
  }
  if (error) {
    return <div className="py-10 text-center text-red-500 text-sm">{error}</div>;
  }
  if (colors.length === 0) {
    return (
      <div className="py-16 text-center text-stone-400 text-sm">
        All palette colors are mapped.
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs text-stone-500 mb-3">
        {colors.length} unresolved color{colors.length !== 1 ? "s" : ""} across catalog designs.
        Enter the OneLoom yarn code for each and save.
      </p>

      <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
        {colors.map((color, i) => (
          <div
            key={color.hex}
            className={`flex items-center gap-3 px-3 py-2.5 ${
              i < colors.length - 1 ? "border-b border-stone-100" : ""
            }`}
          >
            {/* Swatch */}
            <div
              className="w-8 h-8 shrink-0 rounded border border-stone-200"
              style={{ backgroundColor: color.hex }}
            />

            {/* Hex + design count + first design link */}
            <div className="w-24 shrink-0">
              <p className="text-xs font-mono font-medium text-stone-800">{color.hex}</p>
              <p className="text-xs text-stone-400">
                {color.designCount} design{color.designCount !== 1 ? "s" : ""}
              </p>
            </div>

            {/* First design link */}
            <div className="w-36 shrink-0 min-w-0">
              {color.firstDesign && (
                <a
                  href={`/designs/${color.firstDesign.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-stone-500 hover:text-stone-900 underline underline-offset-2 truncate block"
                  title={color.firstDesign.name}
                >
                  {color.firstDesign.name}
                </a>
              )}
            </div>

            {/* Code input */}
            <input
              type="text"
              placeholder="e.g. OU 49"
              value={inputs[color.hex] ?? ""}
              onChange={(e) =>
                setInputs((prev) => ({ ...prev, [color.hex]: e.target.value }))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave(color.hex);
              }}
              className="flex-1 px-2.5 py-1.5 text-sm border border-stone-200 rounded-md bg-white placeholder:text-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-900/10"
            />

            {/* Save button */}
            <button
              onClick={() => handleSave(color.hex)}
              disabled={saving[color.hex] || !inputs[color.hex]?.trim()}
              className="shrink-0 px-3 py-1.5 text-xs font-medium bg-stone-900 text-white rounded-md hover:bg-stone-700 disabled:opacity-40 transition-colors"
            >
              {saved[color.hex] ? "Saved" : saving[color.hex] ? "Saving…" : "Save"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── AllMappingsSection ───────────────────────────────────────────────────────

function AllMappingsSection() {
  const [mappings, setMappings] = useState<ColorMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch("/api/admin/color-mapping")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load mappings");
        return r.json() as Promise<{ mappings: ColorMapping[] }>;
      })
      .then((data) => setMappings(data.mappings))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Error"))
      .finally(() => setLoading(false));
  }, []);

  const handleDelete = useCallback(async (id: string, hex: string) => {
    if (!confirm(`Delete mapping for ${hex}?`)) return;
    setDeleting((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await fetch(`/api/admin/color-mapping/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({ error: "Delete failed" })) as { error: string };
        throw new Error(body.error);
      }
      setMappings((prev) => prev.filter((m) => m.id !== id));
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting((prev) => ({ ...prev, [id]: false }));
    }
  }, []);

  if (loading) {
    return <div className="py-16 text-center text-stone-400 text-sm">Loading…</div>;
  }
  if (error) {
    return <div className="py-10 text-center text-red-500 text-sm">{error}</div>;
  }

  const filtered = search.trim()
    ? mappings.filter(
        (m) =>
          m.renderedHex.includes(search.toLowerCase()) ||
          m.yarnCode.toLowerCase().includes(search.toLowerCase())
      )
    : mappings;

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <input
          type="text"
          placeholder="Search by hex or yarn code…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-3 py-2 text-sm border border-stone-200 rounded-lg bg-white placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/10"
        />
        <span className="text-xs text-stone-400 shrink-0">
          {filtered.length} mapping{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="py-12 text-center text-stone-400 text-sm">
          {search ? "No mappings match your search." : "No color mappings yet."}
        </div>
      ) : (
        <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
          {filtered.map((m, i) => (
            <div
              key={m.id}
              className={`flex items-center gap-3 px-3 py-2.5 hover:bg-stone-50 transition-colors ${
                i < filtered.length - 1 ? "border-b border-stone-100" : ""
              }`}
            >
              {/* Rendered hex swatch */}
              <div
                className="w-7 h-7 shrink-0 rounded border border-stone-200"
                style={{ backgroundColor: m.renderedHex }}
              />

              {/* Catalog hex swatch (may differ) */}
              {m.catalogHex && m.catalogHex !== m.renderedHex ? (
                <div
                  className="w-7 h-7 shrink-0 rounded border border-stone-200"
                  style={{ backgroundColor: m.catalogHex }}
                  title={`Catalog color: ${m.catalogHex}`}
                />
              ) : (
                <div className="w-7 shrink-0" />
              )}

              {/* Hex values */}
              <div className="w-28 shrink-0">
                <p className="text-xs font-mono text-stone-800">{m.renderedHex}</p>
                {m.catalogHex && m.catalogHex !== m.renderedHex && (
                  <p className="text-xs font-mono text-stone-400">{m.catalogHex}</p>
                )}
              </div>

              {/* Yarn code */}
              <span className="flex-1 text-sm font-medium text-stone-700">
                {m.yarnCode}
              </span>

              {/* Library badge */}
              <span className="text-xs text-stone-400 shrink-0">{m.library}</span>

              {/* Delete */}
              <button
                onClick={() => handleDelete(m.id, m.renderedHex)}
                disabled={deleting[m.id]}
                title="Delete mapping"
                className="shrink-0 p-1.5 rounded-md text-stone-300 hover:text-red-500 hover:bg-red-50 disabled:opacity-40 transition-colors"
              >
                <TrashIcon />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Shared components ────────────────────────────────────────────────────────

function SubTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
        active
          ? "border-stone-900 text-stone-900"
          : "border-transparent text-stone-500 hover:text-stone-700"
      }`}
    >
      {children}
    </button>
  );
}

function TrashIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}
