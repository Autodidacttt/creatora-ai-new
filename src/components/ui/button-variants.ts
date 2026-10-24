import { cva } from "class-variance-authority";

/** Shared by the client Button and by server components that style links as buttons. */
export const buttonVariants = cva(
  "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition-all duration-200 select-none disabled:pointer-events-none disabled:opacity-50 active:scale-[0.97] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-amber text-on-amber shadow-[0_8px_26px_-8px_var(--glow)] hover:bg-amber-2 hover:-translate-y-0.5 hover:shadow-[0_10px_32px_-6px_var(--glow)]",
        dark: "bg-ink text-bg hover:opacity-90 hover:-translate-y-0.5",
        secondary: "bg-card text-ink border border-line shadow-sm hover:-translate-y-0.5 hover:border-amber/40 hover:shadow-[0_8px_24px_-12px_var(--glow)]",
        glass: "glass text-ink hover:bg-glass-strong",
        ghost: "text-ink hover:bg-ink/5",
        outline: "border border-line text-ink hover:bg-ink/5",
        danger: "bg-danger/10 text-danger hover:bg-danger/15",
        link: "text-ink underline-offset-4 hover:underline px-0",
      },
      size: {
        sm: "h-8 px-3 text-xs [&_svg]:size-3.5",
        md: "h-10 px-4 text-sm [&_svg]:size-4",
        lg: "h-12 px-6 text-base [&_svg]:size-5",
        icon: "size-10 [&_svg]:size-[18px]",
        "icon-sm": "size-8 [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);
