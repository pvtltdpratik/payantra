import type { Metadata } from "next";
import { Suspense } from "react";
import { Breadcrumbs } from "@/components/catalogue/breadcrumbs";
import { ListingSkeleton } from "@/components/catalogue/listing-skeleton";
import { ProductListing } from "@/components/catalogue/product-listing";

export const metadata: Metadata = {
  title: "Shop all",
  description: "Browse sarees, kurtas, lehengas, Indo-western wear and accessories for women and men.",
};

export default function ShopPage({ searchParams }: PageProps<"/shop">) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Shop" }]} />
      <h1 className="mb-8 mt-4 text-4xl font-semibold text-primary">Shop all</h1>
      <Suspense fallback={<ListingSkeleton />}>
        <ProductListing basePath="/shop" searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
