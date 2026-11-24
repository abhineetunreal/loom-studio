// Studio layout — no AppShell, no sidebar.
// The colour studio renders its own full-width header with branding, undo/redo
// and action buttons, so it doesn't need the main app chrome.

import type { Metadata } from "next";
import { getCurrentTenant } from "@/lib/tenant";

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getCurrentTenant();
  const title = tenant?.displayName ?? tenant?.name ?? "Loom Studio";
  return {
    title: `${title} — Colour Studio`,
    description: "Explore and customise rug colourways.",
    icons: tenant?.faviconUrl ? { icon: tenant.faviconUrl } : undefined,
  };
}

export default function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="flex flex-col h-dvh w-full overflow-hidden">{children}</div>;
}
