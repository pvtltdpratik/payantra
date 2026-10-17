import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ProductForm } from "@/components/admin/product-form";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { requireAdmin } from "@/lib/server-session";
import type { AdminCategory } from "@/types/admin";

export const metadata: Metadata = { title: "New product" };

async function Body() {
  const { token } = await requireAdmin("/admin/products/new");
  const { data: categories } = await api<AdminCategory[]>("/admin/categories", { token, cache: "no-store" });

  if (categories.length === 0) {
    return (
      <p className="rounded-lg border border-dashed bg-card p-8 text-center text-muted-foreground">
        Create a category first — every product belongs to one.{" "}
        <Link href="/admin/categories" className="text-primary underline">
          Go to categories
        </Link>
      </p>
    );
  }
  return <ProductForm categories={categories} />;
}

export default function NewProductPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/admin/products" className="text-sm text-muted-foreground hover:text-primary">
        ← Products
      </Link>
      <h1 className="mb-6 mt-2 text-4xl font-semibold text-primary">New product</h1>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Body />
      </Suspense>
    </div>
  );
}
