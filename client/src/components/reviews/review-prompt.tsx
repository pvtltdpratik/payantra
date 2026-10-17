"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { authedApi } from "@/lib/client-api";
import { createClient } from "@/lib/supabase/client";
import type { MyReviews, ToReview } from "@/types/reviews";
import { ReviewForm } from "./review-form";

/**
 * Shown under a product's reviews ONLY to a signed-in customer who has received it and not reviewed it yet.
 * Everyone else sees nothing: the server decides eligibility again when the review is submitted.
 */
export function ReviewPrompt({ productId }: { productId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<ToReview | null>(null);
  const [thanks, setThanks] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: s } = await createClient().auth.getSession();
        if (!s.session) return;
        const { data } = await authedApi<MyReviews>("/reviews/mine");
        if (!cancelled) setPending(data.toReview.find((t) => t.productId === productId) ?? null);
      } catch {
        /* an optional extra: never surface an error */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [productId]);

  if (thanks) {
    return (
      <p role="status" className="mt-8 rounded-md border border-success/30 bg-success/5 px-4 py-3 text-sm text-success" data-testid="review-thanks">
        Thank you — your review is live.
      </p>
    );
  }
  if (!pending) return null;

  return (
    <div className="mt-10 max-w-xl rounded-xl border bg-card p-6" data-testid="review-prompt">
      <h3 className="text-2xl font-semibold">Review your purchase</h3>
      <p className="mb-4 mt-1 text-sm text-muted-foreground">From order {pending.orderNumber}. Reviews are tied to your delivered order, so others can trust them.</p>
      <ReviewForm
        productId={productId}
        orderId={pending.orderId}
        idPrefix="pdp"
        onDone={() => {
          setThanks(true);
          setPending(null);
          router.refresh();
        }}
      />
    </div>
  );
}
