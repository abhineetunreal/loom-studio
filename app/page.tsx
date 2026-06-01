// Catalog page — server component. Fetches all active designs and renders a grid.
import { db } from "@/lib/db";
import DesignGrid from "@/components/catalog/DesignGrid";
import type { DesignSummary } from "@/types";

export default async function CatalogPage() {
  const designs = await db.design.findMany({
    where: { isActive: true },
    select: { id: true, name: true, slug: true, imageUrl: true, width: true, height: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="px-6 py-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold mb-2">Rug Designs</h1>
      <p className="text-stone-500 mb-8 text-sm">
        Choose a design to customize the colorway with your preferred yarns.
      </p>
      <DesignGrid designs={designs as DesignSummary[]} />
    </div>
  );
}
