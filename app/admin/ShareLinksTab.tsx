"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";

// ─── Types ──────────────────────────────────────────────────────────────────

type ShareLinkData = {
  id: string;
  slug: string;
  clientName: string;
  clientEmail: string;
  primaryDesignId: string;
  additionalDesignIds: string[];
  allowedLibraries: string[];
  presets: { colorwayId: string; displayName: string }[];
  createdBy: string;
  isActive: boolean;
  createdAt: string;
  primaryDesign: { id: string; name: string; imageUrl: string };
  _count: { sessions: number; approvals: number };
  sessionStats: {
    totalVisits: number;
    lastVisitAt: string | null;
    hasEmailMismatch: boolean;
  };
  shareUrl: string;
};

type DesignOption = {
  id: string;
  name: string;
  imageUrl: string;
  externalSku: string | null;
};

type LibraryInfo = {
  material: string;
  count: number;
};

type ColorwayOption = {
  id: string;
  name: string;
  snapshotUrl: string | null;
  designId: string;
};

// ─── Main Tab ───────────────────────────────────────────────────────────────

export function ShareLinksTab() {
  const [links, setLinks] = useState<ShareLinkData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const fetchLinks = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/share-links")
      .then((r) => {
        if (!r.ok) throw new Error("Failed");
        return r.json();
      })
      .then((data) => setLinks(data.shareLinks))
      .catch(() => setError("Failed to load share links."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchLinks(); }, [fetchLinks]);

  const activeCount = links.filter((l) => l.isActive).length;
  const totalVisits = links.reduce((s, l) => s + l.sessionStats.totalVisits, 0);
  const approvalCount = links.reduce((s, l) => s + l._count.approvals, 0);

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-stone-900">Share links</h2>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-3 py-2 text-sm font-medium bg-stone-900 text-white rounded-lg hover:bg-stone-700 transition-colors whitespace-nowrap"
        >
          Create share link
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Active links" value={activeCount} />
        <StatCard label="Total visits" value={totalVisits} />
        <StatCard label="Approvals" value={approvalCount} />
      </div>

      {/* Links list */}
      {loading ? (
        <div className="text-center py-12 text-stone-400 text-sm">Loading…</div>
      ) : error ? (
        <div className="text-center py-12 text-red-500 text-sm">{error}</div>
      ) : links.length === 0 ? (
        <div className="text-center py-12 text-stone-400 text-sm">
          No share links yet. Create one to get started.
        </div>
      ) : (
        <div className="space-y-2">
          {links.map((link) => (
            <ShareLinkRow key={link.id} link={link} onRefresh={fetchLinks} />
          ))}
        </div>
      )}

      {showCreateModal && (
        <CreateShareLinkModal
          onClose={() => setShowCreateModal(false)}
          onCreated={fetchLinks}
        />
      )}
    </div>
  );
}

// ─── Stat Card ──────────────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white px-4 py-3">
      <div className="text-2xl font-semibold text-stone-900">{value}</div>
      <div className="text-xs mt-0.5 text-stone-500">{label}</div>
    </div>
  );
}

// ─── Share Link Row ─────────────────────────────────────────────────────────

