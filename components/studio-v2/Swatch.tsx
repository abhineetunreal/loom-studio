"use client";

/**
 * Swatch — a single wool chip. Shows the yarn's photographic swatch when it has
 * one (renderType "photo"), otherwise a flat fill of its hex. Light chips get a
 * hairline so they read on cream. Optional selection ring, padlock, and an
 * "in use" dot (a colour currently placed in the rug).
 */

import type { YarnOption } from "@/types";

function isLight(hex: string): boolean {
  const h = hex.replace("#", "");
  if (h.length < 6) return false;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 210;
}

type Props = {
  yarn: YarnOption;
  selected?: boolean;
  locked?: boolean;
  inUse?: boolean;
  onClick?: () => void;
  onToggleLock?: () => void;
  title?: string;
  className?: string;
};

export default function Swatch({
  yarn, selected, locked, inUse, onClick, onToggleLock, title, className = "",
}: Props) {
  const photo = yarn.renderType === "photo" && yarn.swatchImageUrl;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? yarn.name ?? yarn.code}
      className={`relative aspect-square w-full rounded-[3px] overflow-hidden transition-shadow ${
        selected
          ? "ring-2 ring-[var(--sel)] ring-offset-2 ring-offset-[var(--panel)]"
          : "hover:ring-1 hover:ring-[var(--line-strong)]"
      } ${!photo && isLight(yarn.hex) ? "border border-[var(--line-strong)]" : ""} ${className}`}
      style={
        photo
          ? { backgroundImage: `url(${yarn.swatchImageUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
          : { backgroundColor: yarn.hex }
      }
    >
      {inUse && (
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.25)]" />
      )}
      {onToggleLock && (
        <span
          role="button"
          tabIndex={-1}
          onClick={(e) => { e.stopPropagation(); onToggleLock(); }}
          title={locked ? "Unlock" : "Lock this colour"}
          className={`absolute top-0.5 right-0.5 w-4 h-4 flex items-center justify-center rounded-[2px] ${
            locked ? "bg-[var(--ink)] text-white" : "bg-white/70 text-[var(--ink-soft)] opacity-0 group-hover:opacity-100"
          }`}
        >
          <LockIcon open={!locked} />
        </span>
      )}
    </button>
  );
}

function LockIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="9" rx="1.5" />
      {open ? <path d="M8 11V7a4 4 0 0 1 7.5-2" /> : <path d="M8 11V7a4 4 0 0 1 8 0v4" />}
    </svg>
  );
}
