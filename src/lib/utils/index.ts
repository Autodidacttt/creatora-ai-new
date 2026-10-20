import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatDistanceToNowStrict } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function compact(n: number | null | undefined) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n ?? 0);
}

export function money(min: number | null, max: number | null, currency: string) {
  const f = new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 0 });
  if (min != null && max != null) return `${f.format(min)} – ${f.format(max)}`;
  if (min != null) return `from ${f.format(min)}`;
  if (max != null) return `up to ${f.format(max)}`;
  return "Budget TBD";
}

export function timeAgo(date: string | Date) {
  return formatDistanceToNowStrict(new Date(date), { addSuffix: true });
}

export function aspectClass(ratio: string | null | undefined) {
  switch (ratio) {
    case "9:16": return "aspect-[9/16]";
    case "1:1": return "aspect-square";
    case "4:5": return "aspect-[4/5]";
    case "4:3": return "aspect-[4/3]";
    case "21:9": return "aspect-[21/9]";
    default: return "aspect-video";
  }
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
}

export function errorMessage(err: unknown, fallback = "Something went wrong") {
  if (!err) return fallback;
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message || fallback;
  if (typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return fallback;
}

export function daysUntil(date: string | null) {
  if (!date) return null;
  const d = new Date(`${date}T23:59:59`);
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}
