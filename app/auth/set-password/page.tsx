import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { SetPasswordForm } from "./SetPasswordForm";

export default async function SetPasswordPage() {
  const user = await getUser();
  if (!user) redirect("/auth/signin");

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="text-2xl">🧵</span>
          <h1 className="mt-2 text-xl font-semibold text-stone-900">
            Set password
          </h1>
          <p className="mt-1 text-sm text-stone-500">
            Add a password to your account so you can sign in with email.
          </p>
        </div>

        <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
          <SetPasswordForm />
        </div>
      </div>
    </div>
  );
}
