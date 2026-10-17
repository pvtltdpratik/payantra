import Link from "next/link";
import { Suspense } from "react";
import { Heart } from "lucide-react";
import { getCategoryTreeSafe } from "@/services/catalogue";
import { AccountLink } from "./account-link";
import { CartBadge } from "./cart-badge";
import { MobileNav } from "./mobile-nav";
import { NotificationBell } from "./notification-bell";
import { SearchBox } from "./search-box";

const NAV = [
  { href: "/shop?newArrival=true", label: "New arrivals" },
  { href: "/shop?gender=WOMEN", label: "Women" },
  { href: "/shop?gender=MEN", label: "Men" },
  { href: "/shop?collection=festive-wear", label: "Festive" },
];

export async function SiteHeader() {
  const categories = await getCategoryTreeSafe();

  return (
    <header className="sticky top-0 z-40 print:hidden border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-2 gap-y-2 px-4 py-2 sm:gap-x-4 sm:py-0 lg:h-16 lg:flex-nowrap">
        <MobileNav categories={categories} />

        <Link href="/" className="font-serif text-2xl font-semibold tracking-[0.28em] text-primary">
          PAYANTRA
        </Link>

        <nav aria-label="Main" className="ml-6 hidden items-center gap-1 lg:flex">
          {/* Category menu opens on hover and on keyboard focus — no JavaScript required. */}
          <div className="group relative">
            <button
              type="button"
              className="rounded-md px-3 py-2 text-sm font-medium hover:bg-muted"
              aria-haspopup="true"
            >
              Shop by category
            </button>
            <div className="invisible absolute left-0 top-full z-50 w-[34rem] translate-y-1 rounded-lg border bg-popover p-5 opacity-0 shadow-lg transition group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100">
              {categories.length === 0 ? (
                <p className="text-sm text-muted-foreground">Categories are unavailable right now.</p>
              ) : (
                <ul className="grid grid-cols-2 gap-x-6 gap-y-3">
                  {categories.map((c) => (
                    <li key={c.id}>
                      <Link href={`/category/${c.slug}`} className="text-sm font-semibold hover:text-primary">
                        {c.name}
                      </Link>
                      {c.children.length > 0 && (
                        <ul className="mt-1 space-y-0.5">
                          {c.children.map((child) => (
                            <li key={child.id}>
                              <Link href={`/category/${child.slug}`} className="text-sm text-muted-foreground hover:text-primary">
                                {child.name}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {NAV.map((l) => (
            <Link key={l.href} href={l.href} className="rounded-md px-3 py-2 text-sm font-medium hover:bg-muted">
              {l.label}
            </Link>
          ))}
        </nav>

        {/* Mobile: search drops to its own full-width row so it stays usable. */}
        <div className="order-last basis-full sm:order-none sm:ml-auto sm:min-w-0 sm:flex-1 sm:basis-auto sm:max-w-xs lg:max-w-sm">
          <SearchBox />
        </div>
        <div className="ml-auto flex items-center sm:ml-0">
          <Link href="/wishlist" aria-label="Wishlist" className="inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-muted">
            <Heart aria-hidden className="size-5" />
          </Link>
          <CartBadge />
          <NotificationBell />
          <Suspense fallback={<span className="inline-block h-10 w-10" />}>
            <AccountLink />
          </Suspense>
        </div>
      </div>
    </header>
  );
}
