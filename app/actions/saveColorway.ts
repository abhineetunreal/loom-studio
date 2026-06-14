"use server";

import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase";
import { getCurrentTenant } from "@/lib/tenant";

// ─── Types ────────────────────────────────────────────────────────────────────

// Index-keyed colorway mapping stored in the DB.
// Keys are palette index strings ("0", "1", …).
// Only slots changed from original are included.
export type ColorMappingEntry = {
  yarnId: string;
  yarnCode: string;
  hex: string;        // assigned yarn's hex (for reference; not the palette hex)
  library: string | null;
};

export type SaveColorwayInput = {
  designId: string;
  /** Palette-index-keyed map of yarn assignments */
  colorMapping: Record<string, ColorMappingEntry>;
  /** canvas.toDataURL() PNG — may be null if capture failed */
  snapshotDataUrl: string | null;
};

export type SaveColorwayResult = { ok: true } | { ok: false; error: string };

// ─── Server action ────────────────────────────────────────────────────────────

export async function saveColorwayAction(
  input: SaveColorwayInput
): Promise<SaveColorwayResult> {
  // Auth
  const authUser = await getUser();
  if (!authUser) return { ok: false, error: "Not authenticated" };

  const tenant = await getCurrentTenant();
  if (!tenant) return { ok: false, error: "Tenant not found" };

  const tenantUser = await db.tenantUser.findFirst({
    where: { tenantId: tenant.id, authUserId: authUser.id },
    select: { id: true },
  });
  if (!tenantUser) return { ok: false, error: "User not found" };

  // Upload snapshot (best-effort — don't let a failed upload block the save)
  let snapshotUrl: string | null = null;
  if (input.snapshotDataUrl) {
    try {
      snapshotUrl = await uploadSnapshot(input.designId, input.snapshotDataUrl);
    } catch (err) {
      console.error("Snapshot upload failed (save will continue):", err);
    }
  }

  // Find existing row (first match for this user+design) or create new one
  try {
    const existing = await db.savedColorway.findFirst({
      where: { designId: input.designId, userId: tenantUser.id },
      select: { id: true },
    });
    if (existing) {
      await db.savedColorway.update({
        where: { id: existing.id },
        data: {
          colorMapping: input.colorMapping,
          ...(snapshotUrl !== null ? { snapshotUrl } : {}),
        },
      });
    } else {
      await db.savedColorway.create({
        data: {
          designId: input.designId,
          userId: tenantUser.id,
          tenantId: tenant.id,
          colorMapping: input.colorMapping,
          snapshotUrl,
        },
      });
    }
    return { ok: true };
  } catch (err) {
    console.error("SavedColorway save error:", err);
    return { ok: false, error: "Failed to save colorway" };
  }
}

// ─── Snapshot upload ──────────────────────────────────────────────────────────

const SNAPSHOTS_BUCKET = process.env.SUPABASE_SNAPSHOTS_BUCKET ?? "snapshots";

async function uploadSnapshot(
  designId: string,
  dataUrl: string
): Promise<string> {
  const admin = createAdminClient();
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64, "base64");
  const filename = `${designId}/${Date.now()}.png`;

  const { error } = await admin.storage
    .from(SNAPSHOTS_BUCKET)
    .upload(filename, buffer, { contentType: "image/png", upsert: false });

  if (error) throw new Error(`Snapshot upload failed: ${error.message}`);

  const { data } = admin.storage.from(SNAPSHOTS_BUCKET).getPublicUrl(filename);
  return data.publicUrl;
}
