import Link from "next/link";
import { cn } from "@/lib/utils";

/** A section's eyebrow, title and optional "view all" link. The wrapper is revealed as one unit on scroll. */
export function SectionHeading({
  id,
  eyebrow,
  title,
  href,
  linkLabel = "View all",
  tone = "light",
  className,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  href?: string;
  linkLabel?: string;
  tone?: "light" | "dark";
  className?: string;
}) {
  const dark = tone === "dark";
  return (
    <div data-reveal className={cn("mb-8 flex items-end justify-between gap-4", className)}>
      <div>
        {eyebrow && <p className={cn("mb-2 text-xs font-medium uppercase tracking-[0.3em]", dark ? "text-gold" : "text-[#8a6a2b]")}>{eyebrow}</p>}
        <h2 id={id} className={cn("text-3xl font-semibold sm:text-4xl", dark ? "text-primary-foreground" : "text-primary")}>
          {title}
        </h2>
      </div>
      {href && (
        <Link href={href} className={cn("shrink-0 text-sm font-medium underline-offset-4 hover:underline", dark ? "text-gold" : "text-primary")}>
          {linkLabel}
          <span aria-hidden> →</span>
        </Link>
      )}
    </div>
  );
}
