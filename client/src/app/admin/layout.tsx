import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft, BarChart3, Boxes, FolderTree, History, LayoutDashboard, LifeBuoy, Mail, Megaphone, MessageSquareText, Package, ReceiptText, RotateCcw, Settings, TicketPercent, Truck, UserRound, Users } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { requireAdmin } from "@/lib/server-session";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · Payantra Admin" }, robots: { index: false } };

const NAV = [
  { href: "/admin", label: "Overview", Icon: LayoutDashboard },
  { href: "/admin/orders", label: "Orders", Icon: ReceiptText },
  { href: "/admin/returns", label: "Returns", Icon: RotateCcw },
  { href: "/admin/delivery-partners", label: "Delivery partners", Icon: Truck },
  { href: "/admin/products", label: "Products", Icon: Package },
  { href: "/admin/inventory", label: "Inventory", Icon: Boxes },
  { href: "/admin/categories", label: "Categories", Icon: FolderTree },
  { href: "/admin/customers", label: "Customers", Icon: UserRound },
  { href: "/admin/support", label: "Support", Icon: LifeBuoy },
  { href: "/admin/reviews", label: "Reviews", Icon: MessageSquareText },
  { href: "/admin/analytics", label: "Reports", Icon: BarChart3 },
  { href: "/admin/coupons", label: "Coupons", Icon: TicketPercent },
  { href: "/admin/banners", label: "Banners", Icon: Megaphone },
  { href: "/admin/newsletter", label: "Newsletter", Icon: Mail },
  { href: "/admin/users", label: "Users & roles", Icon: Users },
  { href: "/admin/audit", label: "Audit log", Icon: History },
  { href: "/admin/settings", label: "Settings", Icon: Settings },
];

/** Only reached by ADMINs: anyone else is redirected before any admin UI is rendered. */
async function AdminFrame({ children }: { children: React.ReactNode }) {
  const { me } = await requireAdmin("/admin");
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b bg-sidebar md:w-60 md:shrink-0 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between gap-4 px-4 py-4 md:block">
          <Link href="/admin" className="font-serif text-xl font-semibold tracking-[0.28em] text-primary">
            PAYANTRA
          </Link>
          <p className="text-xs uppercase tracking-widest text-muted-foreground md:mt-1">Admin</p>
        </div>
        <nav aria-label="Admin" className="flex gap-1 overflow-x-auto px-2 pb-3 md:flex-col md:pb-0">
          {NAV.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-sidebar-accent"
            >
              <Icon aria-hidden className="size-4" />
              {label}
            </Link>
          ))}
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent md:mt-6"
          >
            <ArrowLeft aria-hidden className="size-4" />
            Back to store
          </Link>
        </nav>
        <p className="hidden truncate px-4 py-4 text-xs text-muted-foreground md:block">{me.email}</p>
      </aside>
      <main className="min-w-0 flex-1 bg-background p-4 sm:p-8">{children}</main>
    </div>
  );
}

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <Suspense fallback={<Skeleton className="m-8 h-96" />}>
      <AdminFrame>{children}</AdminFrame>
    </Suspense>
  );
}
