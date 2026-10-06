import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";

type Props = { params: Promise<{ sku: string }> };

export default async function CustomizeBySkuPage({ params }: Props) {
  const { sku } = await params;
  const decodedSku = decodeURIComponent(sku);

  const tenant = await getCurrentTenant();

  let design: { id: string } | null = null;

  if (tenant) {
    // externalSku takes priority over name fallback
    design =
      (await db.design.findFirst({
        where: { tenantId: tenant.id, externalSku: decodedSku },
        select: { id: true },
      })) ??
      (await db.design.findFirst({
        where: { tenantId: tenant.id, name: decodedSku },
        select: { id: true },
      }));
  }

  if (design) {
    redirect(`/designs/${design.id}`);
  }

  // Design not found
  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50">
      <div className="text-center max-w-sm px-6">
        <p className="text-2xl font-semibold text-stone-800 mb-2">Design not found</p>
        <p className="text-sm text-stone-500 mb-6">
          No design matching{" "}
          <span className="font-mono bg-stone-100 px-1 rounded">{decodedSku}</span>{" "}
          was found in this catalog.
        </p>
        <a
          href="/"
          className="inline-block px-4 py-2 text-sm font-medium bg-stone-900 text-white rounded-lg hover:bg-stone-700 transition-colors"
        >
          Browse catalog
        </a>
      </div>
    </div>
  );
}
