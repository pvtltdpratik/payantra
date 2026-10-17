"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { describeError } from "@/components/admin/api-error-message";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { authedApi } from "@/lib/client-api";
import type { SupportRequestRow } from "@/types/analytics";
import { SupportStatusBadge } from "./support-status-badge";

export interface OrderOption {
  id: string;
  orderNumber: string;
}

/** Contact form plus the customer's own conversation history. */
export function SupportCenter({ requests, orders }: { requests: SupportRequestRow[]; orders: OrderOption[] }) {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [orderId, setOrderId] = useState("");
  const [errors, setErrors] = useState<{ subject?: string; message?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSent(false);
    setFormError(null);
    const next: typeof errors = {};
    if (subject.trim().length < 3) next.subject = "Add a short subject (at least 3 characters).";
    if (message.trim().length < 10) next.message = "Tell us a little more (at least 10 characters).";
    setErrors(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    try {
      await authedApi("/support", { method: "POST", body: { subject: subject.trim(), message: message.trim(), orderId: orderId || null } });
      setSubject("");
      setMessage("");
      setOrderId("");
      setSent(true);
      router.refresh();
    } catch (err) {
      setFormError(describeError(err, "We couldn't send your message. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-10">
      <form onSubmit={submit} noValidate className="space-y-4 rounded-xl border bg-card p-5" aria-label="Contact us">
        <h2 className="text-2xl font-semibold">Contact us</h2>
        <p className="text-sm text-muted-foreground">Questions about an order, a return, sizing or anything else. We reply here and send you a notification.</p>
        {sent && (
          <p role="status" className="rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-success" data-testid="support-sent">
            Thanks — we&apos;ve received your message and will reply here.
          </p>
        )}
        {formError && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {formError}
          </p>
        )}
        <Field id="support-subject" label="Subject" error={errors.subject}>
          <Input id="support-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} className="h-11" aria-invalid={!!errors.subject} />
        </Field>
        {orders.length > 0 && (
          <Field id="support-order" label="About an order? (optional)">
            <select id="support-order" value={orderId} onChange={(e) => setOrderId(e.target.value)} className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm sm:max-w-xs">
              <option value="">Not about a specific order</option>
              {orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.orderNumber}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field id="support-message" label="Message" error={errors.message}>
          <Textarea id="support-message" value={message} onChange={(e) => setMessage(e.target.value)} rows={5} maxLength={2000} aria-invalid={!!errors.message} />
        </Field>
        <Button type="submit" className="h-11 px-6" disabled={busy}>
          {busy ? "Sending…" : "Send message"}
        </Button>
      </form>

      <section aria-labelledby="mine-h" className="space-y-3">
        <h2 id="mine-h" className="text-2xl font-semibold">
          Your conversations
        </h2>
        {requests.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">You haven&apos;t contacted us yet.</p>
        ) : (
          <ul className="space-y-3">
            {requests.map((r) => (
              <li key={r.id} className="space-y-2 rounded-xl border bg-card p-4" data-testid="my-request">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{r.subject}</p>
                  <SupportStatusBadge status={r.status} />
                </div>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{r.message}</p>
                {r.reply ? (
                  <p className="whitespace-pre-wrap rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm" data-testid="support-reply">
                    <strong>Payantra:</strong> {r.reply}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">Sent {new Date(r.createdAt).toLocaleDateString("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" })} · we&apos;ll reply soon.</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
