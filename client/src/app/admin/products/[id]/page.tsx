import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ImagesManager } from "@/components/admin/images-manager";
import { ProductForm } from "@/components/admin/product-form";
import { StatusBadge } from "@/components/admin/status-badge";
import { VariantsManager } from "@/components/admin/variants-manager";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError } from "@/lib/api";
import { requireAdmin } from "@/lib/server-session";
import type { AdminCategory, AdminProduct } from "@/types/admin";

export const metadata: Metadata = { title: "Edit product" };

async function Body({ params }: Pick<PageProps<"/admin/products/[id]">, "params">) {
  const { id } = await params;
  const { token } = await requireAdmin(`/admin/products/${id}`);

  let product: AdminProduct;
  try {
    product = (await api<AdminProduct>(`/admin/products/${encodeURIComponent(id)}`, { token, cache: "no-store" })).data;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) notFound();
    throw err;
  }
  const { data: categories } = await api<AdminCategory[]>("/admin/categories", { token, cache: "no-store" });

  return (
    <>
      <div className="mb-6 mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-4xl font-semibold text-primary">{product.name}</h1>
        <StatusBadge status={product.status} />
        {product.status === "ACTIVE" && (
          <Link href={`/product/${product.slug}`} className="text-sm text-primary underline-offset-4 hover:underline" target="_blank">
            View in store ↗
          </Link>
        )}
      </div>
      <div className="space-y-8">
        <ProductForm categories={categories} product={product} />
        <ImagesManager productId={product.id} images={product.images} />
        <VariantsManager productId={product.id} variants={product.variants} />
      </div>
    </>
  );
}

export default function EditProductPage({ params }: PageProps<"/admin/products/[id]">) {
  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/admin/products" className="text-sm text-muted-foreground hover:text-primary">
        ← Products
      </Link>
      <Suspense fallback={<Skeleton className="mt-6 h-96" />}>
        <Body params={params} />
      </Suspense>
    </div>
  );
}
