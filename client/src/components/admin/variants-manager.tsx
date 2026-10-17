"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { authedApi } from "@/lib/client-api";
import type { AdminVariant } from "@/types/admin";
import { describeError } from "./api-error-message";
import { StatusBadge } from "./status-badge";

const EMPTY = { sku: "", size: "", colour: "", fabric: "", stock: "0" };

export function VariantsManager({ productId, variants }: { productId: string; variants: AdminVariant[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const blank = (s: string) => (s.trim() === "" ? null : s.trim());

  return (
    <section className="space-y-4 rounded-xl border bg-card p-5 sm:p-6" aria-labelledby="var-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="var-heading" className="text-2xl font-semibold">
          Variants
        </h2>
        <Link href="/admin/inventory" className="text-sm text-primary underline-offset-4 hover:underline">
          Adjust stock in Inventory →
        </Link>
      </div>
      {error && (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Colour</TableHead>
              <TableHead>Fabric</TableHead>
              <TableHead className="text-right">On hand</TableHead>
              <TableHead className="text-right">Reserved</TableHead>
              <TableHead>State</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {variants.map((v) => (
              <TableRow key={v.id} className={v.isActive ? undefined : "opacity-60"}>
                <TableCell className="font-mono text-xs">{v.sku}</TableCell>
                <TableCell>{v.size ?? "—"}</TableCell>
                <TableCell>{v.colour ?? "—"}</TableCell>
                <TableCell>{v.fabric ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{v.inventory?.onHand ?? 0}</TableCell>
                <TableCell className="text-right tabular-nums">{v.inventory?.reserved ?? 0}</TableCell>
                <TableCell>
                  <StatusBadge status={v.isActive ? "ACTIVE" : "ARCHIVED"} label={v.isActive ? "Active" : "Inactive"} />
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => run(() => authedApi(`/admin/variants/${v.id}`, { method: "PATCH", body: { isActive: !v.isActive } }))}
                    >
                      {v.isActive ? "Deactivate" : "Activate"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete variant ${v.sku}`}
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(`Delete variant ${v.sku}? Variants that appear in past orders are deactivated instead.`)) {
                          run(() => authedApi(`/admin/variants/${v.id}`, { method: "DELETE" }));
                        }
                      }}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <form
        className="grid gap-3 border-t pt-4 sm:grid-cols-5 sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.sku.trim()) return;
          run(async () => {
            await authedApi(`/admin/products/${productId}/variants`, {
              method: "POST",
              body: {
                sku: draft.sku.trim(),
                size: blank(draft.size),
                colour: blank(draft.colour),
                fabric: blank(draft.fabric),
                stock: Number(draft.stock) || 0,
              },
            });
            setDraft(EMPTY);
          });
        }}
      >
        <label className="space-y-1.5 text-sm font-medium">
          SKU
          <Input value={draft.sku} onChange={set("sku")} className="h-10 font-normal uppercase" />
        </label>
        <label className="space-y-1.5 text-sm font-medium">
          Size
          <Input value={draft.size} onChange={set("size")} className="h-10 font-normal" />
        </label>
        <label className="space-y-1.5 text-sm font-medium">
          Colour
          <Input value={draft.colour} onChange={set("colour")} className="h-10 font-normal" />
        </label>
        <label className="space-y-1.5 text-sm font-medium">
          Opening stock
          <Input value={draft.stock} onChange={set("stock")} inputMode="numeric" className="h-10 font-normal" />
        </label>
        <Button type="submit" disabled={busy || !draft.sku.trim()} className="h-10">
          Add variant
        </Button>
      </form>
    </section>
  );
}
