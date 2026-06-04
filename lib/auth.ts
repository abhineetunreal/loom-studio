// Auth utilities — server-only. Import from Server Components, Route Handlers,
// and Server Actions. Never import from Client Components.

import type { Session } from "@supabase/supabase-js";
import { createAuthClient } from "./supabase-server";

/**
 * Returns the current Supabase session, or null if unauthenticated.
 * Safe to call from any server context (component, action, route handler).
 */
export async function getSession(): Promise<Session | null> {
  const supabase = await createAuthClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session;
}

/**
 * Initiates Google OAuth sign-in.
 * Returns the redirect URL — call redirect(url) in the invoking server action.
 */
export async function getGoogleSignInUrl(): Promise<string> {
  const supabase = await createAuthClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
    },
  });
  if (error || !data.url) throw new Error(error?.message ?? "OAuth error");
  return data.url;
}

/**
 * Sends a magic link (OTP email) to the given address.
 * Throws on error.
 */
export async function signInWithMagicLink(email: string): Promise<void> {
  const supabase = await createAuthClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
    },
  });
  if (error) throw new Error(error.message);
}

/**
 * Signs the current user out and clears the session cookie.
 */
export async function signOut(): Promise<void> {
  const supabase = await createAuthClient();
  await supabase.auth.signOut();
}
