import { SignUpForm } from "./SignUpForm";

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="text-2xl">🧵</span>
          <h1 className="mt-2 text-xl font-semibold text-stone-900">
            Create account
          </h1>
          <p className="mt-1 text-sm text-stone-500">
            Request access to the full Loom Studio catalog
          </p>
        </div>

        <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
          <SignUpForm />
        </div>
      </div>
    </div>
  );
}
