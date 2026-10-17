import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ApplyForm } from "@/components/delivery/apply-form";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { requireSession } from "@/lib/server-session";
import type { PartnerMe } from "@/types/delivery";

export const metadata: Metadata = { title: "Apply to deliver" };

async function Body() {
  const { token } = await requireSession("/delivery/apply");
  const { data: me } = await api<PartnerMe>("/delivery/me", { token, cache: "no-store" });
  // Already applied (and waiting), approved or suspended: the dashboard explains where things stand.
  if (me.partner && me.partner.status !== "REJECTED") redirect("/delivery");
  if (me.profile.role === "ADMIN") redirect("/admin");
  return <ApplyForm me={me} />;
}

export default function ApplyPage() {
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Link href="/delivery" className="text-sm text-muted-foreground hover:text-primary">
        ← Back
      </Link>
      <div>
        <h1 className="text-4xl font-semibold text-primary">Apply to deliver</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Tell us a little about yourself. An administrator reviews every application; you can start once it is approved.
        </p>
      </div>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Body />
      </Suspense>
    </div>
  );
}
