"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

export default function SSOCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const tokenHash = searchParams.get("token_hash");
    const type = searchParams.get("type");
    const rawNext = searchParams.get("next");

    // Only allow relative URLs for `next` to prevent open redirect attacks
    const next = rawNext && rawNext.startsWith("/") ? rawNext : "/";

    if (!tokenHash || type !== "email") {
      setError("Invalid sign-in link.");
      return;
    }

    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    supabase.auth
      .verifyOtp({ token_hash: tokenHash, type: "email" })
      .then(({ error }) => {
        if (error) {
          setError("Sign-in failed. Please try again.");
        } else {
          router.replace(next);
        }
      });
  }, [router, searchParams]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-red-600 mb-4">{error}</p>
          <a href="/" className="text-sm text-stone-600 underline">
            Back to home
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-stone-500">Signing you in…</p>
    </div>
  );
}
