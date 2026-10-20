/* eslint-disable @next/next/no-img-element */
import { BadgeCheck } from "lucide-react";
import { cn, initials } from "@/lib/utils";

const SIZES = { xs: "size-6 text-[10px]", sm: "size-8 text-xs", md: "size-10 text-sm", lg: "size-14 text-base", xl: "size-24 text-2xl", "2xl": "size-32 text-3xl" };

export function Avatar({ src, name, size = "md", className, verified }: {
  src: string | null | undefined;
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
  verified?: boolean;
}) {
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      {src ? (
        <img src={src} alt="" className={cn(SIZES[size], "rounded-full object-cover ring-2 ring-card")} loading="lazy" />
      ) : (
        <span
          aria-hidden
          className={cn(SIZES[size], "grid place-items-center rounded-full bg-gradient-to-br from-amber to-amber-2 font-semibold text-on-amber ring-2 ring-card")}
        >
          {initials(name) || "?"}
        </span>
      )}
      {verified && (
        <BadgeCheck
          aria-label="Verified"
          className={cn(
            "absolute -bottom-0.5 -right-0.5 rounded-full bg-card fill-amber text-on-amber",
            size === "xl" || size === "2xl" ? "size-7" : size === "lg" ? "size-5" : "size-3.5",
          )}
        />
      )}
    </span>
  );
}
