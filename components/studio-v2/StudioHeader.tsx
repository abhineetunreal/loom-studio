"use client";

/**
 * StudioHeader (spec §3): product · current design (thumb, name, number,
 * "Change design") · Undo / Redo / Compare · and on the right the two main
 * actions. Warm editorial chrome: serif names, mono numbers, cream ground.
 */

import Link from "next/link";

type Props = {
  productName: string;
  logoUrl: string | null;
  design: { id: string; name: string; slug: string; imageUrl: string; externalSku: string | null };
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onCompare: () => void;
  compareActive: boolean;
  onShortlist: () => void;
};

export default function StudioHeader({
  productName, logoUrl, design, onUndo, onRedo, canUndo, canRedo,
  onCompare, compareActive, onShortlist,
}: Props) {
  return (
    <header className="shrink-0 h-16 border-b border-[var(--line)] flex items-center gap-5 px-5 bg-[var(--panel)]">
      {/* Product */}
      <div className="flex items-center gap-2.5 shrink-0">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" crossOrigin="anonymous" className="h-7 w-7 rounded object-contain" />
        ) : (
          <span className="h-7 w-7 rounded bg-[var(--ink)]/90" />
        )}
        <span className="u-serif text-[19px] leading-none text-[var(--ink)] whitespace-nowrap">{productName}</span>
      </div>

      {/* Current design */}
      <div className="flex items-center gap-2.5 pl-5 border-l border-[var(--line)] min-w-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={design.imageUrl}
          alt=""
          crossOrigin="anonymous"
          className="h-9 w-9 rounded object-cover border border-[var(--line-strong)]"
        />
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="u-serif text-[17px] text-[var(--ink)] truncate">{design.name}</span>
          {design.externalSku && (
            <span className="u-mono text-[11px] text-[var(--ink-faint)] whitespace-nowrap">No. {design.externalSku}</span>
          )}
        </div>
        <Link
          href="/studio"
          className="u-mono text-[11px] text-[var(--ink-soft)] hover:text-[var(--ink)] underline underline-offset-2 whitespace-nowrap ml-1"
        >
          Change design
        </Link>
      </div>

      {/* Undo / Redo / Compare */}
      <div className="flex items-center gap-1 pl-4 border-l border-[var(--line)] shrink-0">
        <TextButton onClick={onUndo} disabled={!canUndo} icon={<UndoIcon />}>Undo</TextButton>
        <TextButton onClick={onRedo} disabled={!canRedo} icon={<RedoIcon />}>Redo</TextButton>
        <TextButton onClick={onCompare} active={compareActive} icon={<CompareIcon />}>Compare</TextButton>
      </div>

      {/* Main actions */}
      <div className="ml-auto flex items-center gap-2.5 shrink-0">
        <button
          onClick={onShortlist}
          className="flex flex-col items-start px-3.5 py-1.5 rounded-md border border-[var(--line-strong)] bg-[var(--raise)] text-left hover:border-[var(--ink-soft)] transition-colors"
        >
          <span className="text-[13px] font-medium text-[var(--ink)] leading-tight">Shortlist this colourway</span>
          <span className="u-mono text-[10px] text-[var(--ink-faint)] leading-tight mt-0.5">Keep it to step through or export</span>
        </button>
        <button
          className="flex flex-col items-start px-3.5 py-1.5 rounded-md bg-[var(--sel)] text-left hover:opacity-90 transition-opacity"
        >
          <span className="text-[13px] font-medium text-white leading-tight">Send request</span>
          <span className="u-mono text-[10px] text-white/60 leading-tight mt-0.5">price &amp; lead time</span>
        </button>
      </div>
    </header>
  );
}

function TextButton({
  children, onClick, disabled, active, icon,
}: { children: React.ReactNode; onClick: () => void; disabled?: boolean; active?: boolean; icon: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[13px] transition-colors disabled:opacity-30 ${
        active ? "bg-[var(--ink)] text-white" : "text-[var(--ink-soft)] hover:bg-[var(--line)]/50 hover:text-[var(--ink)]"
      }`}
    >
      <span className="w-4 h-4">{icon}</span>
      {children}
    </button>
  );
}

function UndoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-1" />
    </svg>
  );
}
function RedoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M15 14l5-5-5-5" /><path d="M20 9H9a5 5 0 0 0 0 10h1" />
    </svg>
  );
}
function CompareIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <rect x="3" y="4" width="7" height="16" rx="1" /><rect x="14" y="4" width="7" height="16" rx="1" />
    </svg>
  );
}
