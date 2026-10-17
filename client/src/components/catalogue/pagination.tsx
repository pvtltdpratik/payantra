import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { hrefWith, type RawSearchParams } from "@/lib/catalogue-params";
import { cn } from "@/lib/utils";

interface Props {
  basePath: string;
  searchParams: RawSearchParams;
  page: number;
  totalPages: number;
}

function windowed(page: number, total: number): (number | "…")[] {
  const pages = new Set([1, total, page - 1, page, page + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push("…");
    out.push(p);
  });
  return out;
}

export function Pagination({ basePath, searchParams, page, totalPages }: Props) {
  if (totalPages <= 1) return null;
  const href = (p: number) => hrefWith(basePath, searchParams, { page: p === 1 ? undefined : p });
  const base = "inline-flex h-10 min-w-10 items-center justify-center rounded-md border px-3 text-sm";

  return (
    <nav aria-label="Pagination" className="mt-12 flex flex-wrap items-center justify-center gap-2">
      {page > 1 ? (
        <Link href={href(page - 1)} rel="prev" className={cn(base, "hover:bg-muted")}>
          <ChevronLeft aria-hidden className="size-4" />
          <span className="sr-only sm:not-sr-only sm:ml-1">Previous</span>
        </Link>
      ) : null}

      {windowed(page, totalPages).map((p, i) =>
        p === "…" ? (
          <span key={`gap-${i}`} aria-hidden className="px-1 text-muted-foreground">
            …
          </span>
        ) : (
          <Link
            key={p}
            href={href(p)}
            aria-label={`Page ${p}`}
            aria-current={p === page ? "page" : undefined}
            className={cn(base, p === page ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
          >
            {p}
          </Link>
        ),
      )}

      {page < totalPages ? (
        <Link href={href(page + 1)} rel="next" className={cn(base, "hover:bg-muted")}>
          <span className="sr-only sm:not-sr-only sm:mr-1">Next</span>
          <ChevronRight aria-hidden className="size-4" />
        </Link>
      ) : null}
    </nav>
  );
}
