import Link from "next/link";
import { Button } from "@/components/ui/button";
import { addDays } from "@/lib/ist";

/**
 * Date range controls, as a plain GET form (it works without JavaScript and the range lives in the URL, so a
 * view can be bookmarked or shared). `today` is India's date, passed in by the page.
 */
export function DateRangeForm({
  basePath,
  from,
  to,
  today,
  extra = {},
}: {
  basePath: string;
  from: string;
  to: string;
  today: string;
  /** Other query values to keep when the range changes (the active report, granularity…). */
  extra?: Record<string, string>;
}) {
  const link = (days: number) => {
    const qs = new URLSearchParams({ ...extra, from: addDays(today, -(days - 1)), to: today });
    return `${basePath}?${qs.toString()}`;
  };
  const input = "h-10 rounded-md border border-input bg-card px-3 text-sm";
  return (
    <div className="mb-6 flex flex-wrap items-end gap-x-6 gap-y-3">
      <form method="get" action={basePath} className="flex flex-wrap items-end gap-2" aria-label="Date range">
        {Object.entries(extra).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <label className="space-y-1 text-xs font-medium text-muted-foreground">
          From
          <input type="date" name="from" defaultValue={from} max={today} className={`${input} block text-foreground`} />
        </label>
        <label className="space-y-1 text-xs font-medium text-muted-foreground">
          To
          <input type="date" name="to" defaultValue={to} max={today} className={`${input} block text-foreground`} />
        </label>
        <Button type="submit" variant="outline" className="h-10">
          Apply
        </Button>
      </form>
      <nav aria-label="Quick ranges" className="flex gap-1 text-sm">
        {[
          [7, "7 days"],
          [30, "30 days"],
          [90, "90 days"],
        ].map(([d, label]) => (
          <Link key={d} href={link(d as number)} className="rounded-md px-3 py-2 font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
