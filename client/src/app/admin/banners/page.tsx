import type { Metadata } from "next";
import { Suspense } from "react";
import { BannersManager } from "@/components/admin/banners-manager";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { requireAdmin } from "@/lib/server-session";
import type { AdminBanner } from "@/types/analytics";

export const metadata: Metadata = { title: "Banners" };

async function Body() {
  const { token } = await requireAdmin("/admin/banners");
  const { data } = await api<AdminBanner[]>("/admin/banners", { token, cache: "no-store" });
  return <BannersManager banners={data} />;
}

export default function AdminBannersPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-2 text-4xl font-semibold text-primary">Banners</h1>
      <p className="mb-6 text-sm text-muted-foreground">Homepage and category banners. Only live banners are shown to shoppers, in the order you set.</p>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Body />
      </Suspense>
    </div>
  );
}
