import Link from "next/link";
import Image from "next/image";
import type { DesignSummary } from "@/types";

type Props = { designs: DesignSummary[] };

export default function DesignGrid({ designs }: Props) {
  if (designs.length === 0) {
    return (
      <p className="text-stone-400 text-sm">
        No designs available yet. Check back soon.
      </p>
    );
  }

  return (
    <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
      {designs.map((design) => (
        <li key={design.id}>
          <DesignCard design={design} />
        </li>
      ))}
    </ul>
  );
}

function DesignCard({ design }: { design: DesignSummary }) {
  // Convert pixel dimensions to a human-readable rug size hint.
  // Not a real physical size — just the aspect ratio at a glance.
  const aspectLabel = formatAspect(design.width, design.height);

  return (
    <Link
      href={`/designs/${design.id}`}
      className="group block rounded-xl overflow-hidden border border-stone-200 hover:border-stone-400 hover:shadow-md transition-all duration-150"
    >
      {/* Thumbnail — letterboxed to square so the grid stays uniform */}
      <div className="aspect-square relative bg-stone-100">
        <Image
          src={design.imageUrl}
          alt={design.name}
          fill
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
          className="object-contain p-2"
        />
      </div>

      {/* Card footer */}
      <div className="px-3 py-2.5 border-t border-stone-100">
        <p className="text-sm font-medium truncate leading-snug">
          {design.name}
        </p>
        <p className="text-xs text-stone-400 mt-0.5">
          {design.width} × {design.height} px &middot; {aspectLabel}
        </p>
      </div>
    </Link>
  );
}

/** Returns a simplified aspect ratio string, e.g. "3:4" or "1:1" */
function formatAspect(w: number, h: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const d = gcd(w, h);
  return `${w / d}:${h / d}`;
}
