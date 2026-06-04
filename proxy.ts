// proxy.ts — Next.js 16 request proxy (replaces middleware.ts).
// Refreshes the Supabase session on every request so tokens stay valid.

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  // Start with a pass-through response, but forward the incoming headers so
  // Server Components can read them.
  const response = NextResponse.next({ request });

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
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
