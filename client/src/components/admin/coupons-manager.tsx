"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { describeError } from "@/components/admin/api-error-message";
import { StatusBadge } from "@/components/admin/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { authedApi } from "@/lib/client-api";
import { rupeesToPaise } from "@/lib/money";
import { formatINR } from "@/lib/utils";
import type { AdminCoupon } from "@/types/admin";

const dayInput = (d: Date) => d.toISOString().slice(0, 10);
const describe = (c: AdminCoupon) => (c.discountType === "PERCENTAGE" ? `${c.discountValue}% off${c.maxDiscount ? ` (max ${formatINR(c.maxDiscount)})` : ""}` : `${formatINR(c.discountValue)} off`);

export function CouponsManager({ coupons }: { coupons: AdminCoupon[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState(() => ({
    code: "",
    type: "PERCENTAGE" as "PERCENTAGE" | "FLAT",
    value: "",
    max: "",
    min: "",
    limit: "",
    perUser: "1",
    starts: dayInput(new Date()),
    ends: dayInput(new Date(Date.now() + 30 * 86_400_000)),
  }));
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function run(key: string, call: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await call();
      router.refresh();
      return true;
    } catch (err) {
      setError(describeError(err));
      return false;
    } finally {
      setBusy(null);
    }
  }

  function create(e: React.FormEvent) {
    e.preventDefault();
    const percent = f.type === "PERCENTAGE";
    const value = percent ? Number(f.value) : rupeesToPaise(f.value);
    if (!value || (percent && (!Number.isInteger(value) || value > 100))) return setError(percent ? "Enter a whole percentage between 1 and 100." : "Enter the discount amount in rupees.");
    const max = f.max.trim() ? rupeesToPaise(f.max) : null;
    const min = f.min.trim() ? rupeesToPaise(f.min) : 0;
    if (max === null && f.max.trim()) return setError("Enter the maximum discount as a rupee amount.");
    if (min === null) return setError("Enter the minimum order as a rupee amount.");
    run("create", () =>
      authedApi("/admin/coupons", {
        method: "POST",
        body: {
          code: f.code.trim(),
          discountType: f.type,
          discountValue: value,
          ...(percent && max ? { maxDiscount: max } : {}),
          minOrderValue: min,
          ...(f.limit.trim() ? { usageLimit: Number(f.limit) } : {}),
          perUserLimit: Number(f.perUser) || 1,
          startsAt: new Date(`${f.starts}T00:00:00`).toISOString(),
          endsAt: new Date(`${f.ends}T23:59:59`).toISOString(),
        },
      }),
    ).then((ok) => ok && setF((s) => ({ ...s, code: "", value: "", max: "", min: "", limit: "" })));
  }

  const input = "h-10 font-normal";
  return (
    <div className="space-y-8">
      {error && (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <form onSubmit={create} className="space-y-4 rounded-xl border bg-card p-5" aria-label="New coupon">
        <h2 className="text-2xl font-semibold">New coupon</h2>
        <div className="grid gap-4 sm:grid-cols-4">
          <label className="space-y-1.5 text-sm font-medium">Code<Input value={f.code} onChange={set("code")} className={`${input} uppercase`} placeholder="FESTIVE10" /></label>
          <label className="space-y-1.5 text-sm font-medium">Type
            <select value={f.type} onChange={set("type")} className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm font-normal">
              <option value="PERCENTAGE">Percentage</option>
              <option value="FLAT">Flat amount (₹)</option>
            </select>
          </label>
          <label className="space-y-1.5 text-sm font-medium">{f.type === "PERCENTAGE" ? "Percent off" : "Amount off (₹)"}<Input value={f.value} onChange={set("value")} inputMode="decimal" className={input} /></label>
          {f.type === "PERCENTAGE" && <label className="space-y-1.5 text-sm font-medium">Max discount (₹)<Input value={f.max} onChange={set("max")} inputMode="decimal" className={input} /></label>}
          <label className="space-y-1.5 text-sm font-medium">Minimum order (₹)<Input value={f.min} onChange={set("min")} inputMode="decimal" className={input} /></label>
          <label className="space-y-1.5 text-sm font-medium">Total uses (blank = unlimited)<Input value={f.limit} onChange={set("limit")} inputMode="numeric" className={input} /></label>
          <label className="space-y-1.5 text-sm font-medium">Uses per customer<Input value={f.perUser} onChange={set("perUser")} inputMode="numeric" className={input} /></label>
          <label className="space-y-1.5 text-sm font-medium">Starts<Input type="date" value={f.starts} onChange={set("starts")} className={input} /></label>
          <label className="space-y-1.5 text-sm font-medium">Ends<Input type="date" value={f.ends} onChange={set("ends")} className={input} /></label>
        </div>
        <Button type="submit" className="h-10" disabled={busy === "create" || !f.code.trim() || !f.value.trim()}>
          {busy === "create" ? "Creating…" : "Create coupon"}
        </Button>
      </form>

      {coupons.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-card p-8 text-center text-muted-foreground">No coupons yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Offer</TableHead>
                <TableHead>Valid</TableHead>
                <TableHead className="text-right">Used</TableHead>
                <TableHead>State</TableHead>
                <TableHead><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {coupons.map((c) => {
                const expired = new Date(c.endsAt) < new Date();
                return (
                  <TableRow key={c.id} data-testid="coupon-row">
                    <TableCell className="font-mono font-semibold">{c.code}</TableCell>
                    <TableCell className="text-sm">
                      {describe(c)}
                      {c.minOrderValue > 0 && <span className="block text-xs text-muted-foreground">on orders of {formatINR(c.minOrderValue)}+</span>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(c.startsAt).toLocaleDateString("en-IN")} – {new Date(c.endsAt).toLocaleDateString("en-IN")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.usedCount}{c.usageLimit ? ` / ${c.usageLimit}` : ""}</TableCell>
                    <TableCell>
                      <StatusBadge status={!c.isActive ? "ARCHIVED" : expired ? "DRAFT" : "ACTIVE"} label={!c.isActive ? "Off" : expired ? "Expired" : "Live"} />
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" disabled={busy === c.id} onClick={() => run(c.id, () => authedApi(`/admin/coupons/${c.id}`, { method: "PATCH", body: { isActive: !c.isActive } }))}>
                          {c.isActive ? "Turn off" : "Turn on"}
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Delete ${c.code}`}
                          disabled={busy === c.id}
                          onClick={() => window.confirm(`Delete ${c.code}? Coupons used on orders are switched off instead.`) && run(c.id, () => authedApi(`/admin/coupons/${c.id}`, { method: "DELETE" }))}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
