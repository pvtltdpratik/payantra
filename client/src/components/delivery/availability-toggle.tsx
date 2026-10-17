"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { describeError } from "@/components/admin/api-error-message";
import { authedApi } from "@/lib/client-api";
import { cn } from "@/lib/utils";

/** Online/offline switch. Offline partners are not offered new deliveries. */
export function AvailabilityToggle({ initial }: { initial: boolean }) {
  const router = useRouter();
  const [online, setOnline] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !online;
    setBusy(true);
    setError(null);
    try {
      await authedApi("/delivery/availability", { method: "PUT", body: { isOnline: next } });
      setOnline(next);
      router.refresh();
    } catch (err) {
      setError(describeError(err, "We couldn't change your availability."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={online}
        aria-label="Available for deliveries"
        disabled={busy}
        onClick={toggle}
        className={cn(
          "inline-flex h-11 items-center gap-3 rounded-full border px-4 text-sm font-medium transition-colors disabled:opacity-60",
          online ? "border-success/40 bg-success/10 text-success" : "border-border bg-card text-muted-foreground",
        )}
      >
        <span aria-hidden className={cn("size-2.5 rounded-full", online ? "bg-success" : "bg-muted-foreground/50")} />
        {online ? "Online" : "Offline"}
      </button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
