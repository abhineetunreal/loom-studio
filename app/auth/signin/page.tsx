import { redirect } from "next/navigation";
import { getGoogleSignInUrl, signInWithMagicLink } from "@/lib/auth";
import { MagicLinkForm } from "./MagicLinkForm";

// ─── Server actions ───────────────────────────────────────────────────────────

async function googleSignIn() {
  "use server";
  const url = await getGoogleSignInUrl();
  redirect(url);
}

async function magicLinkAction(
  _prev: { sent: boolean; error?: string } | null,
  formData: FormData
): Promise<{ sent: boolean; error?: string }> {
  "use server";
  const email = formData.get("email");
  if (typeof email !== "string" || !email.includes("@")) {
    return { sent: false, error: "Enter a valid email address." };
  }
  try {
    await signInWithMagicLink(email.trim());
    return { sent: true };
  } catch (err) {
    return {
      sent: false,
      error: err instanceof Error ? err.message : "Something went wrong.",
    };
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
      <div className="w-full max-w-sm">
        {/* Logo / wordmark */}
        <div className="mb-8 text-center">
          <span className="text-2xl">🧵</span>
          <h1 className="mt-2 text-xl font-semibold text-stone-900">
            Loom Studio
          </h1>
          <p className="mt-1 text-sm text-stone-500">
            Sign in to access the full design catalog
          </p>
        </div>

        <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
          {/* Google */}
          <form action={googleSignIn}>
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-3 rounded-md border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-700 hover:bg-stone-50 transition-colors"
            >
              <GoogleIcon />
              Continue with Google
            </button>
          </form>

          {/* Divider */}
          <div className="my-5 flex items-center gap-3">
            <hr className="flex-1 border-stone-200" />
            <span className="text-xs text-stone-400">or</span>
            <hr className="flex-1 border-stone-200" />
          </div>

          {/* Magic link */}
          <MagicLinkForm action={magicLinkAction} />
        </div>

        <p className="mt-6 text-center text-xs text-stone-400">
          No account needed for demo access.{" "}
          <a href="/" className="underline underline-offset-2 hover:text-stone-600">
            Browse demos →
          </a>
        </p>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}
