import type { Metadata } from "next";
import { Suspense } from "react";
import { Pagination } from "@/components/catalogue/pagination";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { requireAdmin } from "@/lib/server-session";
import type { PageMeta } from "@/types/catalogue";
import type { AuditEntry } from "@/types/analytics";

export const metadata: Metadata = { title: "Audit log" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const ENTITIES = ["Order", "Product", "ProductVariant", "Category", "Coupon", "Profile", "DeliveryPartner", "AppSetting", "Banner", "SupportRequest", "NewsletterSubscriber"];

/** Metadata is stored as JSON; show it as short readable text, never as markup. */
function summarise(meta: unknown): string {
  if (meta === null || meta === undefined) return "";
  const text = typeof meta === "string" ? meta : JSON.stringify(meta);
  return text.length > 140 ? `${text.slice(0, 140)}…` : text;
}

async function Body({ searchParams }: Pick<PageProps<"/admin/audit">, "searchParams">) {
  const { token } = await requireAdmin("/admin/audit");
  const sp = await searchParams;
  const entityType = ENTITIES.find((e) => e === first(sp.entityType));
  const page = Math.max(1, Number(first(sp.page)) || 1);
  const { data, meta } = await api<AuditEntry[]>("/admin/audit-logs", { token, cache: "no-store", query: { entityType, page, pageSize: 30 } });
  const m = meta as unknown as PageMeta;

  return (
    <>
      <form method="get" className="mb-6 flex flex-wrap items-center gap-2">
        <select name="entityType" defaultValue={entityType ?? ""} aria-label="What changed" className="h-10 rounded-md border border-input bg-card px-3 text-sm">
          <option value="">Everything</option>
          {ENTITIES.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline" className="h-10">
          Filter
        </Button>
      </form>

      {data.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-card p-10 text-center text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When (IST)</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((a) => (
                <TableRow key={a.id} data-testid="audit-row">
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{new Date(a.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })}</TableCell>
                  <TableCell className="text-sm">{a.actor?.fullName ?? a.actor?.email ?? "System"}</TableCell>
                  <TableCell className="text-sm">
                    <span className="font-medium">{a.action}</span>
                    <span className="block text-xs text-muted-foreground">{a.entityType}</span>
                  </TableCell>
                  <TableCell className="max-w-md break-words font-mono text-xs text-muted-foreground">{summarise(a.metadata)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Pagination basePath="/admin/audit" searchParams={sp} page={m.page} totalPages={m.totalPages} />
    </>
  );
}

export default function AdminAuditPage({ searchParams }: PageProps<"/admin/audit">) {
  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-2 text-4xl font-semibold text-primary">Audit log</h1>
      <p className="mb-6 text-sm text-muted-foreground">Every important admin action — who did it, what changed, and when. Entries cannot be edited.</p>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