function ShareLinkRow({
  link,
  onRefresh,
}: {
  link: ShareLinkData;
  onRefresh: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  const additionalCount = (link.additionalDesignIds as string[]).length;

  const handleCopyLink = async () => {
    await navigator.clipboard.writeText(link.shareUrl);
    setMenuOpen(false);
  };

  const handleToggleActive = async () => {
    setBusy(true);
    setMenuOpen(false);
    try {
      await fetch(`/api/admin/share-links/${link.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !link.isActive }),
      });
      onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete share link for "${link.clientName}"? This cannot be undone.`)) return;
    setBusy(true);
    setMenuOpen(false);
    try {
      await fetch(`/api/admin/share-links/${link.id}`, { method: "DELETE" });
      onRefresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`bg-white border border-stone-200 rounded-lg px-4 py-3 flex items-center gap-4 ${busy ? "opacity-50" : ""}`}>
      {/* Design thumbnail */}
      <div className="w-10 h-10 rounded bg-stone-100 overflow-hidden shrink-0">
        {link.primaryDesign.imageUrl && (
          <Image
            src={link.primaryDesign.imageUrl}
            alt={link.primaryDesign.name}
            width={40}
            height={40}
            className="w-full h-full object-cover"
          />
        )}
      </div>

      {/* Client info */}
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm text-stone-900 truncate">
          {link.clientName}
        </div>
        <div className="text-xs text-stone-400 truncate">{link.clientEmail}</div>
      </div>

      {/* Design info */}
      <div className="hidden sm:block text-xs text-stone-600 max-w-[180px] truncate">
        {link.primaryDesign.name}
        {additionalCount > 0 && (
          <span className="text-stone-400"> + {additionalCount} more</span>
        )}
      </div>

      {/* Created date */}
      <div className="hidden sm:block text-xs text-stone-400 whitespace-nowrap">
        {relativeDate(link.createdAt)}
      </div>

      {/* Visit + approval counts */}
      <div className="flex items-center gap-3 text-xs text-stone-500">
        <span title="Visits">{link.sessionStats.totalVisits} visits</span>
        <span title="Approvals">{link._count.approvals} approvals</span>
      </div>

      {/* Badges */}
      <div className="flex items-center gap-1.5">
        <span
          className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
            link.isActive
              ? "bg-green-50 text-green-700 border border-green-200"
              : "bg-stone-100 text-stone-500 border border-stone-200"
          }`}
        >
          {link.isActive ? "Active" : "Paused"}
        </span>
        {link.sessionStats.hasEmailMismatch && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
            Email mismatch
          </span>
        )}
      </div>

      {/* Menu */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="p-1.5 rounded-md hover:bg-stone-100 text-stone-400 hover:text-stone-600 transition-colors"
        >
          <DotsIcon />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-8 z-20 bg-white border border-stone-200 rounded-lg shadow-lg py-1 min-w-[160px]">
            <MenuButton onClick={handleCopyLink}>Copy link</MenuButton>
            <MenuButton onClick={handleToggleActive}>
              {link.isActive ? "Deactivate" : "Activate"}
            </MenuButton>
            <MenuButton onClick={handleDelete} danger>
              Delete
            </MenuButton>
          </div>
        )}
      </div>
    </div>
  );
}

function MenuButton({
  onClick,
  children,
  danger,
}: {
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
        danger
          ? "text-red-600 hover:bg-red-50"
          : "text-stone-700 hover:bg-stone-50"
      }`}
    >
      {children}
    </button>
  );
}

// ─── Create Share Link Modal ────────────────────────────────────────────────

type CreateStage = "form" | "success";

function CreateShareLinkModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [stage, setStage] = useState<CreateStage>("form");

  // Form fields
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [primaryDesignId, setPrimaryDesignId] = useState("");
  const [additionalDesignIds, setAdditionalDesignIds] = useState<string[]>([]);
  const [allowedLibraries, setAllowedLibraries] = useState<string[]>([]);
  const [presets, setPresets] = useState<{ colorwayId: string; displayName: string }[]>([]);

  // Data for pickers
  const [designs, setDesigns] = useState<DesignOption[]>([]);
  const [libraries, setLibraries] = useState<LibraryInfo[]>([]);
  const [colorways, setColorways] = useState<ColorwayOption[]>([]);
  const [designSearch, setDesignSearch] = useState("");
  const [addDesignSearch, setAddDesignSearch] = useState("");

  // State
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [createdLink, setCreatedLink] = useState<{
    shareUrl: string;
    clientName: string;
    clientEmail: string;
  } | null>(null);
  const [copyToast, setCopyToast] = useState(false);

  // Preset picker
  const [showPresetPicker, setShowPresetPicker] = useState(false);

  // Load designs
  useEffect(() => {
    fetch("/api/admin/designs")
      .then((r) => r.json())
      .then((data) => {
        const d = (data.designs ?? data) as DesignOption[];
        setDesigns(d);
      })
      .catch(() => {});
  }, []);

  // Load yarn libraries (unique materials + counts)
  useEffect(() => {
    fetch("/api/admin/share-links/libraries")
      .then((r) => r.json())
      .then((data) => {
        const libs = data.libraries as LibraryInfo[];
        setLibraries(libs);
        // Default: all selected
        setAllowedLibraries(libs.map((l) => l.material));
      })
      .catch(() => {});
  }, []);

  // Load colorways when primary design changes
  useEffect(() => {
    if (!primaryDesignId) {
      setColorways([]);
      return;
    }
    fetch(`/api/admin/share-links/colorways?designId=${primaryDesignId}`)
      .then((r) => r.json())
      .then((data) => setColorways(data.colorways ?? []))
      .catch(() => {});
  }, [primaryDesignId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!clientName.trim() || !clientEmail.trim() || !primaryDesignId) {
      setFormError("Please fill in all required fields.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/share-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: clientName.trim(),
          clientEmail: clientEmail.trim(),
          primaryDesignId,
          additionalDesignIds,
          allowedLibraries,
          presets,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Failed to create share link");
      }

      const data = await res.json();
      setCreatedLink({
        shareUrl: data.shareUrl,
        clientName: clientName.trim(),
        clientEmail: clientEmail.trim(),
      });
      setStage("success");
      onCreated();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyUrl = async () => {
    if (!createdLink) return;
    await navigator.clipboard.writeText(createdLink.shareUrl);
    setCopyToast(true);
    setTimeout(() => setCopyToast(false), 2000);
  };

  const handleEmailClient = () => {
    if (!createdLink) return;
    const subject = encodeURIComponent("Your rug design is ready for review");
    const body = encodeURIComponent(
      `Hi ${createdLink.clientName},\n\nYour rug design is ready for review. Click the link below to view and approve your colorway:\n\n${createdLink.shareUrl}\n\nPlease let us know if you have any questions.`
    );
    window.open(`mailto:${createdLink.clientEmail}?subject=${subject}&body=${body}`);
  };

  // Design search filtering
  const filteredDesigns = designSearch.trim()
    ? designs.filter(
        (d) =>
          d.name.toLowerCase().includes(designSearch.toLowerCase()) ||
          (d.externalSku ?? "").toLowerCase().includes(designSearch.toLowerCase())
      )
    : designs;

  const filteredAddDesigns = addDesignSearch.trim()
    ? designs.filter(
        (d) =>
          d.id !== primaryDesignId &&
          !additionalDesignIds.includes(d.id) &&
          (d.name.toLowerCase().includes(addDesignSearch.toLowerCase()) ||
           (d.externalSku ?? "").toLowerCase().includes(addDesignSearch.toLowerCase()))
      )
    : designs.filter(
        (d) => d.id !== primaryDesignId && !additionalDesignIds.includes(d.id)
      );

  const selectedPrimaryDesign = designs.find((d) => d.id === primaryDesignId);

  if (stage === "success" && createdLink) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
          <div className="px-6 py-8 text-center">
            {/* Green check */}
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center">
              <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-stone-900 mb-1">Share link created</h3>
            <p className="text-sm text-stone-500 mb-6">
              For {createdLink.clientName} · {createdLink.clientEmail}
            </p>

            {/* URL box */}
            <div className="flex items-center gap-2 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2.5 mb-6">
              <code className="flex-1 text-xs text-stone-700 truncate font-mono">
                {createdLink.shareUrl}
              </code>
              <button
                onClick={handleCopyUrl}
                className="shrink-0 text-xs font-medium px-2.5 py-1 rounded-md bg-stone-900 text-white hover:bg-stone-700 transition-colors"
              >
                {copyToast ? "Copied!" : "Copy"}
              </button>
            </div>

            {/* Action buttons */}
            <div className="flex flex-col gap-2">
              <button
                onClick={handleEmailClient}
                className="w-full px-4 py-2 text-sm font-medium border border-stone-200 text-stone-700 rounded-lg hover:bg-stone-50 transition-colors"
              >
                Email to client
              </button>
              <button
                onClick={() => window.open(createdLink.shareUrl, "_blank")}
                className="w-full px-4 py-2 text-sm font-medium border border-stone-200 text-stone-700 rounded-lg hover:bg-stone-50 transition-colors"
              >
                Open preview
              </button>
              <button
                onClick={onClose}
                className="w-full px-4 py-2 text-sm font-medium bg-stone-900 text-white rounded-lg hover:bg-stone-700 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-stone-100 shrink-0">
          <p className="font-medium text-stone-900">Create share link</p>
          <p className="text-xs text-stone-400 mt-0.5">
            Create a curated link for a client to review and approve their rug design.
          </p>
        </div>

        {/* Scrollable form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Client name */}
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1">
              Client name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Jane Smith"
              className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg bg-white placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/10"
            />
          </div>

          {/* Client email */}
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1">
              Client email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              required
              value={clientEmail}
              onChange={(e) => setClientEmail(e.target.value)}
              placeholder="jane@example.com"
              className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg bg-white placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/10"
            />
          </div>

          {/* Primary design */}
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1">
              Primary design <span className="text-red-500">*</span>
            </label>
            {selectedPrimaryDesign ? (
              <div className="flex items-center gap-3 p-2 border border-stone-200 rounded-lg bg-stone-50">
                <div className="w-8 h-8 rounded bg-stone-200 overflow-hidden shrink-0">
                  <Image
                    src={selectedPrimaryDesign.imageUrl}
                    alt={selectedPrimaryDesign.name}
                    width={32}
                    height={32}
                    className="w-full h-full object-cover"
                  />
                </div>
                <span className="text-sm text-stone-800 flex-1 truncate">
                  {selectedPrimaryDesign.name}
                </span>
                <button
                  type="button"
                  onClick={() => { setPrimaryDesignId(""); setPresets([]); }}
                  className="text-xs text-stone-400 hover:text-stone-600"
                >
                  Change
                </button>
              </div>
            ) : (
              <div>
                <input
                  type="text"
                  value={designSearch}
                  onChange={(e) => setDesignSearch(e.target.value)}
                  placeholder="Search designs…"
                  className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg bg-white placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/10"
                />
                {designs.length > 0 && (
                  <div className="mt-1 border border-stone-200 rounded-lg max-h-40 overflow-y-auto bg-white">
                    {filteredDesigns.slice(0, 20).map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => { setPrimaryDesignId(d.id); setDesignSearch(""); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-stone-50 transition-colors"
                      >
                        <div className="w-6 h-6 rounded bg-stone-100 overflow-hidden shrink-0">
                          <Image src={d.imageUrl} alt={d.name} width={24} height={24} className="w-full h-full object-cover" />
                        </div>
                        <span className="text-sm text-stone-800 truncate">{d.name}</span>
                        {d.externalSku && (
                          <span className="text-xs text-stone-400 ml-auto shrink-0">{d.externalSku}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Additional designs */}
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1">
              Additional designs <span className="text-stone-400 font-normal">(optional)</span>
            </label>
            {/* Selected chips */}
            {additionalDesignIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {additionalDesignIds.map((did) => {
                  const d = designs.find((x) => x.id === did);
                  return (
                    <span
                      key={did}
                      className="flex items-center gap-1 text-xs bg-stone-100 text-stone-700 px-2 py-1 rounded-md"
                    >
                      {d?.name ?? did}
                      <button
                        type="button"
                        onClick={() => setAdditionalDesignIds((ids) => ids.filter((x) => x !== did))}
                        className="text-stone-400 hover:text-stone-600 ml-0.5"
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            <input
              type="text"
              value={addDesignSearch}
              onChange={(e) => setAddDesignSearch(e.target.value)}
              placeholder="Search to add…"
              className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg bg-white placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/10"
            />
            {addDesignSearch.trim() && filteredAddDesigns.length > 0 && (
              <div className="mt-1 border border-stone-200 rounded-lg max-h-32 overflow-y-auto bg-white">
                {filteredAddDesigns.slice(0, 10).map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => {
                      setAdditionalDesignIds((ids) => [...ids, d.id]);
                      setAddDesignSearch("");
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-stone-50 transition-colors"
                  >
                    <div className="w-6 h-6 rounded bg-stone-100 overflow-hidden shrink-0">
                      <Image src={d.imageUrl} alt={d.name} width={24} height={24} className="w-full h-full object-cover" />
                    </div>
                    <span className="text-sm text-stone-800 truncate">{d.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Allowed yarn libraries */}
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1.5">
              Allowed yarn libraries
            </label>
            {libraries.length === 0 ? (
              <p className="text-xs text-stone-400">Loading…</p>
            ) : (
              <div className="space-y-1.5">
                {libraries.map((lib) => (
                  <label
                    key={lib.material}
                    className="flex items-center gap-2 text-sm text-stone-700 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={allowedLibraries.includes(lib.material)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setAllowedLibraries((prev) => [...prev, lib.material]);
                        } else {
                          setAllowedLibraries((prev) =>
                            prev.filter((m) => m !== lib.material)
                          );
                        }
                      }}
                      className="rounded border-stone-300"
                    />
                    {lib.material}
                    <span className="text-xs text-stone-400">({lib.count} yarns)</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Preset colorways */}
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1.5">
              Preset colorways <span className="text-stone-400 font-normal">(optional)</span>
            </label>
            {!primaryDesignId ? (
              <p className="text-xs text-stone-400">Select a primary design first.</p>
            ) : (
              <>
                {/* Attached presets */}
                {presets.length > 0 && (
                  <div className="space-y-1.5 mb-2">
                    {presets.map((preset, i) => {
                      const cw = colorways.find((c) => c.id === preset.colorwayId);
                      return (
                        <div
                          key={preset.colorwayId}
                          className="flex items-center gap-2 p-2 border border-stone-200 rounded-lg bg-stone-50"
                        >
                          {cw?.snapshotUrl && (
                            <div className="w-8 h-8 rounded bg-stone-200 overflow-hidden shrink-0">
                              <Image
                                src={cw.snapshotUrl}
                                alt={preset.displayName}
                                width={32}
                                height={32}
                                className="w-full h-full object-cover"
                              />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <input
                              type="text"
                              value={preset.displayName}
                              onChange={(e) => {
                                const next = [...presets];
                                next[i] = { ...next[i], displayName: e.target.value };
                                setPresets(next);
                              }}
                              className="w-full text-sm bg-transparent border-none p-0 focus:outline-none text-stone-800"
                            />
                            {cw && cw.name !== preset.displayName && (
                              <div className="text-[10px] text-stone-400 truncate">{cw.name}</div>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => setPresets((p) => p.filter((_, j) => j !== i))}
                            className="text-xs text-stone-400 hover:text-stone-600 shrink-0"
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setShowPresetPicker(true)}
                  className="text-xs font-medium text-stone-600 border border-stone-200 rounded-md px-2.5 py-1.5 hover:bg-stone-50 transition-colors"
                >
                  Attach saved colorway
                </button>
                {showPresetPicker && (
                  <div className="mt-1 border border-stone-200 rounded-lg max-h-40 overflow-y-auto bg-white">
                    {colorways.length === 0 ? (
                      <p className="px-3 py-4 text-xs text-stone-400 text-center">
                        No saved colorways for this design.
                      </p>
                    ) : (
                      colorways
                        .filter((c) => !presets.some((p) => p.colorwayId === c.id))
                        .map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              setPresets((p) => [
                                ...p,
                                { colorwayId: c.id, displayName: c.name },
                              ]);
                              setShowPresetPicker(false);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-stone-50 transition-colors"
                          >
                            {c.snapshotUrl && (
                              <div className="w-6 h-6 rounded bg-stone-100 overflow-hidden shrink-0">
                                <Image src={c.snapshotUrl} alt={c.name} width={24} height={24} className="w-full h-full object-cover" />
                              </div>
                            )}
                            <span className="text-sm text-stone-800 truncate">{c.name}</span>
                          </button>
                        ))
                    )}
                    <button
                      type="button"
                      onClick={() => setShowPresetPicker(false)}
                      className="w-full px-3 py-1.5 text-xs text-stone-400 hover:text-stone-600 border-t border-stone-100"
                    >
                      Close
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {formError && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {formError}
            </p>
          )}
        </form>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-stone-100 flex justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-stone-600 hover:text-stone-900 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 py-1.5 text-sm font-medium bg-stone-900 text-white rounded-lg hover:bg-stone-700 disabled:opacity-50 transition-colors"
          >
            {submitting ? "Creating…" : "Create link"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Icons ──────────────────────────────────────────────────────────────────

function DotsIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="5" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="19" r="1.5" />
    </svg>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function relativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
