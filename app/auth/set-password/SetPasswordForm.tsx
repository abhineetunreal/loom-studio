"use client";

import { useActionState } from "react";
import { setPasswordAction } from "@/app/actions/auth";

export function SetPasswordForm() {
  const [state, formAction, pending] = useActionState(setPasswordAction, null);

  if (state?.success) {
    return (
      <div className="rounded-lg bg-stone-50 border border-stone-200 px-4 py-5 text-center">
        <p className="text-sm font-medium text-stone-800">Password set.</p>
        <p className="mt-1 text-sm text-stone-500">
          You can now sign in with your email and password.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      {state?.error && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}
      <input
        type="password"
        name="password"
        required
        minLength={8}
        placeholder="New password (min. 8 characters)"
        className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-400"
      />
      <input
        type="password"
        name="confirm"
        required
        placeholder="Confirm new password"
        className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-400"
      />
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50 transition-colors"
      >
        {pending ? "Saving…" : "Set password"}
      </button>
    </form>
  );
}
