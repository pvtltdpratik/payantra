import type { Metadata } from "next";
import { Suspense } from "react";
import { CategoriesManager } from "@/components/admin/categories-manager";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { requireAdmin } from "@/lib/server-session";
import type { AdminCategory } from "@/types/admin";

export const metadata: Metadata = { title: "Categories" };

async function Body() {
  const { token } = await requireAdmin("/admin/categories");
  const { data } = await api<AdminCategory[]>("/admin/categories", { token, cache: "no-store" });
  return <CategoriesManager categories={data} />;
}

export default function AdminCategoriesPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-6 text-4xl font-semibold text-primary">Categories</h1>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Body />
      </Suspense>
    </div>
  );
}
