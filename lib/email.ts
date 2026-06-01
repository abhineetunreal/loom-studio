// Email notifications via Resend.
// Only called from server actions / API routes — never imported in browser code.

import { Resend } from "resend";
import type { DesignDetail, SubmissionColorMappingInput, YarnOption } from "@/types";

const resend = new Resend(process.env.RESEND_API_KEY);

type NotifyParams = {
  customerName: string;
  customerEmail: string;
  notes?: string;
  design: Pick<DesignDetail, "name">;
  mappings: Array<SubmissionColorMappingInput & { yarn: YarnOption }>;
  snapshotUrl?: string;
};

export async function sendColorwayRequestNotification(
  params: NotifyParams
): Promise<void> {
  const { customerName, customerEmail, notes, design, mappings, snapshotUrl } =
    params;

  const to = process.env.NOTIFICATION_EMAIL;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  if (!to) throw new Error("NOTIFICATION_EMAIL is not set");

  const mappingLines = mappings
    .map(
      (m) =>
        `  ${m.originalHex}  →  ${m.yarn.code} ${m.yarn.name}  (${m.percentage.toFixed(1)}%)`
    )
    .join("\n");

  const text = [
    `New colorway request for "${design.name}"`,
    ``,
    `Customer: ${customerName} <${customerEmail}>`,
    notes ? `Notes: ${notes}` : null,
    ``,
    `Color mapping:`,
    mappingLines,
    ``,
    snapshotUrl ? `Preview: ${snapshotUrl}` : null,
    appUrl ? `App: ${appUrl}` : null,
  ]
    .filter((line) => line !== null)
    .join("\n");

  await resend.emails.send({
    from: "Loom Studio <noreply@loomstudio.com>", // update to your verified domain
    to,
    subject: `Colorway request — ${design.name} from ${customerName}`,
    text,
  });
}
