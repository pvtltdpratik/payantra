import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Breadcrumbs } from "@/components/catalogue/breadcrumbs";
import { ProductGallery } from "@/components/catalogue/product-gallery";
import { PurchasePanel } from "@/components/catalogue/purchase-panel";
import { Rating } from "@/components/catalogue/rating";
import { SizeGuide } from "@/components/catalogue/size-guide";
import { Skeleton } from "@/components/ui/skeleton";
import { getProduct } from "@/services/catalogue";

export async function generateMetadata({ params }: PageProps<"/product/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) return { title: "Product not found" };
  const image = product.images[0]?.url;
  return {
    title: product.name,
    description: product.description.slice(0, 155),
    openGraph: { title: product.name, description: product.description.slice(0, 155), images: image ? [image] : undefined },
  };
}

async function ProductBody({ params }: Pick<PageProps<"/product/[slug]">, "params">) {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) notFound();

  const crumbs = [
    { label: "Home", href: "/" },
    ...product.breadcrumb.map((b) => ({ label: b.name, href: `/category/${b.slug}` })),
    { label: product.name },
  ];

  // Structured data helps search engines show price and availability.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description,
    sku: product.variants[0]?.sku,
    image: product.images.map((i) => i.url),
    offers: {
      "@type": "Offer",
      priceCurrency: "INR",
      price: (product.price / 100).toFixed(2),
      availability: product.inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    },
    ...(product.ratingCount > 0
      ? { aggregateRating: { "@type": "AggregateRating", ratingValue: product.ratingAverage, reviewCount: product.ratingCount } }
      : {}),
  };

  return (
    <>
      <script
        type="application/ld+json"
        // Escape "<" so product text can never close the script tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <Breadcrumbs items={crumbs} />

      <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <ProductGallery images={product.images} name={product.name} />

        <div className="space-y-8">
          <header className="space-y-2">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{product.category.name}</p>
            <h1 className="text-4xl font-semibold leading-tight text-primary">{product.name}</h1>
            <Rating value={product.ratingAverage} count={product.ratingCount} />
          </header>

          <PurchasePanel product={product} />

          <SizeGuide gender={product.gender} sizes={product.options.sizes} />

          <section aria-labelledby="details-heading" className="space-y-3">
            <h2 id="details-heading" className="text-2xl font-semibold">
              About this piece
            </h2>
            <p className="leading-relaxed text-muted-foreground">{product.description}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 border-t pt-4 text-sm">
              {product.fabric && (
                <>
                  <dt className="text-muted-foreground">Fabric</dt>
                  <dd>{product.fabric}</dd>
                </>
              )}
              {product.occasion && (
                <>
                  <dt className="text-muted-foreground">Occasion</dt>
                  <dd>{product.occasion}</dd>
                </>
              )}
              {product.careNotes && (
                <>
                  <dt className="text-muted-foreground">Care</dt>
                  <dd>{product.careNotes}</dd>
                </>
              )}
              {product.collections.length > 0 && (
                <>
                  <dt className="text-muted-foreground">Collections</dt>
                  <dd>{product.collections.map((c) => c.name).join(", ")}</dd>
                </>
              )}
            </dl>
          </section>
        </div>
      </div>
    </>
  );
}

function ProductSkeleton() {
  return (
    <div className="mt-6 grid gap-10 lg:grid-cols-2" aria-busy="true" aria-label="Loading product">
      <Skeleton className="aspect-[4/5] w-full" />
      <div className="space-y-4">
        <Skeleton className="h-4 w-1/4" />
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  );
}

export default function ProductPage({ params }: PageProps<"/product/[slug]">) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <Suspense fallback={<ProductSkeleton />}>
        <ProductBody params={params} />
      </Suspense>
    </div>
  );
}
