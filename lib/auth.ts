// Auth utilities — server-only. Import from Server Components, Route Handlers,
// and Server Actions. Never import from Client Components.

import type { Session, User } from "@supabase/supabase-js";
import { createAuthClient } from "./supabase-server";

/**
 * Returns the current Supabase session, or null if unauthenticated.
 */
export async function getSession(): Promise<Session | null> {
  const supabase = await createAuthClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session;
}

/**
 * Returns the current authenticated user, or null.
 */
export async function getUser(): Promise<User | null> {
  const supabase = await createAuthClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
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
 * Signs in with email + password.
 * Returns null on success, or an error message string on failure.
 */
export async function signInWithPassword(
  email: string,
  password: string
): Promise<string | null> {
  const supabase = await createAuthClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return error.message;
  return null;
}

/**
 * Creates a new Supabase Auth account with email + password.
 * Returns null on success, or an error message string on failure.
 * Caller is responsible for creating the TenantUser record.
 */
export async function signUpWithPassword(
  email: string,
  password: string,
  fullName: string
): Promise<{ userId: string | null; error: string | null }> {
  const supabase = await createAuthClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });
  if (error) return { userId: null, error: error.message };
  return { userId: data.user?.id ?? null, error: null };
}

/**
 * Updates the authenticated user's password.
 * Returns null on success, or an error message string on failure.
 */
export async function updatePassword(
  newPassword: string
): Promise<string | null> {
  const supabase = await createAuthClient();
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return error.message;
  return null;
}

/**
 * Signs the current user out and clears the session cookie.
 */
export async function signOut(): Promise<void> {
  const supabase = await createAuthClient();
  await supabase.auth.signOut();
}
