import { Suspense } from "react";
import { AccountNav } from "@/components/account/account-nav";

export default function AccountLayout({ children }: LayoutProps<"/account">) {
  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-12">
      {/* usePathname() is request-time data, so the nav streams in behind a boundary (static shell stays instant). */}
      <Suspense fallback={<div aria-hidden className="h-10 md:h-40" />}>
        <AccountNav />
      </Suspense>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
