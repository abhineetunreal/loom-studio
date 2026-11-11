// Studio v2 — parallel redesign of the colouring screen (spec: 10 Nov 2026).
// Lives in its own route group so it shares the entire backend (DB, recolor
// engine, yarn libraries, auth) with the current app but renders a clean,
// white-background single screen independent of AppShell.
//
// Preview-only while in development; promoted by swapping routes once final.

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Loom Studio",
};

export default function StudioV2Layout({ children }: { children: React.ReactNode }) {
  // Fixed white background everywhere (spec §10.2): surrounding colour changes
  // how a colour reads, so the stage, lists and page chrome are all neutral.
  return (
    <div className="min-h-dvh bg-white text-neutral-900 antialiased">
      {children}
    </div>
  );
}
