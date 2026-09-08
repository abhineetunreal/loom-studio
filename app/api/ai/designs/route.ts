import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validateApiKey } from "@/lib/ai-api-auth";
import { checkRateLimit } from "@/lib/ai-api-rate-limit";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS });
}

type PaletteEntry = {
  index: number;
  hex: string;
  pixelCount: number;
  percentage: number;
  matchedYarnCode?: string;
};

export async function GET(request: NextRequest) {
  const tenant = await validateApiKey(request);
  if (!tenant) {
    return NextResponse.json(
      { error: "Invalid or missing API key" },
      { status: 401, headers: CORS_HEADERS },
    );
  }

  if (!checkRateLimit(tenant.id)) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again in 60 seconds." },
      { status: 429, headers: CORS_HEADERS },
    );
  }

  const { searchParams } = new URL(request.url);
  const collection = searchParams.get("collection");
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 1), 200);
  const offset = Math.max(parseInt(searchParams.get("offset") ?? "0", 10) || 0, 0);

  const where: Record<string, unknown> = {
    tenantId: tenant.id,
    isActive: true,
    isHidden: false,
  };
  if (collection) {
    where.collection = { name: collection };
  }

  const [designs, total] = await Promise.all([
    db.design.findMany({
      where,
      select: {
        id: true,
        name: true,
        imageUrl: true,
        width: true,
        height: true,
        palette: true,
        collection: { select: { name: true } },
      },
      orderBy: { name: "asc" },
      skip: offset,
      take: limit,
    }),
    db.design.count({ where }),
  ]);

  const baseUrl = tenant.domain ? `https://${tenant.domain}` : null;

  const result = designs.map((d) => {
    const palette = (d.palette as PaletteEntry[]) ?? [];
    const colors = palette
      .filter((c) => c.matchedYarnCode)
      .sort((a, b) => b.percentage - a.percentage)
      .map((c) => ({
        yarnCode: c.matchedYarnCode!,
        hex: c.hex,
        percentage: Math.round(c.percentage * 10) / 10,
        index: c.index,
      }));

    const entry: Record<string, unknown> = {
      id: d.id,
      name: d.name,
      collection: d.collection?.name ?? null,
      colorCount: palette.length,
      colors,
      thumbnailUrl: d.imageUrl,
    };

    if (d.width && d.height) {
      // Convert pixels to a rough feet dimension at ~120 px/ft for display
      const wFt = (d.width / 120).toFixed(1);
      const hFt = (d.height / 120).toFixed(1);
      entry.dimensions = `${wFt} x ${hFt}`;
    }

    if (baseUrl) {
      entry.liveUrl = `${baseUrl}/designs/${d.id}`;
    }

    return entry;
  });

  return NextResponse.json(
    {
      tenant: {
        name: tenant.displayName ?? tenant.name,
        domain: tenant.domain,
      },
      designs: result,
      total,
      limit,
      offset,
    },
    { headers: CORS_HEADERS },
  );
}
