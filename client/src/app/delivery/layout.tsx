import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { History, Home, Store } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { requireSession } from "@/lib/server-session";

export const metadata: Metadata = { title: { default: "Delivery", template: "%s · Payantra Delivery" }, robots: { index: false } };

const NAV = [
  { href: "/delivery", label: "Today", Icon: Home },
  { href: "/delivery/history", label: "History", Icon: History },
  { href: "/", label: "Store", Icon: Store },
];

/** Mobile-first frame: a riders' tool is used one-handed, outdoors. Pages decide what each role may see. */
async function DeliveryFrame({ children }: { children: React.ReactNode }) {
  const { me } = await requireSession("/delivery");
  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col">
      <header className="sticky top-0 z-20 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <Link href="/delivery" className="font-serif text-lg font-semibold tracking-[0.25em] text-primary">
            PAYANTRA
          </Link>
          <p className="truncate text-xs text-muted-foreground">{me.fullName ?? me.email}</p>
        </div>
        <nav aria-label="Delivery" className="-mx-1 mt-2 flex gap-1 overflow-x-auto">
          {NAV.map(({ href, label, Icon }) => (
            <Link key={href} href={href} className="flex h-10 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium hover:bg-muted">
              <Icon aria-hidden className="size-4" />
              {label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="flex-1 px-4 py-6">{children}</main>
    </div>
  );
}

export default function DeliveryLayout({ children }: LayoutProps<"/delivery">) {
  return (
    <Suspense fallback={<Skeleton className="m-4 h-96" />}>
      <DeliveryFrame>{children}</DeliveryFrame>
    </Suspense>
  );
}
