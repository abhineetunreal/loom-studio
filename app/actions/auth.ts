"use server";

import { redirect } from "next/navigation";
import {
  signOut,
  signInWithPassword,
  signUpWithPassword,
  updatePassword,
  getUser,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";

// ─── Sign out ─────────────────────────────────────────────────────────────────

export async function signOutAction(): Promise<void> {
  await signOut();
  redirect("/");
}

// ─── Password sign-in ─────────────────────────────────────────────────────────

type SignInState = { error: string } | null;

export async function signInWithPasswordAction(
  _prev: SignInState,
  formData: FormData
): Promise<SignInState> {
  const email = formData.get("email");
  const password = formData.get("password");

  if (typeof email !== "string" || typeof password !== "string") {
    return { error: "Invalid form data." };
  }

  const error = await signInWithPassword(email.trim(), password);
  if (error) return { error: "Invalid email or password." };

  redirect("/");
}

// ─── Sign up ──────────────────────────────────────────────────────────────────

type SignUpState = { success?: true; error?: string } | null;

export async function signUpAction(
  _prev: SignUpState,
  formData: FormData
): Promise<SignUpState> {
  const name = formData.get("name");
  const email = formData.get("email");
  const password = formData.get("password");
  const confirm = formData.get("confirm");

  if (
    typeof name !== "string" ||
    typeof email !== "string" ||
    typeof password !== "string" ||
    typeof confirm !== "string"
  ) {
    return { error: "Invalid form data." };
  }

  if (!name.trim()) return { error: "Name is required." };
  if (!email.includes("@")) return { error: "Enter a valid email address." };
  if (password.length < 8)
    return { error: "Password must be at least 8 characters." };
  if (password !== confirm) return { error: "Passwords do not match." };

  const { userId, error } = await signUpWithPassword(
    email.trim(),
    password,
    name.trim()
  );

  if (error) return { error };

  // Provision TenantUser for the default tenant
  if (userId) {
    await provisionTenantUser(email.trim(), userId, name.trim(), "password");
  }

  return { success: true };
}

// ─── Set / update password ────────────────────────────────────────────────────

type SetPasswordState = { success?: true; error?: string } | null;

export async function setPasswordAction(
  _prev: SetPasswordState,
  formData: FormData
): Promise<SetPasswordState> {
  const user = await getUser();
  if (!user) return { error: "You must be signed in to set a password." };

  const password = formData.get("password");
  const confirm = formData.get("confirm");

  if (typeof password !== "string" || typeof confirm !== "string") {
    return { error: "Invalid form data." };
  }

  if (password.length < 8)
    return { error: "Password must be at least 8 characters." };
  if (password !== confirm) return { error: "Passwords do not match." };

  const error = await updatePassword(password);
  if (error) return { error };

  return { success: true };
}

// ─── Shared: provision TenantUser ─────────────────────────────────────────────

async function provisionTenantUser(
  email: string,
  authUserId: string,
  name?: string,
  provider?: string
): Promise<void> {
  try {
    // Find all tenants where this email is the admin
    const ownerTenants = await db.tenant.findMany({
      where: { adminEmail: { equals: email, mode: "insensitive" } },
      select: { id: true },
    });
    const ownerTenantIds = new Set(ownerTenants.map((t) => t.id));

    // Upsert OWNER for each matching tenant
    for (const { id: tenantId } of ownerTenants) {
      await db.tenantUser.upsert({
        where: { tenantId_email: { tenantId, email } },
        update: {
          authUserId,
          name: name ?? undefined,
          provider: provider ?? undefined,
          role: "OWNER" as const,
        },
        create: {
          tenantId,
          email,
          name: name ?? null,
          authUserId,
          provider: provider ?? null,
          role: "OWNER",
        },
      });
    }

    // Upsert current-domain tenant as PENDING (only on create, don't demote existing)
    const currentTenant = await getCurrentTenant();
    if (currentTenant && !ownerTenantIds.has(currentTenant.id)) {
      await db.tenantUser.upsert({
        where: { tenantId_email: { tenantId: currentTenant.id, email } },
        update: {
          authUserId,
          name: name ?? undefined,
          provider: provider ?? undefined,
        },
        create: {
          tenantId: currentTenant.id,
          email,
          name: name ?? null,
          authUserId,
          provider: provider ?? null,
          role: "PENDING",
        },
      });
    }
  } catch (err) {
    console.error("Failed to provision TenantUser:", err);
  }
}
