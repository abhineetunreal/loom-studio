"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { createAdminClient } from "@/lib/supabase";
import { sendColorwayRequestNotification } from "@/lib/email";

const SNAPSHOTS_BUCKET = process.env.SUPABASE_SNAPSHOTS_BUCKET ?? "snapshots";

// ─── Validation schema ────────────────────────────────────────────────────────

const SubmissionSchema = z.object({
  designId: z.string().min(1),
  customerName: z.string().min(1, "Name is required").max(100),
  customerEmail: z.string().email("Please enter a valid email"),
  notes: z.string().max(1000).optional(),
  colorMappings: z
    .array(
      z.object({
        originalHex: z.string().regex(/^#[0-9a-f]{6}$/i),
        percentage: z.number().min(0).max(100),
        yarnId: z.string().min(1),
      })
    )
    .min(1, "Please assign at least one yarn color before submitting"),
  snapshotDataUrl: z.string().startsWith("data:image/"),
});

export type SubmitColorwayInput = z.infer<typeof SubmissionSchema>;
export type SubmitColorwayResult =
  | { ok: true; submissionId: string }
  | { ok: false; error: string };

// ─── Server action ────────────────────────────────────────────────────────────

export async function submitColorway(
  raw: SubmitColorwayInput
): Promise<SubmitColorwayResult> {
  // 1. Validate
  const parsed = SubmissionSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues;
    return { ok: false, error: issues[0]?.message ?? "Invalid input" };
  }
  const { designId, customerName, customerEmail, notes, colorMappings, snapshotDataUrl } =
    parsed.data;

  try {
    // 2. Upload snapshot PNG to Supabase Storage
    const snapshotUrl = await uploadSnapshot(designId, snapshotDataUrl);

    // 3. Write to DB in a transaction
    const submission = await db.$transaction(async (tx) => {
      const sub = await tx.colorwaySubmission.create({
        data: {
          designId,
          customerName,
          customerEmail,
          notes: notes ?? null,
          snapshotUrl,
        },
      });

      await tx.submissionColorMapping.createMany({
        data: colorMappings.map((m) => ({
          submissionId: sub.id,
          originalHex: m.originalHex,
          percentage: m.percentage,
          yarnId: m.yarnId,
        })),
      });

      return sub;
    });

    // 4. Send email notification (best-effort — don't fail the submission on email error)
    try {
      const [design, yarns] = await Promise.all([
        db.design.findUnique({ where: { id: designId }, select: { name: true } }),
        db.yarn.findMany({
          where: { id: { in: colorMappings.map((m) => m.yarnId) } },
          select: { id: true, code: true, name: true, hex: true, swatchImageUrl: true, material: true },
        }),
      ]);

      const yarnById = new Map(
        yarns.map(({ material, ...y }) => [y.id, { ...y, library: material }])
      );

      await sendColorwayRequestNotification({
        customerName,
        customerEmail,
        notes,
        design: { name: design?.name ?? designId },
        mappings: colorMappings.map((m) => ({
          ...m,
          yarn: yarnById.get(m.yarnId)!,
        })),
        snapshotUrl,
      });
    } catch (emailErr) {
      console.error("Failed to send notification email:", emailErr);
    }

    return { ok: true, submissionId: submission.id };
  } catch (err) {
    console.error("submitColorway error:", err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

// ─── Snapshot upload ──────────────────────────────────────────────────────────

async function uploadSnapshot(
  designId: string,
  dataUrl: string
): Promise<string> {
  const admin = createAdminClient();

  // Ensure bucket exists (public so preview URLs work without auth)
  const { data: buckets } = await admin.storage.listBuckets();
  if (!buckets?.some((b) => b.name === SNAPSHOTS_BUCKET)) {
    await admin.storage.createBucket(SNAPSHOTS_BUCKET, { public: true });
  }

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
