import type { Metadata } from "next";
import { Suspense } from "react";
import { UsersTable } from "@/components/admin/users-table";
import { Pagination } from "@/components/catalogue/pagination";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { requireAdmin } from "@/lib/server-session";
import type { PageMeta } from "@/types/catalogue";
import type { AdminUser } from "@/types/admin";

export const metadata: Metadata = { title: "Users & roles" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function Body({ searchParams }: Pick<PageProps<"/admin/users">, "searchParams">) {
  const { token, me } = await requireAdmin("/admin/users");
  const sp = await searchParams;
  const q = first(sp.q)?.trim() || undefined;
  const role = ["CUSTOMER", "DELIVERY_PARTNER", "ADMIN"].includes(first(sp.role) ?? "") ? first(sp.role) : undefined;
  const page = Math.max(1, Number(first(sp.page)) || 1);

  const { data, meta } = await api<AdminUser[]>("/admin/users", { token, query: { q, role, page, pageSize: 25 }, cache: "no-store" });
  const m = meta as unknown as PageMeta;

  return (
    <>
      <form method="get" className="mb-6 flex flex-wrap items-center gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search name or email"
          aria-label="Search users"
          className="h-10 w-full max-w-xs rounded-md border border-input bg-card px-3 text-sm"
        />
        <select name="role" defaultValue={role ?? ""} aria-label="Filter by role" className="h-10 rounded-md border border-input bg-card px-3 text-sm">
          <option value="">All roles</option>
          <option value="CUSTOMER">Customers</option>
          <option value="DELIVERY_PARTNER">Delivery partners</option>
          <option value="ADMIN">Administrators</option>
        </select>
        <Button type="submit" variant="outline" className="h-10">
          Filter
        </Button>
      </form>
      {data.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-card p-10 text-center text-muted-foreground">No users match.</p>
      ) : (
        <UsersTable users={data} currentUserId={me.id} />
      )}
      <Pagination basePath="/admin/users" searchParams={sp} page={m.page} totalPages={m.totalPages} />
    </>
  );
}

export default function AdminUsersPage({ searchParams }: PageProps<"/admin/users">) {
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-2 text-4xl font-semibold text-primary">Users &amp; roles</h1>
      <p className="mb-6 max-w-2xl text-sm text-muted-foreground">
        Roles are stored in the database and enforced by the API on every request. Changes are written to the audit log.
      </p>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
