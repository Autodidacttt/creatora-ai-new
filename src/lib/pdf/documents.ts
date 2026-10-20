// Server-side PDFs: the commercial IP licence record and the creator's earnings receipt.
// Standard Helvetica (no font files needed); text is sanitised to the WinAnsi character set it supports.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

const INK = rgb(0.16, 0.13, 0.09);
const MUTED = rgb(0.45, 0.42, 0.37);
const AMBER = rgb(0.96, 0.66, 0);
const LINE = rgb(0.88, 0.86, 0.82);

/** Keeps characters Helvetica/WinAnsi can draw; replaces the rest. */
export function pdfSafe(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...")
    .replace(/[→]/g, "->").replace(/·/g, "-")
    .normalize("NFC")
    .replace(/[^\x20-\x7E -ÿ]/g, "?");
}

class Writer {
  y: number;
  constructor(readonly doc: PDFDocument, public page: PDFPage, readonly font: PDFFont, readonly bold: PDFFont, readonly mono: PDFFont) {
    this.y = page.getHeight() - 56;
  }
  get width() { return this.page.getWidth(); }
  ensure(h: number) {
    if (this.y - h < 56) {
      this.page = this.doc.addPage([595.28, 841.89]);
      this.y = this.page.getHeight() - 56;
    }
  }
  wrap(text: string, size: number, font: PDFFont, maxWidth: number): string[] {
    const words = pdfSafe(text).split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > maxWidth && line) {
        lines.push(line);
        line = w;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  }
  text(text: string, opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; x?: number; maxWidth?: number; gap?: number } = {}) {
    const size = opts.size ?? 10;
    const font = opts.font ?? this.font;
    const x = opts.x ?? 56;
    const lines = this.wrap(text, size, font, opts.maxWidth ?? this.width - x - 56);
    for (const l of lines) {
      this.ensure(size + 4);
      this.page.drawText(l, { x, y: this.y, size, font, color: opts.color ?? INK });
      this.y -= size + 4;
    }
    this.y -= opts.gap ?? 4;
  }
  row(label: string, value: string) {
    const size = 10;
    const lines = this.wrap(value || "-", size, this.font, this.width - 220);
    this.ensure(lines.length * 14 + 6);
    this.page.drawText(pdfSafe(label), { x: 56, y: this.y, size: 9, font: this.bold, color: MUTED });
    lines.forEach((l, i) => this.page.drawText(l, { x: 200, y: this.y - i * 14, size, font: this.font, color: INK }));
    this.y -= lines.length * 14 + 6;
  }
  rule(gap = 10) {
    this.ensure(gap * 2);
    this.page.drawLine({ start: { x: 56, y: this.y }, end: { x: this.width - 56, y: this.y }, thickness: 0.6, color: LINE });
    this.y -= gap;
  }
  heading(text: string) {
    this.y -= 6;
    this.text(text.toUpperCase(), { size: 9, font: this.bold, color: MUTED, gap: 6 });
  }
}

async function start(title: string) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setProducer("Creatora AI");
  doc.setCreator("Creatora AI");
  const page = doc.addPage([595.28, 841.89]);
  const w = new Writer(doc, page, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold), await doc.embedFont(StandardFonts.Courier));
  page.drawRectangle({ x: 0, y: page.getHeight() - 8, width: page.getWidth(), height: 8, color: AMBER });
  w.text("CREATORA AI", { size: 9, font: w.bold, color: MUTED, gap: 2 });
  return { doc, w };
}

const DURATIONS: Record<string, string> = { "3_months": "3 months", "6_months": "6 months", "12_months": "12 months", "24_months": "24 months", perpetual: "Perpetual" };
const LICENCES: Record<string, string> = { non_exclusive: "Non-exclusive licence", exclusive: "Exclusive licence", buyout: "Full buyout", limited: "Limited licence" };
const EXCLUSIVITY: Record<string, string> = { none: "None", category: "Category exclusivity", full: "Full exclusivity" };
const RIGHTS: Record<string, string> = { organic_social: "Organic social", paid_social: "Paid social", broadcast: "Broadcast / TV", ooh: "Out-of-home", web: "Web & digital", internal: "Internal use" };

export interface CertificateData {
  certificate_id: string;
  generated_at: string;
  terms: Record<string, unknown>;
  tools_declared: string[];
  asset_hashes: { name: string | null; media_type: string; sha256: string | null; bytes: number | null; link: string | null }[];
  verify_url: string;
}

