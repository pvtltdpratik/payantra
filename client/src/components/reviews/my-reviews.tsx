"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { describeError } from "@/components/admin/api-error-message";
import { Button } from "@/components/ui/button";
import { authedApi } from "@/lib/client-api";
import type { MyReview, MyReviews, ToReview } from "@/types/reviews";
import { ReviewForm } from "./review-form";
import { Stars } from "./stars";

function Pending({ item }: { item: ToReview }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-xl border bg-card p-4" data-testid="to-review">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {item.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.image} alt="" className="size-14 shrink-0 rounded-md object-cover" />
          ) : (
            <span className="size-14 shrink-0 rounded-md bg-muted" />
          )}
          <div className="min-w-0">
            <Link href={`/product/${item.slug}`} className="block truncate font-medium hover:text-primary">
              {item.name}
            </Link>
            <p className="text-xs text-muted-foreground">Delivered in order {item.orderNumber}</p>
          </div>
        </div>
        {!open && (
          <Button variant="outline" onClick={() => setOpen(true)}>
            Write a review
          </Button>
        )}
      </div>
      {open && (
        <div className="mt-4 border-t pt-4">
          <ReviewForm
            productId={item.productId}
            orderId={item.orderId}
            idPrefix={`new-${item.orderId.slice(0, 6)}-${item.productId.slice(0, 6)}`}
            onDone={() => {
              setOpen(false);
              router.refresh();
            }}
          />
        </div>
      )}
    </li>
  );
}

function Done({ review }: { review: MyReview }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!window.confirm("Delete this review? This cannot be undone.")) return;
    setBusy(true);
    setError(null);
    try {
      await authedApi(`/reviews/${review.id}`, { method: "DELETE" });
      router.refresh();
    } catch (err) {
      setError(describeError(err, "We couldn't delete that review."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-xl border bg-card p-4" data-testid="my-review">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {review.slug ? (
            <Link href={`/product/${review.slug}`} className="font-medium hover:text-primary">
              {review.name}
            </Link>
          ) : (
            <span className="font-medium">{review.name}</span>
          )}
          <div className="mt-1 flex items-center gap-2">
            <Stars value={review.rating} />
            {!review.isVisible && <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Hidden by our team</span>}
          </div>
        </div>
        {!editing && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={remove}>
              Delete
            </Button>
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {editing ? (
        <div className="mt-4 border-t pt-4">
          <ReviewForm
            productId={review.productId}
            orderId={review.orderId}
            initial={{ id: review.id, rating: review.rating, title: review.title, body: review.body }}
            idPrefix={`edit-${review.id.slice(0, 6)}`}
            onDone={() => {
              setEditing(false);
              router.refresh();
            }}
          />
        </div>
      ) : (
        <>
          {review.title && <p className="mt-2 font-semibold">{review.title}</p>}
          {review.body && <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{review.body}</p>}
        </>
      )}
    </li>
  );
}

export function MyReviewsView({ data }: { data: MyReviews }) {
  return (
    <div className="space-y-10">
      <section aria-labelledby="wait-h" className="space-y-3">
        <h2 id="wait-h" className="text-2xl font-semibold">
          Waiting for your review
        </h2>
        {data.toReview.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">Nothing to review right now. Items appear here once they are delivered.</p>
        ) : (
          <ul className="space-y-3">
            {data.toReview.map((t) => (
              <Pending key={`${t.orderId}-${t.productId}`} item={t} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="done-h" className="space-y-3">
        <h2 id="done-h" className="text-2xl font-semibold">
          Your reviews
        </h2>
        {data.reviewed.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">You haven&apos;t written any reviews yet.</p>
        ) : (
          <ul className="space-y-3">
            {data.reviewed.map((r) => (
              <Done key={r.id} review={r} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
