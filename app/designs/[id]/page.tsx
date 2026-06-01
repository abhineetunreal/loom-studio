import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import DesignViewer from "@/components/design/DesignViewer";
import type { PaletteEntry, YarnOption } from "@/types";

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
      select: { id: true, code: true, name: true, hex: true, swatchImageUrl: true, material: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
  ]);

  if (!design) notFound();

  // Map DB `material` → `library` for the UI type
  const yarns: YarnOption[] = rawYarns.map(({ material, ...y }) => ({
    ...y,
    library: material,
  }));

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
        design={{
          ...design,
          palette: design.palette as PaletteEntry[],
        }}
        yarns={yarns}
      />
    </div>
  );
}
