"use client";

/**
 * StudioHeader (spec §3): product name · current design (thumb, name, number,
 * "Change design") · Undo/Redo/Compare · and on the right the two main buttons
 * with a line of what they do. White theme, neutral chrome.
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
};

export default function StudioHeader({
  productName, logoUrl, design, onUndo, onRedo, canUndo, canRedo,
}: Props) {
  return (
    <header className="shrink-0 h-14 border-b border-neutral-200 flex items-center gap-4 px-4 bg-white">
      {/* Product */}
      <div className="flex items-center gap-2 min-w-0">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" crossOrigin="anonymous" className="h-6 w-auto object-contain" />
        ) : null}
        <span className="text-[15px] font-semibold text-neutral-900 truncate">{productName}</span>
      </div>

      {/* Current design */}
      <div className="flex items-center gap-2 pl-4 ml-1 border-l border-neutral-200 min-w-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={design.imageUrl}
          alt=""
          crossOrigin="anonymous"
          className="h-9 w-9 rounded object-cover border border-neutral-200"
        />
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-neutral-800 truncate leading-tight">{design.name}</div>
          {design.externalSku && (
            <div className="text-[11px] text-neutral-400 truncate leading-tight">{design.externalSku}</div>
          )}
        </div>
        <Link
          href="/studio"
          className="ml-1 text-[12px] text-neutral-500 hover:text-neutral-800 underline-offset-2 hover:underline"
        >
          Change design
        </Link>
      </div>

      {/* Undo / Redo / Compare */}
      <div className="flex items-center gap-1 pl-4 ml-1 border-l border-neutral-200">
        <HeaderButton onClick={onUndo} disabled={!canUndo} label="Undo">
          <UndoIcon />
        </HeaderButton>
        <HeaderButton onClick={onRedo} disabled={!canRedo} label="Redo">
          <RedoIcon />
        </HeaderButton>
        <HeaderButton onClick={() => { /* compare — next pass */ }} disabled label="Compare">
          <CompareIcon />
        </HeaderButton>
      </div>

      {/* Main actions */}
      <div className="ml-auto flex items-center gap-2">
        <button
          disabled
          className="flex flex-col items-start px-3 py-1.5 rounded-md border border-neutral-200 text-left disabled:opacity-50"
        >
          <span className="text-[13px] font-medium text-neutral-800 leading-tight">Shortlist</span>
          <span className="text-[10px] text-neutral-400 leading-tight">save this colourway</span>
        </button>
        <button
          disabled
          className="flex flex-col items-start px-3 py-1.5 rounded-md bg-neutral-900 text-white text-left disabled:opacity-50"
        >
          <span className="text-[13px] font-medium leading-tight">Send request</span>
          <span className="text-[10px] text-neutral-300 leading-tight">price &amp; lead time</span>
        </button>
      </div>
    </header>
  );
}

function HeaderButton({
  children, onClick, disabled, label,
}: { children: React.ReactNode; onClick: () => void; disabled?: boolean; label: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="w-8 h-8 flex items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
    >
      {children}
    </button>
  );
}

function UndoIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-1" />
    </svg>
  );
}
function RedoIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 14l5-5-5-5" /><path d="M20 9H9a5 5 0 0 0 0 10h1" />
    </svg>
  );
}
function CompareIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="7" height="16" rx="1" /><rect x="14" y="4" width="7" height="16" rx="1" />
    </svg>
  );
}
