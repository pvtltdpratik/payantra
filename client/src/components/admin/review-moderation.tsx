"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { describeError } from "@/components/admin/api-error-message";
import { StatusBadge } from "@/components/admin/status-badge";
import { Stars } from "@/components/reviews/stars";
import { Button } from "@/components/ui/button";
import { authedApi } from "@/lib/client-api";

export interface ModerationRow {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  isVisible: boolean;
  createdAt: string;
  productName: string;
  productSlug: string;
  user: { id: string; email: string; fullName: string | null };
}

function Row({ r }: { r: ModerationRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      await authedApi(`/admin/reviews/${r.id}`, { method: "PATCH", body: { isVisible: !r.isVisible } });
      router.refresh();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="space-y-2 rounded-xl border bg-card p-4" data-testid="moderation-row">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/product/${r.productSlug}`} className="font-medium hover:text-primary">
            {r.productName}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Stars value={r.rating} />
            <StatusBadge status={r.isVisible ? "ACTIVE" : "ARCHIVED"} label={r.isVisible ? "Visible" : "Hidden"} />
          </div>
        </div>
        <Button size="sm" variant={r.isVisible ? "outline" : "default"} disabled={busy} onClick={toggle}>
          {r.isVisible ? "Hide" : "Show again"}
        </Button>
      </div>
      {r.title && <p className="font-semibold">{r.title}</p>}
      {r.body && <p className="whitespace-pre-line text-sm text-muted-foreground">{r.body}</p>}
      <p className="text-xs text-muted-foreground">
        <Link href={`/admin/customers/${r.user.id}`} className="text-primary hover:underline">
          {r.user.fullName ?? r.user.email}
        </Link>{" "}
        · {new Date(r.createdAt).toLocaleDateString("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" })}
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </li>
  );
}

export function ReviewModeration({ rows }: { rows: ModerationRow[] }) {
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <Row key={r.id} r={r} />
      ))}
    </ul>
  );
}
