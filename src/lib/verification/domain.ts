import { FREE_MAIL_DOMAINS } from "@/config/verification";

const registrable = (host: string) => host.toLowerCase().replace(/^www\./, "");
/** Deterministic, not AI: does the applicant's email domain belong to the website's domain? */
export function domainCheck(website: string, email: string) {
  const site = registrable(new URL(website).hostname);
  const mail = registrable(email.split("@")[1] ?? "");
  const free = (FREE_MAIL_DOMAINS as readonly string[]).includes(mail);
  return { website_domain: site, email_domain: mail, free_mail: free, domain_match: !free && (mail === site || mail.endsWith(`.${site}`) || site.endsWith(`.${mail}`)) };
}
