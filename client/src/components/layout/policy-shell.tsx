import type { ReactNode } from "react";
import Link from "next/link";
import { Breadcrumbs } from "@/components/catalogue/breadcrumbs";

/** Shared frame for the policy and contact pages: breadcrumb, title, readable column, related links. */
export function PolicyShell({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: title }]} />
      <h1 className="mt-4 text-4xl font-semibold text-primary sm:text-5xl">{title}</h1>
      {intro && <p className="mt-3 text-lg text-muted-foreground">{intro}</p>}
      <div className="mt-8 space-y-8 leading-relaxed [&_h2]:mb-2 [&_h2]:font-serif [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:text-primary [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1 [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4">
        {children}
      </div>
      <nav aria-label="Other policies" className="mt-12 flex flex-wrap gap-x-5 gap-y-2 border-t pt-6 text-sm">
        {[
          ["/shipping", "Shipping"],
          ["/returns", "Returns & refunds"],
          ["/privacy", "Privacy"],
          ["/terms", "Terms"],
          ["/contact", "Contact us"],
        ].map(([href, label]) => (
          <Link key={href} href={href} className="text-muted-foreground underline-offset-4 hover:text-primary hover:underline">
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
