import type { Metadata } from "next";
import { Suspense } from "react";
import { SupportCenter, type OrderOption } from "@/components/support/support-center";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { requireSession } from "@/lib/server-session";
import type { SupportRequestRow } from "@/types/analytics";

export const metadata: Metadata = { title: "Help & support", robots: { index: false } };

async function Body() {
  const { token } = await requireSession("/account/support");
  const [{ data: requests }, { data: orders }] = await Promise.all([
    api<SupportRequestRow[]>("/support", { token, cache: "no-store" }),
    api<OrderOption[]>("/orders", { token, cache: "no-store", query: { pageSize: 20 } }),
  ]);
  return <SupportCenter requests={requests} orders={orders.map((o) => ({ id: o.id, orderNumber: o.orderNumber }))} />;
}

export default function AccountSupportPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-4xl font-semibold text-primary">Help &amp; support</h1>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Body />
      </Suspense>
    </div>
  );
}
