"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { describeError } from "@/components/admin/api-error-message";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { authedApi } from "@/lib/client-api";
import { FAILURE_REASONS, type DeliveryJob, type PartnerTarget } from "@/types/delivery";

type Send = (status: PartnerTarget, extra?: { reason?: string; notes?: string; code?: string }) => Promise<boolean>;

/** A modal that collects a mandatory reason (picked from a list, or typed) before a step that needs one. */
function ReasonDialog({
  trigger,
  title,
  description,
  options,
  confirm,
  destructive,
  onConfirm,
}: {
  trigger: string;
  title: string;
  description: string;
  options?: readonly string[];
  confirm: string;
  destructive?: boolean;
  onConfirm: (reason: string, notes: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(options?.[0] ?? "");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const needsNotes = reason === "Other";
  const valid = reason.trim().length >= 3 && (!needsNotes || notes.trim().length >= 3);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" className="h-12 flex-1 text-base" />}>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {options ? (
            <label className="block space-y-1.5 text-sm font-medium">
              Reason
              <select value={reason} onChange={(e) => setReason(e.target.value)} className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm font-normal">
                {options.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </label>
          ) : (
            <label className="block space-y-1.5 text-sm font-medium">
              Reason
              <Input value={reason} onChange={(e) => setReason(e.target.value)} className="h-11 font-normal" />
            </label>
          )}
          {(options ? needsNotes : false) && (
            <label className="block space-y-1.5 text-sm font-medium">
              What happened?
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="font-normal" />
            </label>
          )}
          <Button
            variant={destructive ? "destructive" : "default"}
            className="h-12 w-full text-base"
            disabled={!valid || busy}
            onClick={async () => {
              setBusy(true);
              const ok = await onConfirm(reason.trim(), notes.trim());
              setBusy(false);
              if (ok) setOpen(false);
            }}
          >
            {busy ? "Saving…" : confirm}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The next step(s) a delivery partner can take on a job, driven entirely by what the server says is allowed. */
export function JobActions({ job }: { job: DeliveryJob }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const can = (s: PartnerTarget) => job.nextStatuses.includes(s);

  const send: Send = async (status, extra) => {
    setBusy(true);
    setMessage(null);
    try {
      await authedApi(`/delivery/assignments/${job.id}/status`, { method: "POST", body: { status, ...extra } });
      setCode("");
      router.refresh();
      return true;
    } catch (err) {
      setMessage({ kind: "error", text: describeError(err, "That didn't go through. Please try again.") });
      router.refresh(); // a wrong code changes the attempts left; show the truth
      return false;
    } finally {
      setBusy(false);
    }
  };

  const otp = job.otp;
  const otpBlocked = !!otp && (otp.locked || otp.expired);

  return (
    <section aria-labelledby="actions-h" className="space-y-4 rounded-xl border bg-card p-5">
      <h2 id="actions-h" className="text-2xl font-semibold">
        Next step
      </h2>

      {message && (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {message.text}
        </p>
      )}

      {can("ACCEPTED") && (
        <div className="flex flex-wrap gap-3">
          <Button className="h-12 flex-1 text-base" disabled={busy} onClick={() => send("ACCEPTED")}>
            Accept delivery
          </Button>
          {can("REJECTED") && (
            <ReasonDialog
              trigger="Decline"
              title="Decline this delivery?"
              description="The shop will assign it to someone else. Please say why."
              confirm="Decline delivery"
              destructive
              onConfirm={(reason) => send("REJECTED", { reason })}
            />
          )}
        </div>
      )}

      {can("PICKED_UP") && (
        <Button className="h-12 w-full text-base" disabled={busy} onClick={() => send("PICKED_UP")}>
          I have picked up the parcel
        </Button>
      )}

      {job.status === "PICKED_UP" && can("OUT_FOR_DELIVERY") && (
        <Button className="h-12 w-full text-base" disabled={busy} onClick={() => send("OUT_FOR_DELIVERY")}>
          Start delivery
        </Button>
      )}

      {job.status === "OUT_FOR_DELIVERY" && (
        <div className="space-y-5">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send("DELIVERED", { code });
            }}
            aria-label="Confirm delivery"
          >
            <label htmlFor="delivery-code" className="block text-sm font-medium">
              Ask the customer for their 6-digit delivery code
            </label>
            <Input
              id="delivery-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="••••••"
              className="h-14 text-center font-mono text-2xl tracking-[0.5em]"
              disabled={otpBlocked}
            />
            {otp && !otpBlocked && <p className="text-xs text-muted-foreground">{otp.attemptsLeft} attempt{otp.attemptsLeft === 1 ? "" : "s"} left.</p>}
            {otp?.locked && <p role="alert" className="text-sm text-destructive">Too many wrong codes. Ask the shop to reissue the delivery code.</p>}
            {otp?.expired && !otp.locked && <p role="alert" className="text-sm text-destructive">This code has expired. Ask the shop to reissue it.</p>}
            {job.order.collectCash > 0 && (
              <p className="rounded-md bg-muted px-3 py-2 text-sm">Collect the cash first, then confirm.</p>
            )}
            <Button type="submit" className="h-12 w-full text-base" disabled={busy || code.length !== 6 || otpBlocked}>
              {busy ? "Checking…" : "Confirm delivery"}
            </Button>
          </form>
          {can("FAILED") && (
            <ReasonDialog
              trigger="I couldn't deliver"
              title="Couldn't deliver?"
              description="Choose what happened. The shop is told right away."
              options={FAILURE_REASONS}
              confirm="Report failed delivery"
              destructive
              onConfirm={(reason, notes) => send("FAILED", { reason, ...(notes ? { notes } : {}) })}
            />
          )}
        </div>
      )}

      {job.status === "FAILED" && (
        <div className="flex flex-wrap gap-3">
          {can("OUT_FOR_DELIVERY") && (
            <Button className="h-12 flex-1 text-base" disabled={busy} onClick={() => send("OUT_FOR_DELIVERY")}>
              Try delivering again
            </Button>
          )}
          {can("RETURNED_TO_ORIGIN") && (
            <ReasonDialog
              trigger="Return to the shop"
              title="Return this parcel to the shop?"
              description="The order will be cancelled and the customer refunded if they paid online."
              confirm="Return to origin"
              destructive
              onConfirm={(reason) => send("RETURNED_TO_ORIGIN", { reason })}
            />
          )}
        </div>
      )}

      {job.nextStatuses.length === 0 && <p className="text-sm text-muted-foreground">Nothing more to do on this delivery.</p>}
    </section>
  );
}
