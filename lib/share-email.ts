// Email notifications for share link approvals.
// Server-side only — called from API routes.

import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = "Loom Studio <noreply@loomstudio.com>";

type ApprovalParams = {
  clientName: string;
  clientEmail: string;
  designName: string;
  tenantName: string;
  thumbnailUrl: string | null;
  shareUrl: string;
  createdBy: string;
  tenantAdminEmail: string;
};

export async function sendShareApprovalNotification(
  params: ApprovalParams
): Promise<void> {
  const {
    clientName,
    clientEmail,
    designName,
    tenantName,
    thumbnailUrl,
    shareUrl,
    createdBy,
    tenantAdminEmail,
  } = params;

  // Email 1 — to the client
  const clientText = [
    `Hi ${clientName},`,
    ``,
    `Your colorway for "${designName}" has been approved.`,
    ``,
    thumbnailUrl ? `Preview: ${thumbnailUrl}` : null,
    `View your design: ${shareUrl}`,
    ``,
    `Thank you for choosing ${tenantName}.`,
  ]
    .filter((l) => l !== null)
    .join("\n");

  await resend.emails.send({
    from: FROM,
    to: clientEmail,
    subject: `Your colorway for ${designName} has been approved`,
    text: clientText,
  });

  // Email 2 — to the link creator
  const adminText = [
    `Client approved a colorway.`,
    ``,
    `Client: ${clientName} <${clientEmail}>`,
    `Design: ${designName}`,
    ``,
    thumbnailUrl ? `Preview: ${thumbnailUrl}` : null,
    `Share link: ${shareUrl}`,
  ]
    .filter((l) => l !== null)
    .join("\n");

  await resend.emails.send({
    from: FROM,
    to: createdBy,
    subject: `Client approved: ${clientName} — ${designName}`,
    text: adminText,
  });

  // Email 3 — to tenant admin (only if different from creator)
  if (
    tenantAdminEmail &&
    tenantAdminEmail.toLowerCase() !== createdBy.toLowerCase()
  ) {
    await resend.emails.send({
      from: FROM,
      to: tenantAdminEmail,
      subject: `Client approved: ${clientName} — ${designName}`,
      text: adminText,
    });
  }
}
