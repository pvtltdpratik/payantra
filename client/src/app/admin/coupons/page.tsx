import type { Metadata } from "next";
import { Suspense } from "react";
import { CouponsManager } from "@/components/admin/coupons-manager";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { requireAdmin } from "@/lib/server-session";
import type { AdminCoupon } from "@/types/admin";

export const metadata: Metadata = { title: "Coupons" };

async function Body() {
  const { token } = await requireAdmin("/admin/coupons");
  const { data } = await api<AdminCoupon[]>("/admin/coupons", { token, query: { pageSize: 100 }, cache: "no-store" });
  return <CouponsManager coupons={data} />;
}

export default function AdminCouponsPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-6 text-4xl font-semibold text-primary">Coupons</h1>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Body />
      </Suspense>
    </div>
  );
}
