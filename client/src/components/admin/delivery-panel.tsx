"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { describeError } from "@/components/admin/api-error-message";
import { DeliveryBadge } from "@/components/delivery/delivery-badge";
import { Button } from "@/components/ui/button";
import { authedApi } from "@/lib/client-api";
import type { AdminOrderView } from "@/types/admin";
import { DELIVERY_LABEL, type AssignablePartner } from "@/types/delivery";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : null);

/** Hand the order to a delivery partner, take it back, or reissue a lost delivery code. */
export function DeliveryPanel({ order, partners }: { order: AdminOrderView; partners: AssignablePartner[] }) {
  const router = useRouter();
  const a = order.assignment;
  const [partnerId, setPartnerId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  // A packed order is ready for pickup; after a failed attempt the parcel is "shipped" and may go to someone else.
  const assignable = order.fulfilmentStatus === "PACKED" || (a?.status === "FAILED" && order.fulfilmentStatus === "SHIPPED");

  async function run(key: string, call: () => Promise<unknown>, ok: string) {
    setBusy(key);
    setMessage(null);
    try {
      await call();
      setMessage({ kind: "ok", text: ok });
      setPartnerId("");
      router.refresh();
    } catch (err) {
      setMessage({ kind: "error", text: describeError(err) });
    } finally {
      setBusy(null);
    }
  }

  const assign = () => run("assign", () => authedApi(`/admin/orders/${order.id}/assignment`, { method: "POST", body: { partnerId } }), a ? "Delivery reassigned." : "Delivery assigned.");

  const picker = (label: string) => (
    <div className="space-y-2">
      <label htmlFor="partner-select" className="block text-sm font-medium">
        {label}
      </label>
      <div className="flex flex-wrap gap-2">
        <select
          id="partner-select"
          value={partnerId}
          onChange={(e) => setPartnerId(e.target.value)}
          className="h-10 min-w-0 flex-1 rounded-md border border-input bg-card px-3 text-sm"
        >
          <option value="">Choose a delivery partner…</option>
          {partners.map((p) => (
            <option key={p.id} value={p.id} disabled={!p.isOnline}>
              {p.name ?? "Unnamed"} — {p.serviceCity ?? "—"} · {p.activeJobs} active{p.isOnline ? "" : " · offline"}
            </option>
          ))}
        </select>
        <Button className="h-10" disabled={!partnerId || busy !== null} onClick={assign}>
          {busy === "assign" ? "Assigning…" : a ? "Reassign" : "Assign"}
        </Button>
      </div>
      {partners.length === 0 && <p className="text-xs text-muted-foreground">No approved delivery partners yet. Approve an application under Delivery partners.</p>}
    </div>
  );

  return (
    <section aria-labelledby="delivery-h" className="space-y-4 rounded-xl border bg-card p-5" data-testid="delivery-panel">
      <h2 id="delivery-h" className="text-2xl font-semibold">
        Delivery
      </h2>

      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" : "rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-success"}>
          {message.text}
        </p>
      )}

      {a ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm">
              <strong data-testid="assignment-partner">{a.partner.name ?? "Delivery partner"}</strong>
              <span className="text-muted-foreground">
                {" "}
                · {a.partner.phone ? `+91 ${a.partner.phone}` : "no phone"} · {[a.partner.vehicleType, a.partner.vehicleNumber].filter(Boolean).join(" ") || "vehicle not given"}
              </span>
            </p>
            <DeliveryBadge status={a.status} />
          </div>

          {a.failureReason && (a.status === "FAILED" || a.status === "REJECTED" || a.status === "RETURNED_TO_ORIGIN") && (
            <p className="rounded-md border bg-muted px-3 py-2 text-sm">
              <strong>{DELIVERY_LABEL[a.status]}:</strong> {a.failureReason}
            </p>
          )}

          {a.status === "OUT_FOR_DELIVERY" && (
            <p className="text-sm text-muted-foreground" data-testid="otp-state">
              Delivery code: {a.otp.locked ? "locked after too many wrong attempts" : `${a.otp.attemptsLeft} attempt${a.otp.attemptsLeft === 1 ? "" : "s"} left`}
              {a.otp.expiresAt && ` · valid until ${when(a.otp.expiresAt)}`}
            </p>
          )}

          <ol className="space-y-1.5 text-sm" aria-label="Delivery history">
            {a.history.map((h, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-2 text-muted-foreground">
                <span>
                  <span className="text-foreground">{DELIVERY_LABEL[h.status]}</span>
                  {h.reason && ` — ${h.reason}`}
                </span>
                <time dateTime={h.at}>{when(h.at)}</time>
              </li>
            ))}
          </ol>

          <div className="space-y-3 border-t pt-4">
            {a.canReassign && assignable && picker("Give it to a different partner")}
            <div className="flex flex-wrap gap-2">
              {a.canReissueCode && (
                <Button
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => run("reissue", () => authedApi(`/admin/orders/${order.id}/assignment/reissue-code`, { method: "POST" }), "A new delivery code was issued to the customer.")}
                >
                  Reissue delivery code
                </Button>
              )}
              {a.canReassign && (
                <Button
                  variant="outline"
                  className="text-destructive"
                  disabled={busy !== null}
                  onClick={() => run("unassign", () => authedApi(`/admin/orders/${order.id}/assignment`, { method: "DELETE" }), "Delivery unassigned. You can now update this order by hand.")}
                >
                  Unassign
                </Button>
              )}
            </div>
            {a.status !== "DELIVERED" && !a.canReassign && <p className="text-xs text-muted-foreground">The parcel is with the delivery partner, who updates the delivery. Reissue the code if the customer can&apos;t read it out.</p>}
          </div>
        </>
      ) : assignable ? (
        picker("Assign a delivery partner")
      ) : (
        <p className="text-sm text-muted-foreground">Orders can be given to a delivery partner once they are packed. Until then, or for an in-house courier, update the status by hand above.</p>
      )}
    </section>
  );
}
