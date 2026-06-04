"use client";

import { useState } from "react";
import Link from "next/link";
import LeftPanel from "@/components/catalog/LeftPanel";
import type { DesignSummary, TierInfo } from "@/types";

type Props = {
  designs: DesignSummary[];
  tierInfo: TierInfo;
  children: React.ReactNode;
};

export default function AppShell({ designs, tierInfo, children }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const showBanner = tierInfo.tier === "demo";

  return (
    <>
      {/* Demo / pending banner */}
      {showBanner && (
        <div
          className={`shrink-0 px-4 py-2 text-xs flex items-center justify-center gap-2 ${
            tierInfo.pendingApproval
              ? "bg-amber-50 text-amber-800 border-b border-amber-200"
              : "bg-stone-100 text-stone-600 border-b border-stone-200"
          }`}
        >
          {tierInfo.pendingApproval ? (
            <span>Your account is pending approval. Contact your admin for access.</span>
          ) : (
            <>
              <span>You&apos;re viewing a demo.</span>
              <Link
                href="/auth/signin"
                className="font-medium underline underline-offset-2 hover:text-stone-900 transition-colors"
              >
                Sign in for full access →
              </Link>
            </>
          )}
        </div>
      )}

      <header className="border-b border-stone-200 px-4 py-3 flex items-center gap-3 shrink-0 bg-white z-10">
        <button
          className="lg:hidden p-1.5 rounded-lg hover:bg-stone-100 text-stone-500 transition-colors"
          onClick={() => setMobileOpen(true)}
          aria-label="Open design browser"
        >
          <MenuIcon />
        </button>
        <span className="font-semibold tracking-tight text-lg">Loom Studio</span>
      </header>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <LeftPanel
          designs={designs}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((v) => !v)}
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileOpen(false)}
        />
        <main className="flex-1 overflow-hidden min-w-0">{children}</main>
      </div>
    </>
  );
}

function MenuIcon() {
  return (
    <svg
      className="w-5 h-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 6h16M4 12h16M4 18h16"
      />
    </svg>
  );
}
