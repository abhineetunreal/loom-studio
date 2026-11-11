import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Loom Studio",
  description: "Colour a rug in real wool.",
};

/**
 * Studio v2 shell — a warm, editorial canvas distinct from the production app.
 * Theme tokens live here as CSS variables so every v2 component can lean on the
 * same cream/ink palette and the serif + mono type pairing.
 */
export default function StudioV2Layout({ children }: { children: ReactNode }) {
  return (
    <div className="studio-v2-root min-h-dvh antialiased">
      <style>{`
        .studio-v2-root {
          /* Warm editorial palette */
          --paper: #efe9dd;        /* page / stage */
          --panel: #f4efe4;        /* side panels */
          --raise: #faf7ef;        /* raised tiles, inputs */
          --ink: #2c2a24;          /* primary text */
          --ink-soft: #6f6a5d;     /* secondary text */
          --ink-faint: #9a9484;    /* tertiary / labels */
          --line: #ddd5c5;         /* hairlines */
          --line-strong: #cfc6b2;
          --sel: #2c2a24;          /* selection / primary button */
          background: var(--paper);
          color: var(--ink);
          --font-serif: Georgia, "Times New Roman", serif;
          --font-mono: ui-monospace, "SF Mono", "Menlo", "Consolas", monospace;
        }
        .studio-v2-root .u-label {
          font-family: var(--font-mono);
          text-transform: uppercase;
          letter-spacing: 0.14em;
          font-size: 11px;
          color: var(--ink-faint);
        }
        .studio-v2-root .u-serif { font-family: var(--font-serif); }
        .studio-v2-root .u-mono { font-family: var(--font-mono); }
      `}</style>
      {children}
    </div>
  );
}
