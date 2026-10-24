import "server-only";
import { verificationSettings } from "./settings";

/**
 * EMAIL_SEND_MODE=demo (default): nothing is sent; the caller shows the link to the admin instead.
 * EMAIL_SEND_MODE=live + RESEND_API_KEY (+ EMAIL_FROM): sent through Resend.
 */
export async function sendEmail(msg: { to: string; subject: string; text: string }): Promise<{ mode: "demo" | "live"; sent: boolean }> {
  const { emailMode } = verificationSettings();
  if (emailMode !== "live") return { mode: "demo", sent: false };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM ?? "Creatora <verify@creatora.ai>", to: [msg.to], subject: msg.subject, text: msg.text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error("The email provider rejected the message.");
  return { mode: "live", sent: true };
}

export function invitationEmail(o: { company: string; applicant: string; role: string; link: string; expiresAt: string }) {
  return {
    subject: `Is ${o.applicant} authorized to represent ${o.company} on Creatora?`,
    text: [
      "Someone is trying to represent your company on Creatora.",
      "",
      `Company: ${o.company}`,
      `Applicant: ${o.applicant}`,
      `Role: ${o.role}`,
      "",
      "Is this person authorized to represent your company?",
      `Approve or reject: ${o.link}`,
      "",
      `The link works once and expires on ${new Date(o.expiresAt).toUTCString()}. If you don't recognise this request, choose Reject.`,
    ].join("\n"),
  };
}
