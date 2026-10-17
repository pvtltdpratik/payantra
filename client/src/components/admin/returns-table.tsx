"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { describeError } from "@/components/admin/api-error-message";
import { StatusBadge } from "@/components/admin/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { authedApi } from "@/lib/client-api";
import { rupeesToPaise } from "@/lib/money";
import { formatINR } from "@/lib/utils";
import type { AdminReturnRow } from "@/types/admin";

function RejectDialog({ row, run }: { row: AdminReturnRow; run: (body: object) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>Decline</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Decline {row.order.orderNumber}</DialogTitle>
          <DialogDescription>The customer will see this reason.</DialogDescription>
        </DialogHeader>
        <Input value={note} onChange={(e) => setNote(e.target.value)} aria-label="Reason" placeholder="Reason" className="h-10" />
        <Button variant="destructive" className="h-10 w-full" disabled={note.trim().length < 3} onClick={async () => (await run({ action: "reject", adminNote: note.trim() })) && setOpen(false)}>
          Decline request
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function CompleteDialog({ row, run }: { row: AdminReturnRow; run: (body: object) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [restock, setRestock] = useState(true);
  const paise = amount.trim() === "" ? undefined : rupeesToPaise(amount);
  const valid = amount.trim() === "" || (paise !== null && paise !== undefined);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>Complete</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Complete {row.order.orderNumber}</DialogTitle>
          <DialogDescription>
            {row.type === "REPLACEMENT"
              ? "No money moves for a replacement. Confirm once the replacement has been arranged."
              : row.order.paymentMethod === "COD"
                ? "This was a Cash on Delivery order, so any refund is paid outside the system."
                : "Refunds go back to the customer's original payment method."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {row.type === "RETURN" && row.order.paymentMethod !== "COD" && (
            <label className="block space-y-1.5 text-sm font-medium">
              Refund amount (₹) — leave empty for the full remaining amount
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="h-10 font-normal" />
            </label>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} className="size-4 accent-[var(--primary)]" />
            Put the returned items back into sellable stock
          </label>
          <Button className="h-10 w-full" disabled={!valid} onClick={async () => (await run({ action: "complete", restock, ...(paise ? { refundAmount: paise } : {}) })) && setOpen(false)}>
            Complete return
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ReturnsTable({ rows }: { rows: AdminReturnRow[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function act(id: string, body: object): Promise<boolean> {
    setBusy(id);
    setError(null);
    try {
      await authedApi(`/admin/returns/${id}`, { method: "PATCH", body });
      router.refresh();
      return true;
    } catch (err) {
      setError(describeError(err));
      return false;
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Request</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} data-testid="return-row">
                <TableCell>
                  <Link href={`/admin/orders/${r.order.id}`} className="font-medium text-primary hover:underline">
                    {r.order.orderNumber}
                  </Link>
                  <p className="text-xs text-muted-foreground">{r.order.user.email} · {formatINR(r.order.grandTotal)}</p>
                </TableCell>
                <TableCell className="max-w-sm">
                  <p className="text-sm font-medium">{r.type === "RETURN" ? "Return" : "Replacement"}: {r.reason}</p>
                  {r.details && <p className="text-xs text-muted-foreground">{r.details}</p>}
                  {r.adminNote && <p className="text-xs">Note: {r.adminNote}</p>}
                </TableCell>
                <TableCell>
                  <StatusBadge status={r.status === "COMPLETED" ? "ACTIVE" : r.status === "REJECTED" ? "SUSPENDED" : "DRAFT"} label={r.status.charAt(0) + r.status.slice(1).toLowerCase()} />
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2">
                    {r.status === "REQUESTED" && (
                      <>
                        <Button size="sm" disabled={busy === r.id} onClick={() => act(r.id, { action: "approve" })}>
                          Approve
                        </Button>
                        <RejectDialog row={r} run={(b) => act(r.id, b)} />
                      </>
                    )}
                    {r.status === "APPROVED" && (
                      <>
                        <CompleteDialog row={r} run={(b) => act(r.id, b)} />
                        <RejectDialog row={r} run={(b) => act(r.id, b)} />
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
