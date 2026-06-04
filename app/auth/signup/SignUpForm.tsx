"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signUpAction } from "@/app/actions/auth";

export function SignUpForm() {
  const [state, formAction, pending] = useActionState(signUpAction, null);

  if (state?.success) {
    return (
      <div className="rounded-lg bg-stone-50 border border-stone-200 px-4 py-5 text-center">
        <p className="text-sm font-medium text-stone-800">Account created.</p>
        <p className="mt-1 text-sm text-stone-500">
          Your access is pending admin approval. You&apos;ll be notified when
          your account is approved.
        </p>
        <Link
          href="/auth/signin"
          className="mt-4 inline-block text-sm text-stone-600 underline underline-offset-2 hover:text-stone-900"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      {state?.error && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}
      <input
        type="text"
        name="name"
        required
        placeholder="Full name"
        className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-400"
      />
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
        minLength={8}
        placeholder="Password (min. 8 characters)"
        className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-400"
      />
      <input
        type="password"
        name="confirm"
        required
        placeholder="Confirm password"
        className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-400"
      />
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50 transition-colors"
      >
        {pending ? "Creating account…" : "Create account"}
      </button>
      <p className="text-center text-xs text-stone-400 pt-1">
        Already have an account?{" "}
        <Link
          href="/auth/signin"
          className="text-stone-600 underline underline-offset-2 hover:text-stone-900"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
