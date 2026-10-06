"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signInWithPasswordAction } from "@/app/actions/auth";

export function PasswordSignInForm() {
  const [state, formAction, pending] = useActionState(
    signInWithPasswordAction,
    null
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      {state?.error && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}
      <input
        type="email"
        name="email"
        required
        placeholder="Email"
        className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-400"
      />
      <input
        type="password"
        name="password"
        required
        placeholder="Password"
        className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-400"
      />
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50 transition-colors"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
      <p className="text-center text-xs text-stone-400 pt-1">
        No account?{" "}
        <Link
          href="/auth/signup"
          className="text-stone-600 underline underline-offset-2 hover:text-stone-900"
        >
          Create one
        </Link>
      </p>
    </form>
  );
}
