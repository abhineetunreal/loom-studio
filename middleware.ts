// Multi-tenant middleware.
//
// Runs on every non-static request. Reads the Host header and forwards it as
// x-tenant-host so that server components and API routes can call
// getCurrentTenant() (lib/tenant.ts) to resolve the correct tenant without
// repeating the host-extraction logic everywhere.
//
// The actual DB lookup + caching lives in lib/tenant.ts (Node.js runtime)
// since Prisma cannot run in the Edge runtime that middleware uses.

import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-tenant-host", host);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    /*
     * Run on all paths EXCEPT:
     *   - _next/static  (built assets)
     *   - _next/image   (image optimizer)
     *   - favicon.ico
     *   - common static extensions
     */
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
