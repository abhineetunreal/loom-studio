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
  const library = searchParams.get("library");
  const renderType = searchParams.get("renderType");
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "100", 10) || 100, 1), 500);
  const offset = Math.max(parseInt(searchParams.get("offset") ?? "0", 10) || 0, 0);

  const where: Record<string, unknown> = {
    tenantId: tenant.id,
    isActive: true,
  };
  if (library) where.material = library;
  if (renderType === "shader" || renderType === "photo") where.renderType = renderType;

  // Fetch distinct libraries for this tenant (all active yarns, regardless of filters)
  const libraryRows = await db.yarnColor.findMany({
    where: { tenantId: tenant.id, isActive: true },
    select: { material: true },
    distinct: ["material"],
    orderBy: { material: "asc" },
  });
  const libraries = libraryRows
    .map((r) => r.material)
    .filter((m): m is string => m !== null);

  const [yarns, total] = await Promise.all([
    db.yarnColor.findMany({
      where,
      select: {
        code: true,
        name: true,
        hex: true,
        material: true,
        renderType: true,
        swatchImageUrl: true,
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      skip: offset,
      take: limit,
    }),
    db.yarnColor.count({ where }),
  ]);

  const result = yarns.map((y) => ({
    code: y.code,
    name: y.name,
    hex: y.hex,
    library: y.material,
    renderType: y.renderType ?? "shader",
    hasTexture: y.swatchImageUrl !== null,
  }));

  return NextResponse.json(
    {
      tenant: {
        name: tenant.displayName ?? tenant.name,
      },
      libraries,
      yarns: result,
      total,
      limit,
      offset,
    },
    { headers: CORS_HEADERS },
  );
}
