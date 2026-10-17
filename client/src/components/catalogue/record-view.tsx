"use client";

import { useEffect } from "react";
import { authedApi } from "@/lib/client-api";
import { createClient } from "@/lib/supabase/client";

/** Quietly records that a signed-in shopper looked at this product (for their "recently viewed"). Renders nothing. */
export function RecordView({ productId }: { productId: string }) {
  useEffect(() => {
    void (async () => {
      try {
        const { data } = await createClient().auth.getSession();
        if (data.session) await authedApi(`/recently-viewed/${productId}`, { method: "POST" });
      } catch {
        /* a browsing trail is a convenience; never bother the shopper about it */
      }
    })();
  }, [productId]);
  return null;
}
