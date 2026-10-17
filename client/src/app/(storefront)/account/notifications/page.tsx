import type { Metadata } from "next";
import { Suspense } from "react";
import { NotificationList, type NotificationRow } from "@/components/account/notification-list";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { requireSession } from "@/lib/server-session";

export const metadata: Metadata = { title: "Notifications", robots: { index: false } };

async function Body() {
  const { token } = await requireSession("/account/notifications");
  const { data, meta } = await api<NotificationRow[]>("/notifications", { token, cache: "no-store", query: { pageSize: 40 } });
  return <NotificationList items={data} unread={Number((meta as { unread?: number } | undefined)?.unread ?? 0)} />;
}

export default function AccountNotificationsPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-4xl font-semibold text-primary">Notifications</h1>
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Body />
      </Suspense>
    </div>
  );
}
