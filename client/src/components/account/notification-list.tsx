"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { notifyNotificationsChanged } from "@/lib/cart-events";
import { Button } from "@/components/ui/button";
import { authedApi } from "@/lib/client-api";
import { cn } from "@/lib/utils";

export interface NotificationRow {
  id: string;
  title: string;
  body: string;
  linkUrl: string | null;
  isRead: boolean;
  createdAt: string;
}

/** Order updates, replies and delivery news. Opening one marks it read. */
export function NotificationList({ items, unread }: { items: NotificationRow[]; unread: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function markAll() {
    setBusy(true);
    try {
      await authedApi("/notifications/read-all", { method: "POST" });
      notifyNotificationsChanged();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  async function markOne(id: string) {
    try {
      await authedApi(`/notifications/${id}/read`, { method: "PATCH" });
      notifyNotificationsChanged();
    } catch {
      /* the link still works; the badge will catch up */
    }
  }

  if (items.length === 0) {
    return <p className="rounded-xl border border-dashed bg-card p-10 text-center text-muted-foreground">No notifications yet. Order updates will appear here.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" data-testid="unread-count">
          {unread > 0 ? `${unread} unread` : "You're all caught up"}
        </p>
        {unread > 0 && (
          <Button variant="outline" size="sm" disabled={busy} onClick={markAll}>
            Mark all as read
          </Button>
        )}
      </div>
      <ul className="divide-y rounded-xl border bg-card" data-testid="notifications">
        {items.map((n) => {
          const inner = (
            <>
              <span className="flex items-start gap-3">
                <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.isRead ? "bg-transparent" : "bg-primary")} />
                <span className="min-w-0">
                  <span className={cn("block text-sm", n.isRead ? "font-normal" : "font-semibold")}>
                    {n.title}
                    {!n.isRead && <span className="sr-only"> (unread)</span>}
                  </span>
                  {n.body && <span className="mt-0.5 block text-sm text-muted-foreground">{n.body}</span>}
                </span>
              </span>
              <time dateTime={n.createdAt} className="shrink-0 text-xs text-muted-foreground">
                {new Date(n.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })}
              </time>
            </>
          );
          const cls = "flex items-start justify-between gap-4 px-4 py-3 hover:bg-muted/50";
          return (
            <li key={n.id} data-testid="notification">
              {n.linkUrl ? (
                <Link href={n.linkUrl} className={cls} onClick={() => !n.isRead && void markOne(n.id)}>
                  {inner}
                </Link>
              ) : (
                <div className={cls}>{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
