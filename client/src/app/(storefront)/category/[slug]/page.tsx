import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Breadcrumbs } from "@/components/catalogue/breadcrumbs";
import { ListingSkeleton } from "@/components/catalogue/listing-skeleton";
import { ProductListing } from "@/components/catalogue/product-listing";
import { getCategory } from "@/services/catalogue";

export async function generateMetadata({ params }: PageProps<"/category/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCategory(slug);
  if (!category) return { title: "Category not found" };
  return {
    title: category.name,
    description: category.description ?? `Shop ${category.name} at Payantra.`,
  };
}

async function CategoryBody({ params, searchParams }: PageProps<"/category/[slug]">) {
  const { slug } = await params;
  const category = await getCategory(slug);
  if (!category) notFound();

  const crumbs = [
    { label: "Home", href: "/" },
    ...category.breadcrumb.map((b, i, all) => ({
      label: b.name,
      href: i < all.length - 1 ? `/category/${b.slug}` : undefined,
    })),
  ];

  return (
    <>
      <Breadcrumbs items={crumbs} />
      <h1 className="mt-4 text-4xl font-semibold text-primary">{category.name}</h1>
      {category.description && <p className="mt-2 max-w-2xl text-muted-foreground">{category.description}</p>}

      {category.children.length > 0 && (
        <ul className="mt-6 flex flex-wrap gap-2" aria-label="Sub-categories">
          {category.children.map((c) => (
            <li key={c.id}>
              <Link href={`/category/${c.slug}`} className="inline-block rounded-full border bg-card px-4 py-1.5 text-sm hover:border-primary">
                {c.name} <span className="text-muted-foreground">({c.productCount})</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-8">
        <ProductListing
          basePath={`/category/${category.slug}`}
          searchParams={searchParams}
          categorySlug={category.slug}
        />
      </div>
    </>
  );
}

export default function CategoryPage(props: PageProps<"/category/[slug]">) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <Suspense fallback={<ListingSkeleton />}>
        <CategoryBody {...props} />
      </Suspense>
    </div>
  );
}
