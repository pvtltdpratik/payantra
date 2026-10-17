"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { authedApi } from "@/lib/client-api";
import type { InventoryRow } from "@/types/admin";
import { describeError } from "./api-error-message";

export function AdjustStock({ row }: { row: InventoryRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"delta" | "set">("delta");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const n = Number(qty);
  const valid =
    qty.trim() !== "" &&
    Number.isInteger(n) &&
    reason.trim().length >= 3 &&
    (mode === "set" ? n >= 0 : n !== 0);
  const resulting = mode === "set" ? n : row.onHand + n;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await authedApi(`/admin/inventory/${row.variantId}/adjust`, {
        method: "POST",
        body: { mode, quantity: n, reason: reason.trim() },
      });
      setOpen(false);
      setQty("");
      setReason("");
      router.refresh();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>Adjust</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust stock</DialogTitle>
          <DialogDescription>
            {row.productName} · <span className="font-mono">{row.sku}</span>
            <br />
            On hand {row.onHand} · Reserved {row.reserved} · Available {row.available}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          {error && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <fieldset className="flex gap-4 text-sm">
            <legend className="sr-only">Adjustment type</legend>
            <label className="flex items-center gap-2">
              <input type="radio" checked={mode === "delta"} onChange={() => setMode("delta")} className="accent-[var(--primary)]" />
              Add or remove units
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={mode === "set"} onChange={() => setMode("set")} className="accent-[var(--primary)]" />
              Set exact count
            </label>
          </fieldset>

          <label className="block space-y-1.5 text-sm font-medium">
            {mode === "delta" ? "Units (use a minus sign to remove)" : "New on-hand count"}
            <Input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric" className="h-10 font-normal" />
          </label>
          {valid && (
            <p className="text-sm text-muted-foreground">
              On hand becomes <strong className="text-foreground">{resulting}</strong>.
            </p>
          )}

          <label className="block space-y-1.5 text-sm font-medium">
            Reason (kept in the audit trail)
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Restock from supplier" className="h-10 font-normal" />
          </label>

          <Button type="submit" disabled={!valid || busy} className="h-10 w-full">
            {busy ? "Saving…" : "Save adjustment"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
