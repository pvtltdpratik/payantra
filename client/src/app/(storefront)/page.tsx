import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { ProductCard } from "@/components/catalogue/product-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError, isFrameworkSignal } from "@/lib/api";
import { listProducts } from "@/services/catalogue";

/** Renders only when something is wrong, so shoppers never see developer chrome. */
async function SystemNotice() {
  await connection();
  try {
    await api("/health/ready", { cache: "no-store" });
    return null;
  } catch (err) {
    if (isFrameworkSignal(err)) throw err;
    const dbDown = err instanceof ApiError && err.status === 503;
    return (
      <p role="status" className="mx-auto mt-8 max-w-md rounded-md border border-destructive/30 bg-destructive/5 px-4 py-2 text-center text-sm text-destructive">
        {dbDown
          ? "The API is running but its database is unreachable — check DATABASE_URL."
          : "The API is unreachable — start the server on port 4000."}
      </p>
    );
  }
}

async function ProductRow({ title, href, query }: { title: string; href: string; query: Record<string, string | number> }) {
  await connection();
  let items: Awaited<ReturnType<typeof listProducts>>["items"] = [];
  try {
    items = (await listProducts({ ...query, pageSize: 4 })).items;
  } catch (err) {
    if (isFrameworkSignal(err)) throw err;
    return null; // a failed product row should not take the home page down
  }
  if (items.length === 0) return null;

  return (
    <section className="mx-auto max-w-7xl px-4 py-12" aria-labelledby={`row-${title}`}>
      <div className="mb-6 flex items-end justify-between gap-4">
        <h2 id={`row-${title}`} className="text-3xl font-semibold text-primary">
          {title}
        </h2>
        <Link href={href} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
          View all
        </Link>
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-10 lg:grid-cols-4">
        {items.map((p) => (
          <li key={p.id}>
            <ProductCard product={p} />
          </li>
        ))}
      </ul>
    </section>
  );
}

const RowSkeleton = () => (
  <div className="mx-auto grid max-w-7xl grid-cols-2 gap-4 px-4 py-12 lg:grid-cols-4" aria-hidden>
    {Array.from({ length: 4 }, (_, i) => (
      <Skeleton key={i} className="aspect-[4/5]" />
    ))}
  </div>
);

/**
 * Interim home page: the full 3D landing experience ships in Phase 5.
 * Product rows are live from the catalogue API.
 */
export default function Home() {
  return (
    <>
      <section className="px-4 py-20 text-center sm:py-28">
        <p className="text-xs uppercase tracking-[0.35em] text-gold">Indian fashion, reimagined</p>
        <h1 className="mx-auto mt-4 max-w-3xl text-5xl font-semibold leading-[1.05] text-primary sm:text-7xl">
          Woven in tradition, worn for today
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-muted-foreground">
          Sarees, kurtas, lehengas and Indo-western pieces from skilled weavers and designers across India.
        </p>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <Button size="lg" className="h-11 px-6 text-base" nativeButton={false} render={<Link href="/shop" />}>
            Explore Collection
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="h-11 px-6 text-base"
            nativeButton={false}
            render={<Link href="/shop?newArrival=true" />}
          >
            New arrivals
          </Button>
        </div>
        <Suspense fallback={null}>
          <SystemNotice />
        </Suspense>
      </section>

      <Suspense fallback={<RowSkeleton />}>
        <ProductRow title="Featured" href="/shop?featured=true" query={{ featured: "true", sort: "popularity" }} />
      </Suspense>
      <Suspense fallback={<RowSkeleton />}>
        <ProductRow title="New arrivals" href="/shop?newArrival=true" query={{ newArrival: "true", sort: "newest" }} />
      </Suspense>
    </>
  );
}
