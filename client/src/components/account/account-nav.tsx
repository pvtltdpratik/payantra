"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Heart, MapPin, Package, User } from "lucide-react";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/account", label: "Profile", Icon: User, exact: true },
  { href: "/account/orders", label: "Orders", Icon: Package, exact: false },
  { href: "/account/addresses", label: "Addresses", Icon: MapPin, exact: false },
  { href: "/wishlist", label: "Wishlist", Icon: Heart, exact: false },
];

export function AccountNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Account" className="flex gap-1 overflow-x-auto md:flex-col print:hidden">
      {LINKS.map(({ href, label, Icon, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-muted",
              active && "bg-primary text-primary-foreground hover:bg-primary",
            )}
          >
            <Icon aria-hidden className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
