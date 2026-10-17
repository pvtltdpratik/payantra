"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { describeError } from "@/components/admin/api-error-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { authedApi } from "@/lib/client-api";
import { cn } from "@/lib/utils";

const WORDS = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];

/**
 * Write or edit a review. The star picker is a radio group, so it works with a keyboard and a screen reader
 * (arrow keys move between stars) rather than being a row of click targets.
 */
export function ReviewForm({
  productId,
  orderId,
  initial,
  onDone,
  idPrefix = "review",
}: {
  productId: string;
  orderId: string;
  initial?: { id: string; rating: number; title: string | null; body: string | null };
  onDone: () => void;
  idPrefix?: string;
}) {
  const [rating, setRating] = useState(initial?.rating ?? 0);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (rating < 1) return setError("Choose a star rating first.");
    setBusy(true);
    setError(null);
    try {
      if (initial) {
        await authedApi(`/reviews/${initial.id}`, { method: "PATCH", body: { rating, title: title.trim() || null, body: body.trim() || null } });
      } else {
        await authedApi("/reviews", { method: "POST", body: { productId, orderId, rating, title: title.trim() || null, body: body.trim() || null } });
      }
      onDone();
    } catch (err) {
      setError(describeError(err, "We couldn't save your review. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" aria-label={initial ? "Edit your review" : "Write a review"}>
      {error && (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Your rating</legend>
        <div role="radiogroup" aria-label="Your rating" className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="cursor-pointer rounded p-0.5 has-[:focus-visible]:outline-2">
              <input type="radio" name={`${idPrefix}-rating`} value={n} checked={rating === n} onChange={() => setRating(n)} className="sr-only" aria-label={`${n} star${n === 1 ? "" : "s"}`} />
              <Star aria-hidden className={cn("size-8 transition-colors", n <= rating ? "fill-gold text-gold" : "text-muted-foreground/40 hover:text-gold")} />
            </label>
          ))}
          <span className="ml-2 text-sm text-muted-foreground" aria-live="polite">
            {WORDS[rating]}
          </span>
        </div>
      </fieldset>
      <div className="space-y-1.5">
        <label htmlFor={`${idPrefix}-title`} className="text-sm font-medium">
          Headline (optional)
        </label>
        <Input id={`${idPrefix}-title`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} className="h-11" />
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${idPrefix}-body`} className="text-sm font-medium">
          Your review (optional)
        </label>
        <Textarea id={`${idPrefix}-body`} value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={2000} placeholder="How does it fit, feel and look? Would you buy it again?" />
      </div>
      <Button type="submit" className="h-11 px-6" disabled={busy || rating < 1}>
        {busy ? "Saving…" : initial ? "Save changes" : "Submit review"}
      </Button>
    </form>
  );
}
