// Root layout — minimal shell shared by all route groups.
// AppShell wrapping is done in (main)/layout.tsx, not here.
// Share pages in (share)/ render without AppShell.

import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { getCurrentTenant } from "@/lib/tenant";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getCurrentTenant();
  const title = tenant?.displayName ?? tenant?.name ?? "Loom Studio";
  return {
    title,
    description: "Browse and customize hand-knotted rug designs.",
    icons: tenant?.faviconUrl ? { icon: tenant.faviconUrl } : undefined,
  };
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable} h-full antialiased`}>
      <body className="h-full flex flex-col bg-stone-50 text-stone-900">
        {children}
      </body>
    </html>
  );
}
