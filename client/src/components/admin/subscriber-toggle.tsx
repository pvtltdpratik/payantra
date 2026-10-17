"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authedApi } from "@/lib/client-api";

export function SubscriberToggle({ id, subscribed }: { id: string; subscribed: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await authedApi(`/admin/newsletter/${id}`, { method: "PATCH", body: { subscribed: !subscribed } });
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      {subscribed ? "Unsubscribe" : "Resubscribe"}
    </Button>
  );
}
