// proxy.ts — Next.js 16 request proxy (replaces middleware.ts).
//
// 1. Forwards the Host header as x-tenant-host so that server components,
//    route handlers, and server actions can call getCurrentTenant() in
//    lib/tenant.ts without re-extracting the host everywhere.
//
// 2. Refreshes the Supabase session on every request so auth tokens stay valid.

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  // Forward Host as x-tenant-host for getCurrentTenant() (lib/tenant.ts).
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-tenant-host", request.headers.get("host") ?? "");

  // Pass the modified headers to the response so downstream server code sees them.
  const response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Write updated cookies to both the request (so downstream server
          // code sees them) and the response (so the browser stores them).
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getUser() refreshes the session token if needed and is recommended over
  // getSession() in proxy because it re-validates with Supabase Auth server.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    // Skip Next.js internals and static assets
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
