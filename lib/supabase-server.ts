// Server-side Supabase client using @supabase/ssr for proper cookie handling.
// Use this for auth in Server Components, Route Handlers, and Server Actions.
// For storage operations, use lib/supabase.ts (createAdminClient / getSupabaseClient).

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createAuthClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll is a no-op in read-only Server Component contexts.
            // Session refreshes in those contexts are handled by proxy.ts.
          }
        },
      },
    }
  );
}
