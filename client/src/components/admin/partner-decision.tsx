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
import type { AdminPartnerDetail } from "@/types/delivery";

type Msg = { kind: "ok" | "error"; text: string } | null;

function ReasonDialog({ trigger, title, description, confirm, onConfirm }: { trigger: string; title: string; description: string; confirm: string; onConfirm: (reason: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" className="text-destructive" />}>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <label className="block space-y-1.5 text-sm font-medium">
          Reason (shown to the partner)
          <Input value={reason} onChange={(e) => setReason(e.target.value)} className="h-10 font-normal" />
        </label>
        <Button
          variant="destructive"
          className="h-10 w-full"
          disabled={reason.trim().length < 3 || busy}
          onClick={async () => {
            setBusy(true);
            const ok = await onConfirm(reason.trim());
            setBusy(false);
            if (ok) setOpen(false);
          }}
        >
          {busy ? "Saving…" : confirm}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

/** Approve, reject, suspend or reactivate a delivery partner, and set what they earn per delivery. */
export function PartnerDecision({ partner }: { partner: AdminPartnerDetail }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [payout, setPayout] = useState(paiseToRupees(partner.perDeliveryPayout) || "0");

  async function decide(action: string, extra: { reason?: string; perDeliveryPayout?: number } = {}, done: string): Promise<boolean> {
    setBusy(action);
    setMsg(null);
    try {
      await authedApi(`/admin/delivery-partners/${partner.id}`, { method: "PATCH", body: { action, ...extra } });
      setMsg({ kind: "ok", text: done });
      router.refresh();
      return true;
    } catch (err) {
      setMsg({ kind: "error", text: describeError(err) });
      return false;
    } finally {
      setBusy(null);
    }
  }

  const rate = rupeesToPaise(payout);
  const rateValid = rate !== null;

  return (
    <section aria-labelledby="decision-h" className="space-y-4 rounded-xl border bg-card p-5">
      <h2 id="decision-h" className="text-2xl font-semibold">
        Decision
      </h2>
      {msg && (
        <p role={msg.kind === "error" ? "alert" : "status"} className={msg.kind === "error" ? "rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" : "rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-success"}>
          {msg.text}
        </p>
      )}

      <label className="block max-w-xs space-y-1.5 text-sm font-medium">
        Paid per delivery (₹)
        <Input value={payout} onChange={(e) => setPayout(e.target.value)} inputMode="decimal" className="h-10 font-normal" aria-invalid={!rateValid} />
      </label>

      <div className="flex flex-wrap gap-2">
        {(partner.status === "PENDING" || partner.status === "REJECTED") && (
          <Button disabled={!rateValid || busy !== null} onClick={() => decide("approve", { perDeliveryPayout: rate ?? undefined }, "Approved. They can now go online and receive deliveries.")}>
            {busy === "approve" ? "Approving…" : "Approve"}
          </Button>
        )}
        {partner.status === "PENDING" && (
          <ReasonDialog trigger="Reject…" title="Reject this application?" description="They can apply again after fixing what you point out." confirm="Reject application" onConfirm={(reason) => decide("reject", { reason }, "Application rejected.")} />
        )}
        {partner.status === "APPROVED" && (
          <>
            <Button variant="outline" disabled={!rateValid || busy !== null || rate === partner.perDeliveryPayout} onClick={() => decide("update", { perDeliveryPayout: rate ?? undefined }, `Rate set to ${formatINR(rate ?? 0)} per delivery.`)}>
              Save rate
            </Button>
            <ReasonDialog trigger="Suspend…" title="Suspend this partner?" description="They are signed out of delivery work and set offline. Not possible while they hold parcels in transit." confirm="Suspend partner" onConfirm={(reason) => decide("suspend", { reason }, "Partner suspended.")} />
          </>
        )}
        {partner.status === "SUSPENDED" && (
          <Button disabled={busy !== null} onClick={() => decide("reactivate", {}, "Partner reactivated.")}>
            {busy === "reactivate" ? "Reactivating…" : "Reactivate"}
          </Button>
        )}
      </div>
    </section>
  );
}
