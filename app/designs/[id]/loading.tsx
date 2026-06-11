/**
 * Loading skeleton for /designs/[id].
 *
 * Next.js wraps this route segment in a Suspense boundary and shows this
 * component immediately when a design link is clicked — before the server
 * has finished fetching design data. Matches DesignViewer's three-panel
 * layout (canvas + palette + yarn picker) so there's no layout shift when
 * the real page replaces it.
 */
export default function Loading() {
  return (
    <div className="relative flex h-full overflow-hidden">
      {/* Canvas area — matches CanvasZone's flex-col layout */}
      <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden bg-[#e8e5dd]">
        <div className="flex-1 flex items-center justify-center">
          <SpinnerIcon />
        </div>
        {/* Toolbar strip placeholder */}
        <div className="h-10 shrink-0 bg-white border-t border-stone-200" />
      </div>

      {/* Palette panel placeholder — matches CompactPalette column */}
      <div className="shrink-0 w-[13%] min-w-[160px] border-l border-stone-200 bg-white" />

      {/* Yarn picker placeholder — matches InlineYarnPicker column */}
      <div className="shrink-0 w-[16%] min-w-[200px] border-l border-stone-200 bg-white" />
    </div>
  );
}

function SpinnerIcon() {
  return (
    <svg
      className="w-8 h-8 text-stone-400 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-label="Loading design…"
    >
      <path strokeLinecap="round" d="M12 3a9 9 0 109 9" />
    </svg>
  );
}
