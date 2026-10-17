"use client";

import Link from "next/link";
import Script from "next/script";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CreditCard, FileText, RotateCcw } from "lucide-react";
import { describeError } from "@/components/admin/api-error-message";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { notifyCartChanged } from "@/lib/cart-events";
import { authedApi } from "@/lib/client-api";
import { openRazorpayCheckout, RAZORPAY_SCRIPT } from "@/lib/razorpay";
import type { OrderView, RazorpayCheckoutParams } from "@/types/commerce";

const REASONS = ["Changed my mind", "Ordered by mistake", "Found a better price", "Delivery will take too long", "Other"];

export function OrderActions({ order }: { order: OrderView }) {
  const router = useRouter();
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [scriptReady, setScriptReady] = useState(typeof window !== "undefined" && !!window.Razorpay);

  // Cancel dialog
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState(REASONS[0]);
  const [other, setOther] = useState("");
  // Return dialog
  const [returnOpen, setReturnOpen] = useState(false);
  const [rType, setRType] = useState<"RETURN" | "REPLACEMENT">("RETURN");
  const [rReason, setRReason] = useState("");
  const [rDetails, setRDetails] = useState("");

  const a = order.actions;
  const refresh = () => router.refresh();

  async function payNow() {
    setBusy("pay");
    setMessage(null);
    try {
      const { data } = await authedApi<{ status: "PAID" | "PENDING"; payment: RazorpayCheckoutParams | null }>(`/payments/${order.id}/retry`, { method: "POST" });
      if (data.status === "PAID" || !data.payment) return refresh();
      const opened = openRazorpayCheckout(data.payment, {
        onPaid: async (r) => {
          try {
            await authedApi("/payments/verify", { method: "POST", body: r });
          } catch (err) {
            setMessage({ kind: "error", text: describeError(err, "We couldn't confirm your payment yet. If money was deducted, this order will update automatically.") });
          }
          refresh();
        },
        onDismiss: () => setMessage({ kind: "error", text: "You closed the payment window before paying." }),
        onFailed: (text) => setMessage({ kind: "error", text }),
      });
      if (!opened) setMessage({ kind: "error", text: "The payment window could not be loaded. Check your connection and try again." });
    } catch (err) {
      setMessage({ kind: "error", text: describeError(err, "We couldn't restart the payment.") });
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    const text = reason === "Other" ? other.trim() : reason;
    if (text.length < 3) return setMessage({ kind: "error", text: "Please tell us why you're cancelling." });
    setBusy("cancel");
    try {
      await authedApi(`/orders/${order.id}/cancel`, { method: "POST", body: { reason: text } });
      setCancelOpen(false);
      setMessage({ kind: "ok", text: order.paymentStatus === "CAPTURED" ? "Order cancelled. Your refund has been started." : "Order cancelled." });
      refresh();
    } catch (err) {
      setCancelOpen(false);
      setMessage({ kind: "error", text: describeError(err, "We couldn't cancel this order.") });
    } finally {
      setBusy(null);
    }
  }

  async function requestReturn() {
    if (rReason.trim().length < 3) return setMessage({ kind: "error", text: "Please tell us what's wrong." });
    setBusy("return");
    try {
      await authedApi(`/orders/${order.id}/returns`, { method: "POST", body: { type: rType, reason: rReason.trim(), details: rDetails.trim() || null } });
      setReturnOpen(false);
      setMessage({ kind: "ok", text: "Request received. We'll review it and get back to you." });
      refresh();
    } catch (err) {
      setReturnOpen(false);
      setMessage({ kind: "error", text: describeError(err, "We couldn't submit your request.") });
    } finally {
      setBusy(null);
    }
  }

  async function reorder() {
    setBusy("reorder");
    try {
      const { data } = await authedApi<{ added: string[]; skipped: { name: string; reason: string }[] }>(`/orders/${order.id}/reorder`, { method: "POST" });
      notifyCartChanged();
      setMessage({
        kind: data.added.length ? "ok" : "error",
        text: data.added.length
          ? `Added ${data.added.length} item${data.added.length === 1 ? "" : "s"} to your bag.${data.skipped.length ? ` Skipped: ${data.skipped.map((s) => `${s.name} (${s.reason.toLowerCase()})`).join("; ")}.` : ""}`
          : `Nothing could be added: ${data.skipped.map((s) => `${s.name} — ${s.reason.toLowerCase()}`).join("; ")}.`,
      });
      if (data.added.length) router.push("/cart");
    } catch (err) {
      setMessage({ kind: "error", text: describeError(err) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {a.canRetryPayment && <Script src={RAZORPAY_SCRIPT} strategy="afterInteractive" onLoad={() => setScriptReady(true)} />}

      {message && (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={
            message.kind === "error"
              ? "rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              : "rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-success"
          }
        >
          {message.text}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {a.canRetryPayment && (
          <Button className="h-11 px-6" disabled={busy === "pay" || !scriptReady} onClick={payNow}>
            <CreditCard aria-hidden /> {busy === "pay" ? "Opening…" : "Complete payment"}
          </Button>
        )}

        {a.canViewInvoice && (
          <Button variant="outline" className="h-11" nativeButton={false} render={<Link href={`/account/orders/${order.id}/invoice`} />}>
            <FileText aria-hidden /> Invoice
          </Button>
        )}

        <Button variant="outline" className="h-11" disabled={busy === "reorder"} onClick={reorder}>
          <RotateCcw aria-hidden /> Buy again
        </Button>

        {a.canReturn && (
          <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
            <DialogTrigger render={<Button variant="outline" className="h-11" />}>Return or replace</DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Return or replace</DialogTitle>
                <DialogDescription>You can request this until {a.returnWindowEndsAt && new Date(a.returnWindowEndsAt).toLocaleDateString("en-IN", { dateStyle: "long" })}.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <fieldset className="flex gap-4 text-sm">
                  <legend className="sr-only">Request type</legend>
                  {(["RETURN", "REPLACEMENT"] as const).map((t) => (
                    <label key={t} className="flex items-center gap-2">
                      <input type="radio" checked={rType === t} onChange={() => setRType(t)} className="accent-[var(--primary)]" />
                      {t === "RETURN" ? "Return for a refund" : "Replace the item"}
                    </label>
                  ))}
                </fieldset>
                <label className="block space-y-1.5 text-sm font-medium">
                  What went wrong?
                  <Input value={rReason} onChange={(e) => setRReason(e.target.value)} placeholder="e.g. Wrong size, damaged, not as shown" className="h-10 font-normal" />
                </label>
                <label className="block space-y-1.5 text-sm font-medium">
                  More details (optional)
                  <Textarea value={rDetails} onChange={(e) => setRDetails(e.target.value)} rows={3} className="font-normal" />
                </label>
                <Button className="h-10 w-full" disabled={busy === "return"} onClick={requestReturn}>
                  {busy === "return" ? "Sending…" : "Submit request"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}

        {a.canCancel && (
          <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
            <DialogTrigger render={<Button variant="ghost" className="h-11 text-destructive hover:text-destructive" />}>Cancel order</DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Cancel this order?</DialogTitle>
                <DialogDescription>
                  {order.paymentStatus === "CAPTURED"
                    ? "You'll get a full refund to your original payment method."
                    : "Nothing has been charged, and your reserved items will be released."}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <label className="block space-y-1.5 text-sm font-medium">
                  Reason
                  <select value={reason} onChange={(e) => setReason(e.target.value)} className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm font-normal">
                    {REASONS.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </label>
                {reason === "Other" && <Input value={other} onChange={(e) => setOther(e.target.value)} placeholder="Tell us more" className="h-10" aria-label="Other reason" />}
                <Button variant="destructive" className="h-10 w-full" disabled={busy === "cancel"} onClick={cancel}>
                  {busy === "cancel" ? "Cancelling…" : "Yes, cancel order"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </div>
  );
}
