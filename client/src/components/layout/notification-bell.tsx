"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { onNotificationsChanged } from "@/lib/cart-events";
import { authedApi } from "@/lib/client-api";
import { createClient } from "@/lib/supabase/client";

/** A bell with the number of unread notifications. Signed-out visitors see nothing at all. */
export function NotificationBell() {
  const [unread, setUnread] = useState<number | null>(null); // null = signed out / unknown

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const { data } = await createClient().auth.getSession();
        if (!data.session) return !cancelled && setUnread(null);
        const res = await authedApi<unknown[]>("/notifications", { query: { pageSize: 1 } });
        if (!cancelled) setUnread(Number((res.meta as { unread?: number } | undefined)?.unread ?? 0));
      } catch {
        /* decoration only: never surface an error for a badge */
      }
    }
    void refresh();
    const off = onNotificationsChanged(() => void refresh());
    // New order and delivery updates arrive while the tab is open; check now and then, but only while it is visible.
    const timer = window.setInterval(() => document.visibilityState === "visible" && void refresh(), 60_000);
    const auth = createClient().auth.onAuthStateChange(() => void refresh());
    return () => {
      cancelled = true;
      off();
      window.clearInterval(timer);
      auth.data.subscription.unsubscribe();
    };
  }, []);

  if (unread === null) return null;
  return (
    <Link
      href="/account/notifications"
      className="relative inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-muted"
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
    >
      <Bell aria-hidden className="size-5" />
      {unread > 0 && (
        <span aria-hidden data-testid="unread-badge" className="absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] font-semibold leading-5 text-primary-foreground">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
