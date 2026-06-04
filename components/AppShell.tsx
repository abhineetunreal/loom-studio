"use client";

import { useState } from "react";
import LeftPanel from "@/components/catalog/LeftPanel";
import type { DesignSummary } from "@/types";

type Props = {
  designs: DesignSummary[];
  children: React.ReactNode;
};

export default function AppShell({ designs, children }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
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
