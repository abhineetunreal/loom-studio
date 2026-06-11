// Supabase client — two flavors:
//   supabase (anon key)         → safe to use in browser / server components for reads
//   createAdminClient()         → server-only; has full storage access for uploads

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const DESIGNS_BUCKET = process.env.SUPABASE_DESIGNS_BUCKET ?? "designs";
export const SNAPSHOTS_BUCKET =
  process.env.SUPABASE_SNAPSHOTS_BUCKET ?? "snapshots";
export const USER_DESIGNS_BUCKET =
  process.env.SUPABASE_USER_DESIGNS_BUCKET ?? "user-designs";

// Lazy singleton — avoids crashing at import time when env vars aren't loaded yet
let _supabase: SupabaseClient | null = null;
export function getSupabaseClient(): SupabaseClient {
  if (!_supabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set");
    _supabase = createClient(url, key);
  }
  return _supabase;
}

// Convenience re-export for server components that use it directly
export const supabase = { get storage() { return getSupabaseClient().storage; } };

// Admin client — only call from server-side code (never in the browser)
export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  return createClient(url, serviceKey);
}

export function getPublicUrl(bucket: string, path: string): string {
  const { data } = getSupabaseClient().storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Generate a signed URL for a private bucket object.
 * Uses the service-role admin client so it works regardless of RLS.
 * Server-side only — never call from the browser.
 *
 * @param bucket  Bucket name (e.g. USER_DESIGNS_BUCKET)
 * @param path    Object path within the bucket
 * @param expiresIn  Validity in seconds (default 3600 = 1 hour)
 */
export async function getSignedUrl(
  bucket: string,
  path: string,
  expiresIn = 3600
): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) {
    throw new Error(`Failed to create signed URL for ${bucket}/${path}: ${error?.message}`);
  }
  return data.signedUrl;
}
