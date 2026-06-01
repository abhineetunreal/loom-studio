import fs from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import DesignViewer from "@/components/design/DesignViewer";
import type { PaletteEntry, YarnOption } from "@/types";

// ─── Rendered-color lookup ────────────────────────────────────────────────────
// Reads data/oneloom-rendered-lookup.json at request time (server component).
// Keys not starting with "#" are metadata and are ignored.

const LOOKUP_PATH = path.join(process.cwd(), "data", "oneloom-rendered-lookup.json");

function loadRenderedLookup(): Map<string, string> {
  try {
    const raw = JSON.parse(fs.readFileSync(LOOKUP_PATH, "utf-8")) as Record<string, string>;
    return new Map(
      Object.entries(raw)
        .filter(([k]) => /^#[0-9a-f]{6}$/i.test(k))
        .map(([k, v]): [string, string] => [k.toLowerCase(), v])
    );
  } catch {
    return new Map();
  }
}

type Props = { params: Promise<{ id: string }> };

export default async function DesignPage({ params }: Props) {
  const { id } = await params;

  const [design, rawYarns] = await Promise.all([
    db.design.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        slug: true,
        imageUrl: true,
        sourceBmpUrl: true,
        width: true,
        height: true,
        palette: true,
      },
    }),
    db.yarn.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true, hex: true, swatchImageUrl: true, material: true, pileType: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
  ]);

  if (!design) notFound();

  // Map DB `material` → `library` for the UI type
  const yarns: YarnOption[] = rawYarns.map(({ material, ...y }) => ({
    ...y,
    library: material,
  }));

  // ── Build initial color map from the rendered-color lookup ─────────────────
  // Check the lookup file first, then fall back to matchedYarnCode baked into
  // the palette at process-designs time (handles both fresh and pre-seeded designs).
  const renderedLookup = loadRenderedLookup();
  // Index OneLoom yarns by their name for O(1) resolution
  const oneloomByName = new Map<string, YarnOption>(
    yarns.filter((y) => y.library === "OneLoom").map((y) => [y.name, y])
  );

  const palette = design.palette as PaletteEntry[];
  const initialColorMap: Record<string, YarnOption> = {};
  for (const entry of palette) {
    const code = renderedLookup.get(entry.hex) ?? entry.matchedYarnCode;
    if (!code) continue;
    const yarn = oneloomByName.get(code);
    if (yarn) initialColorMap[entry.hex] = yarn;
  }

  return (
    <div className="px-6 py-6 max-w-6xl mx-auto">
      {/* Breadcrumb */}
      <nav className="text-sm text-stone-400 mb-6">
        <Link href="/" className="hover:text-stone-700 transition-colors">
          Designs
        </Link>
        <span className="mx-2">/</span>
        <span className="text-stone-700">{design.name}</span>
      </nav>

      <DesignViewer
        design={{ ...design, palette }}
        yarns={yarns}
        initialColorMap={initialColorMap}
      />
    </div>
  );
}