export async function certificatePdf(d: CertificateData): Promise<Uint8Array> {
  const t = d.terms as Record<string, string | number | boolean | string[] | Record<string, unknown> | null>;
  const { doc, w } = await start(`Licence record ${d.certificate_id}`);
  w.text("Commercial Licence Record", { size: 22, font: w.bold, gap: 2 });
  w.text("Platform-generated licence record, not legal advice.", { size: 10, color: MUTED, gap: 14 });
  w.text(d.certificate_id, { size: 16, font: w.mono, gap: 2 });
  w.text(`Issued ${new Date(d.generated_at).toUTCString()}  -  Verify at ${d.verify_url}`, { size: 9, color: MUTED, gap: 10 });
  w.rule();

  w.heading("Parties & project");
  w.row("Licensee (brand)", String(t.brand ?? ""));
  w.row("Licensor (creator)", `${t.creator ?? ""}${t.creator_username ? ` (@${t.creator_username})` : ""}`);
  w.row("Campaign", String(t.campaign_title ?? ""));
  w.row("Approved version", `v${t.submission_version ?? "?"}${t.approved_at ? `, approved ${new Date(String(t.approved_at)).toUTCString()}` : ""}`);
  w.row("Fee", `${t.currency ?? ""} ${Number(t.amount ?? 0).toLocaleString("en-GB")} (internal test-mode escrow - no real money moved)`);

  w.heading("Licence terms (snapshot at approval)");
  w.row("Licence type", LICENCES[String(t.license_type)] ?? String(t.license_type ?? ""));
  w.row("Usage rights", (Array.isArray(t.usage_rights) ? t.usage_rights : []).map((r) => RIGHTS[String(r)] ?? String(r)).join(", ") || "As agreed in the brief");
  w.row("Territory", String(t.territory ?? ""));
  w.row("Duration", DURATIONS[String(t.usage_duration)] ?? String(t.usage_duration ?? ""));
  w.row("Exclusivity", EXCLUSIVITY[String(t.exclusivity)] ?? String(t.exclusivity ?? ""));
  w.row("AI disclosure", t.ai_disclosure_required ? "Required when the work is published" : "Not required by the brief");
  const ip = (t.ip_terms ?? {}) as Record<string, unknown>;
  if (ip.notes) w.row("Additional terms", String(ip.notes));

  w.heading("AI generation declaration");
  w.row("Declared AI-generated", t.ai_generated_declared ? "Yes - declared by the creator at submission" : "No");
  w.row("Tools / models declared", d.tools_declared.join(", ") || "None declared");

  w.heading("Licensed assets (SHA-256)");
  if (!d.asset_hashes.length) w.text("No files were attached.", { color: MUTED });
  d.asset_hashes.forEach((a, i) => {
    w.text(`${i + 1}. ${a.name ?? a.link ?? "asset"} (${a.media_type}${a.bytes ? `, ${(a.bytes / 1_048_576).toFixed(2)} MB` : ""})`, { size: 10, gap: 0 });
    w.text(a.sha256 ?? (a.link ? `External link - not hashed: ${a.link}` : "not hashed"), { size: 8.5, font: w.mono, color: MUTED, x: 70, gap: 6 });
  });

  w.rule(14);
  w.text("This record documents what the brand and creator agreed on Creatora AI and fingerprints the exact files delivered. It is generated automatically by the platform, is not a contract drafted or reviewed by a lawyer, and is not legal advice. Payments shown were processed in an internal test-mode ledger; no real money moved.", { size: 8.5, color: MUTED });
  return doc.save();
}

export interface ReceiptData {
  receipt_id: string;
  campaign_title: string;
  brand: string;
  creator: string;
  creator_username: string;
  amount: number;
  currency: string;
  platform_fee: number;
  funded_at: string | null;
  released_at: string;
  certificate_id: string | null;
  ledger: { event: string; created_at: string; amount: number; currency: string }[];
}

export async function receiptPdf(d: ReceiptData): Promise<Uint8Array> {
  const { doc, w } = await start(`Earnings receipt ${d.receipt_id}`);
  w.text("Earnings Receipt", { size: 22, font: w.bold, gap: 2 });
  w.text("TEST MODE - internal escrow ledger. No real money moved.", { size: 10, font: w.bold, color: rgb(0.75, 0.2, 0.15), gap: 14 });
  w.row("Receipt", d.receipt_id);
  w.row("Paid to", `${d.creator} (@${d.creator_username})`);
  w.row("Paid by", d.brand);
  w.row("Campaign", d.campaign_title);
  w.row("Released", new Date(d.released_at).toUTCString());
  if (d.certificate_id) w.row("Licence record", d.certificate_id);
  w.rule();
  w.heading("Amounts");
  const fmt = (n: number) => `${d.currency} ${n.toLocaleString("en-GB")}`;
  w.row("Agreed fee (paid to creator)", fmt(d.amount));
  w.row("Platform fee (paid by brand)", fmt(d.platform_fee));
  w.row("Brand total", fmt(d.amount + d.platform_fee));
  w.heading("Escrow ledger");
  d.ledger.forEach((l) => w.row(new Date(l.created_at).toUTCString(), `${l.event} - ${l.currency} ${l.amount.toLocaleString("en-GB")}`));
  w.rule(14);
  w.text("Creatora AI runs payments as an internal test-mode escrow ledger for this demo. This receipt records platform events and is not a tax document.", { size: 8.5, color: MUTED });
  return doc.save();
}
