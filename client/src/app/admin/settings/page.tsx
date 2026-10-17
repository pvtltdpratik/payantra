import type { Metadata } from "next";
import { Suspense } from "react";
import { SettingsForms } from "@/components/admin/settings-form";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { requireAdmin } from "@/lib/server-session";
import type { AppSettings } from "@/types/admin";

export const metadata: Metadata = { title: "Settings" };

async function Body() {
  const { token } = await requireAdmin("/admin/settings");
  const { data } = await api<AppSettings>("/admin/settings", { token, cache: "no-store" });
  return <SettingsForms settings={data} />;
}

export default function AdminSettingsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-4xl font-semibold text-primary">Settings</h1>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Body />
      </Suspense>
    </div>
  );
}
