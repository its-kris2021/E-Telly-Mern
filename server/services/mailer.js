import nodemailer from "nodemailer";

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST) return null;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return transporter;
}

// Best-effort notification — callers must not let a failed/unconfigured send
// block the invite-creation request. Acceptance happens in-app (the invitee
// must be authenticated and their account email must match the invite), so
// this email is a nudge, not a security-relevant clickable link.
export async function sendFamilyInviteEmail({ to, inviterName, relationship }) {
  const t = getTransporter();
  if (!t) {
    console.warn("[Mailer] SMTP not configured — skipping invite email to", to);
    return;
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  await t.sendMail({
    from,
    to,
    subject: `${inviterName} invited you to join their family on E-Telly`,
    text:
      `${inviterName} invited you to join their family on E-Telly as their ${relationship}.\n\n` +
      `Open the E-Telly app, sign in with this email address (${to}) — or register and verify ` +
      `your email if you're new — then check "Pending Invites" on your Profile to accept or decline.\n\n` +
      `This invite expires in 7 days.`,
    html:
      `<p><strong>${inviterName}</strong> invited you to join their family on E-Telly as their <strong>${relationship}</strong>.</p>` +
      `<p>Open the E-Telly app, sign in with this email address (${to}) — or register and verify ` +
      `your email if you're new — then check <strong>Pending Invites</strong> on your Profile to accept or decline.</p>` +
      `<p>This invite expires in 7 days.</p>`,
  });
}
