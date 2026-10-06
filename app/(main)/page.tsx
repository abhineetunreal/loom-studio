// Catalog home — shown in the center when no design is selected.
// The design browser is in the left panel (populated by layout.tsx).
export default function CatalogPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[60vh] text-center px-6">
      <div className="max-w-xs">
        <div className="w-14 h-14 rounded-2xl bg-stone-100 flex items-center justify-center mx-auto mb-5">
          <RugIcon />
        </div>
        <h1 className="text-xl font-semibold mb-2">Welcome to Loom Studio</h1>
        <p className="text-sm text-stone-500 leading-relaxed">
          Select a design from the panel on the left to start customizing the
          colorway with your preferred yarns.
        </p>
      </div>
    </div>
  );
}

function RugIcon() {
  return (
    <svg
      className="w-7 h-7 text-stone-400"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <rect x="3" y="3" width="18" height="18" rx="2" strokeLinecap="round" strokeLinejoin="round" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 9h18M3 15h18M9 3v18M15 3v18" />
    </svg>
  );
}
