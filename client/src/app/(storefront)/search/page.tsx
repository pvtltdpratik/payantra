import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Breadcrumbs } from "@/components/catalogue/breadcrumbs";
import { ListingSkeleton } from "@/components/catalogue/listing-skeleton";
import { ProductListing } from "@/components/catalogue/product-listing";
import { getCategoryTreeSafe } from "@/services/catalogue";

export const metadata: Metadata = {
  title: "Search",
  robots: { index: false }, // result pages are infinite; keep them out of search engines
};

async function SearchBody({ searchParams }: Pick<PageProps<"/search">, "searchParams">) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.q) ? sp.q[0] : sp.q;
  const q = raw?.trim().slice(0, 100);

  if (!q) {
    const categories = await getCategoryTreeSafe();
    return (
      <div className="rounded-lg border border-dashed bg-card px-6 py-16 text-center">
        <h2 className="font-serif text-2xl">What are you looking for?</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          Search by product, fabric or category — or start from one of these.
        </p>
        <ul className="mt-6 flex flex-wrap justify-center gap-2">
          {categories.slice(0, 8).map((c) => (
            <li key={c.id}>
              <Link href={`/category/${c.slug}`} className="rounded-full border bg-background px-4 py-1.5 text-sm hover:border-primary">
                {c.name}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <>
      <h1 className="mb-8 mt-4 text-4xl font-semibold text-primary">
        Results for <span className="italic">“{q}”</span>
      </h1>
      <ProductListing
        basePath="/search"
        searchParams={searchParams}
        emptyHint={`We couldn't find anything for “${q}”. Check the spelling or try a broader term such as “silk” or “kurta”.`}
      />
    </>
  );
}

export default function SearchPage({ searchParams }: PageProps<"/search">) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Search" }]} />
      <Suspense fallback={<ListingSkeleton />}>
        <SearchBody searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
