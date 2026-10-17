"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { CategoryNode } from "@/types/catalogue";

const PRIMARY_LINKS = [
  { href: "/shop?newArrival=true", label: "New arrivals" },
  { href: "/shop?gender=WOMEN", label: "Women" },
  { href: "/shop?gender=MEN", label: "Men" },
  { href: "/shop?collection=festive-wear", label: "Festive wear" },
  { href: "/shop", label: "Shop all" },
];

export function MobileNav({ categories }: { categories: CategoryNode[] }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu" />}>
        <Menu aria-hidden />
      </SheetTrigger>
      <SheetContent side="left" className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-serif text-xl tracking-[0.25em] text-primary">PAYANTRA</SheetTitle>
        </SheetHeader>
        <nav aria-label="Mobile" className="px-4 pb-8">
          <ul className="space-y-1">
            {PRIMARY_LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} onClick={close} className="block rounded px-2 py-2.5 text-base font-medium hover:bg-muted">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          {categories.length > 0 && (
            <>
              <p className="mb-2 mt-6 px-2 text-[11px] uppercase tracking-widest text-muted-foreground">Categories</p>
              <ul className="space-y-0.5">
                {categories.map((c) => (
                  <li key={c.id}>
                    <Link href={`/category/${c.slug}`} onClick={close} className="block rounded px-2 py-2 text-sm hover:bg-muted">
                      {c.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
