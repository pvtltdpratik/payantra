import Link from "next/link";
import { cacheLife } from "next/cache";
import { getCategoryTreeSafe } from "@/services/catalogue";
import { NewsletterForm } from "./newsletter-form";

/** The current time is "unstable" during prerender, so it is computed inside a cache scope. */
async function currentYear() {
  "use cache";
  cacheLife("days");
  return new Date().getFullYear();
}

export async function SiteFooter() {
  const categories = await getCategoryTreeSafe();
  const year = await currentYear();

  return (
    <footer className="mt-24 print:hidden border-t bg-primary text-primary-foreground">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="font-serif text-2xl font-semibold tracking-[0.28em]">PAYANTRA</p>
          <p className="mt-3 max-w-xs text-sm text-primary-foreground/75">
            Indian fashion, reimagined — sarees, kurtas and Indo-western wear made with respect for craft.
          </p>
        </div>

        <nav aria-label="Shop">
          <h2 className="font-sans text-xs font-semibold uppercase tracking-widest text-gold">Shop</h2>
          <ul className="mt-4 space-y-2 text-sm">
            <li><Link className="hover:underline" href="/shop?gender=WOMEN">Women</Link></li>
            <li><Link className="hover:underline" href="/shop?gender=MEN">Men</Link></li>
            <li><Link className="hover:underline" href="/shop?newArrival=true">New arrivals</Link></li>
            <li><Link className="hover:underline" href="/shop?featured=true">Featured</Link></li>
            <li><Link className="hover:underline" href="/shop">All products</Link></li>
          </ul>
        </nav>

        <nav aria-label="Categories">
          <h2 className="font-sans text-xs font-semibold uppercase tracking-widest text-gold">Categories</h2>
          <ul className="mt-4 space-y-2 text-sm">
            {categories.slice(0, 7).map((c) => (
              <li key={c.id}>
                <Link className="hover:underline" href={`/category/${c.slug}`}>{c.name}</Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label="Account">
          <h2 className="font-sans text-xs font-semibold uppercase tracking-widest text-gold">Account</h2>
          <ul className="mt-4 space-y-2 text-sm">
            <li><Link className="hover:underline" href="/auth/login">Sign in</Link></li>
            <li><Link className="hover:underline" href="/auth/register">Create an account</Link></li>
            <li><Link className="hover:underline" href="/account/support">Help &amp; support</Link></li>
            <li><Link className="hover:underline" href="/delivery">Deliver with us</Link></li>
          </ul>
        </nav>
      </div>
      <div className="mx-auto max-w-7xl px-4 pb-10">
        <div className="max-w-md">
          <h2 className="mb-2 font-sans text-xs font-semibold uppercase tracking-widest text-gold">Stay in touch</h2>
          <NewsletterForm />
        </div>
      </div>
      <div className="border-t border-primary-foreground/15">
        <p className="mx-auto max-w-7xl px-4 py-5 text-xs text-primary-foreground/65">
          © {year} Payantra. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
