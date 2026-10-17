import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn, formatINR } from "@/lib/utils";
import type { ColumnType, Report } from "@/types/analytics";

function format(type: ColumnType, v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  switch (type) {
    case "money":
      return formatINR(Number(v));
    case "int":
      return Number(v).toLocaleString("en-IN");
    case "percent":
      return `${v}%`;
    case "datetime":
      return new Date(String(v)).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
    case "date":
      // "2026-10-05" is already an India calendar date; show it without a time-zone shift.
      return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? new Date(`${v}T00:00:00.000Z`).toLocaleDateString("en-IN", { dateStyle: "medium", timeZone: "UTC" }) : String(v);
    default:
      return String(v);
  }
}

const numeric: ColumnType[] = ["int", "money", "percent"];

/** Renders any report from its column definitions, so a new report needs no new screen. */
export function ReportTable({ report }: { report: Report }) {
  if (report.rows.length === 0) {
    return <p className="rounded-xl border border-dashed bg-card p-10 text-center text-muted-foreground">Nothing to report for these dates.</p>;
  }
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table data-testid="report-table">
          <TableHeader>
            <TableRow>
              {report.columns.map((c) => (
                <TableHead key={c.key} className={cn(numeric.includes(c.type) && "text-right")}>
                  {c.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.rows.map((row, i) => (
              <TableRow key={i} data-testid="report-row">
                {report.columns.map((c) => (
                  <TableCell key={c.key} className={cn("text-sm", numeric.includes(c.type) && "text-right tabular-nums")}>
                    {format(c.type, row[c.key])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {report.totals && (
              <TableRow className="bg-muted/40 font-semibold" data-testid="report-totals">
                {report.columns.map((c) => (
                  <TableCell key={c.key} className={cn("text-sm", numeric.includes(c.type) && "text-right tabular-nums")}>
                    {format(c.type === "date" || c.type === "datetime" ? "text" : c.type, report.totals![c.key])}
                  </TableCell>
                ))}
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {report.truncated && <p className="text-xs text-warning">Showing the first rows only. Narrow the dates, or download the CSV for everything.</p>}
    </div>
  );
}
