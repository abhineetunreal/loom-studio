"use client";

import { useActionState } from "react";

type State = { sent: boolean; error?: string } | null;

export function MagicLinkForm({
  action,
}: {
  action: (prev: State, formData: FormData) => Promise<State>;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  if (state?.sent) {
    return (
      <p className="text-center text-sm text-stone-600">
        Check your inbox — we sent a sign-in link to your email.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      {state?.error && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}
      <input
        type="email"
        name="email"
        required
        placeholder="you@example.com"
        className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-400"
      />
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-stone-800 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50 transition-colors"
      >
        {pending ? "Sending…" : "Send magic link"}
      </button>
    </form>
  );
}
