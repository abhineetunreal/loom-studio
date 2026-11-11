"use client";

/**
 * LeftRail (spec §3 left column): FILL mode, the FOUR OPTIONS (idea generators),
 * and the SHORTLIST filmstrip with export. Mirrors the spec video layout.
 */

import type { IdeaKind } from "./StudioScreen";

export type ShortlistItem = { id: string; thumb: string | null; label: string };

type Props = {
  fillMode: "whole" | "area";
  onFillMode: (m: "whole" | "area") => void;
  onIdea: (kind: IdeaKind) => void;
  ideasEnabled: boolean;
  shortlist: ShortlistItem[];
  selectedShortlistId: string | null;
  onSelectShortlist: (id: string) => void;
  onRemoveShortlist: (id: string) => void;
  onExport: () => void;
};

const IDEAS: { kind: IdeaKind; label: string }[] = [
  { kind: "slight", label: "Slight" },
  { kind: "full", label: "Full" },
  { kind: "family", label: "Tone to tone" },
  { kind: "shuffle", label: "Shuffle" },
];

export default function LeftRail({
  fillMode, onFillMode, onIdea, ideasEnabled,
  shortlist, selectedShortlistId, onSelectShortlist, onRemoveShortlist, onExport,
}: Props) {
  return (
    <aside className="w-[188px] shrink-0 border-r border-[var(--line)] bg-[var(--panel)] flex flex-col min-h-0 overflow-y-auto">
      {/* FILL */}
      <div className="px-4 pt-4 pb-3 border-b border-[var(--line)]">
        <h3 className="u-label mb-2">Fill</h3>
        <div className="flex flex-col gap-1.5">
          <FillOption
            active={fillMode === "whole"}
            onClick={() => onFillMode("whole")}
            title="Whole colour"
            sub="changes it everywhere"
          />
          <FillOption
            active={fillMode === "area"}
            onClick={() => onFillMode("area")}
            title="Chosen areas"
            sub="only the patches you tap"
          />
        </div>
      </div>

      {/* FOUR OPTIONS */}
      <div className="px-4 pt-4 pb-3 border-b border-[var(--line)]">
        <h3 className="u-label mb-2">Four options</h3>
        <div className="grid grid-cols-2 gap-1.5">
          {IDEAS.map((i) => (
            <button
              key={i.kind}
              onClick={() => onIdea(i.kind)}
              disabled={!ideasEnabled}
              className="px-2 py-1.5 rounded-md text-[12.5px] text-[var(--ink)] bg-[var(--raise)] border border-[var(--line-strong)] hover:border-[var(--ink-soft)] disabled:opacity-40 disabled:hover:border-[var(--line-strong)] transition-colors"
            >
              {i.label}
            </button>
          ))}
        </div>
      </div>

      {/* SHORTLIST */}
      <div className="px-4 pt-4 pb-4 flex-1 min-h-0">
        <div className="flex items-center justify-between mb-2">
          <h3 className="u-label">Shortlist · {shortlist.length}</h3>
          <button
            onClick={onExport}
            disabled={shortlist.length === 0}
            className="u-mono text-[11px] text-[var(--ink-soft)] hover:text-[var(--ink)] underline underline-offset-2 disabled:opacity-40 disabled:no-underline"
          >
            Export
          </button>
        </div>
        {shortlist.length === 0 ? (
          <p className="u-mono text-[11px] text-[var(--ink-faint)] leading-relaxed">
            Shortlist a colourway to keep it here.
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {shortlist.map((s, idx) => (
              <div key={s.id} className="group relative">
                <button
                  onClick={() => onSelectShortlist(s.id)}
                  className={`block w-full rounded-md overflow-hidden border transition-colors ${
                    selectedShortlistId === s.id ? "border-[var(--ink)]" : "border-[var(--line-strong)] hover:border-[var(--ink-soft)]"
                  }`}
                >
                  {s.thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.thumb} alt="" className="w-full aspect-[3/4] object-cover" />
                  ) : (
                    <div className="w-full aspect-[3/4] bg-[var(--raise)]" />
                  )}
                </button>
                <span className="u-mono text-[10px] text-[var(--ink-faint)] mt-1 block">Option {idx + 1}</span>
                <button
                  onClick={() => onRemoveShortlist(s.id)}
                  title="Remove"
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[var(--ink)] text-white text-[12px] leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function FillOption({
  active, onClick, title, sub,
}: { active: boolean; onClick: () => void; title: string; sub: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex flex-col items-start px-2.5 py-1.5 rounded-md text-left border transition-colors ${
        active
          ? "bg-[var(--sel)] border-[var(--sel)]"
          : "bg-[var(--raise)] border-[var(--line-strong)] hover:border-[var(--ink-soft)]"
      }`}
    >
      <span className={`text-[13px] font-medium leading-tight ${active ? "text-white" : "text-[var(--ink)]"}`}>{title}</span>
      <span className={`u-mono text-[10px] leading-tight mt-0.5 ${active ? "text-white/60" : "text-[var(--ink-faint)]"}`}>{sub}</span>
    </button>
  );
}
