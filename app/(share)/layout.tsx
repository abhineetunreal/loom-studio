// Share layout — bare wrapper, no AppShell.
// The share page renders its own header and has no sidebar/auth.

import type { Metadata } from "next";
import { getCurrentTenant } from "@/lib/tenant";

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getCurrentTenant();
  const title = tenant?.displayName ?? tenant?.name ?? "Loom Studio";
  return {
    title: `${title} — Design Review`,
    description: "Review and approve your rug design colorway.",
    icons: tenant?.faviconUrl ? { icon: tenant.faviconUrl } : undefined,
  };
}

export default function ShareLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
