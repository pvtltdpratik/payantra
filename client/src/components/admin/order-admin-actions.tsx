"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { describeError } from "@/components/admin/api-error-message";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { authedApi } from "@/lib/client-api";
import { paiseToRupees, rupeesToPaise } from "@/lib/money";
import { formatINR } from "@/lib/utils";
import type { AdminOrderView } from "@/types/admin";
import { STATUS_LABEL } from "@/types/commerce";

export function OrderAdminActions({ order }: { order: AdminOrderView }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  // Cancel
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  // Refund
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refundKey, setRefundKey] = useState(() => crypto.randomUUID().replace(/-/g, ""));

  const pay = order.payment;
  const refundable = pay && (pay.status === "CAPTURED" || pay.status === "PARTIALLY_REFUNDED") ? pay.amount - pay.refundedAmount : 0;
  const pendingRefunds = order.refunds.filter((r) => r.status === "PENDING");
  const canCancel = order.fulfilmentStatus !== "CANCELLED" && order.actions.canCancel;
  // With a partner on the job, the hand-over steps belong to the partner (the server enforces this too).
  const withPartner = !!order.assignment && !["REJECTED", "RETURNED_TO_ORIGIN"].includes(order.assignment.status);
  const manualNext = order.nextStatuses.filter((s) => !(withPartner && ["SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED"].includes(s)));

  async function run(key: string, call: () => Promise<unknown>, ok: string) {
    setBusy(key);
    setMessage(null);
    try {
      await call();
      setMessage({ kind: "ok", text: ok });
      router.refresh();
      return true;
    } catch (err) {
      setMessage({ kind: "error", text: describeError(err) });
      return false;
    } finally {
      setBusy(null);
    }
  }

  const amountPaise = refundAmount.trim() === "" ? undefined : rupeesToPaise(refundAmount);
  const refundValid = refundReason.trim().length >= 3 && (refundAmount.trim() === "" || (amountPaise !== null && amountPaise !== undefined && amountPaise >= 1 && amountPaise <= refundable));

  return (
    <section aria-labelledby="actions-h" className="space-y-4 rounded-xl border bg-card p-5">
      <h2 id="actions-h" className="text-2xl font-semibold">
        Actions
      </h2>

      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" : "rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-success"}>
          {message.text}
        </p>
      )}

      {manualNext.length > 0 ? (
        <div className="space-y-2">
          <label className="block text-sm font-medium" htmlFor="status-note">
            Note to the customer (optional)
          </label>
          <Input id="status-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Courier: BlueDart AWB 123456" className="h-10" />
          <div className="flex flex-wrap gap-2 pt-1">
            {manualNext.map((s) => (
              <Button
                key={s}
                disabled={busy !== null}
                onClick={() =>
                  run(`status-${s}`, () => authedApi(`/admin/orders/${order.id}/status`, { method: "PATCH", body: { status: s, ...(note.trim() ? { note: note.trim() } : {}) } }), `Marked as ${STATUS_LABEL[s].toLowerCase()}.`).then((ok) => ok && setNote(""))
                }
              >
                {busy === `status-${s}` ? "Saving…" : `Mark as ${STATUS_LABEL[s].toLowerCase()}`}
              </Button>
            ))}
          </div>
        </div>
      ) : withPartner && order.nextStatuses.length > 0 ? (
        <p className="text-sm text-muted-foreground">The delivery partner updates the shipping steps. Use the Delivery panel to reassign or unassign.</p>
      ) : (
        <p className="text-sm text-muted-foreground">No further fulfilment steps from {STATUS_LABEL[order.fulfilmentStatus].toLowerCase()}.</p>
      )}

      <div className="flex flex-wrap gap-2 border-t pt-4">
        {refundable > 0 && (
          <Dialog open={refundOpen} onOpenChange={(o) => { setRefundOpen(o); if (o) setRefundKey(crypto.randomUUID().replace(/-/g, "")); }}>
            <DialogTrigger render={<Button variant="outline" />}>Refund…</DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Refund payment</DialogTitle>
                <DialogDescription>Up to {formatINR(refundable)} can still be refunded to the customer&apos;s original payment method.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <label className="block space-y-1.5 text-sm font-medium">
                  Amount (₹) — leave empty for the full {paiseToRupees(refundable)}
                  <Input value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} inputMode="decimal" className="h-10 font-normal" />
                </label>
                <label className="block space-y-1.5 text-sm font-medium">
                  Reason
                  <Input value={refundReason} onChange={(e) => setRefundReason(e.target.value)} className="h-10 font-normal" />
                </label>
                <Button
                  className="h-10 w-full"
                  disabled={!refundValid || busy === "refund"}
                  onClick={async () => {
                    const ok = await run("refund", () => authedApi(`/admin/orders/${order.id}/refund`, { method: "POST", body: { ...(amountPaise ? { amount: amountPaise } : {}), reason: refundReason.trim(), idempotencyKey: refundKey } }), "Refund sent.");
                    setRefundOpen(false);
                    if (ok) { setRefundAmount(""); setRefundReason(""); }
                  }}
                >
                  {busy === "refund" ? "Refunding…" : `Refund ${amountPaise ? formatINR(amountPaise) : formatINR(refundable)}`}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}

        {canCancel && (
          <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
            <DialogTrigger render={<Button variant="outline" className="text-destructive" />}>Cancel order…</DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Cancel {order.orderNumber}?</DialogTitle>
                <DialogDescription>
                  Stock is returned to the shelf{order.paymentStatus === "CAPTURED" ? " and the customer is refunded in full" : ""}. This cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <label className="block space-y-1.5 text-sm font-medium">
                Reason (shown to the customer)
                <Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} className="h-10 font-normal" />
              </label>
              <Button
                variant="destructive"
                className="h-10 w-full"
                disabled={cancelReason.trim().length < 3 || busy === "cancel"}
                onClick={async () => {
                  await run("cancel", () => authedApi(`/admin/orders/${order.id}/cancel`, { method: "POST", body: { reason: cancelReason.trim() } }), "Order cancelled.");
                  setCancelOpen(false);
                }}
              >
                {busy === "cancel" ? "Cancelling…" : "Cancel order"}
              </Button>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {pendingRefunds.length > 0 && (
        <div className="space-y-2 border-t pt-4">
          <p className="text-sm font-medium">Refunds awaiting confirmation</p>
          {pendingRefunds.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <span>
                {formatINR(r.amount)} — {r.reason ?? "refund"}
              </span>
              <Button size="sm" variant="outline" disabled={busy === `retry-${r.id}`} onClick={() => run(`retry-${r.id}`, () => authedApi(`/admin/refunds/${r.id}/retry`, { method: "POST" }), "Refund confirmed.")}>
                Retry
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
