"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { authedApi } from "@/lib/client-api";
import type { AdminCategory } from "@/types/admin";
import { describeError } from "./api-error-message";
import { StatusBadge } from "./status-badge";

const selectClass = "h-10 w-full rounded-md border border-input bg-card px-3 text-sm";

export function CategoriesManager({ categories }: { categories: AdminCategory[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [gender, setGender] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byId = new Map(categories.map((c) => [c.id, c]));
  const roots = categories.filter((c) => !c.parentId);
  // Show children directly under their parent.
  const ordered = roots.flatMap((r) => [r, ...categories.filter((c) => c.parentId === r.id)]);

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

  return (
    <div className="space-y-8">
      {error && (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <form
        className="grid gap-3 rounded-xl border bg-card p-5 sm:grid-cols-[2fr_2fr_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim().length < 2) return;
          run(async () => {
            await authedApi("/admin/categories", {
              method: "POST",
              body: { name: name.trim(), parentId: parentId || null, gender: gender || null },
            });
            setName("");
            setParentId("");
            setGender("");
          });
        }}
      >
        <label className="space-y-1.5 text-sm font-medium">
          New category name
          <Input value={name} onChange={(e) => setName(e.target.value)} className="h-10 font-normal" />
        </label>
        <label className="space-y-1.5 text-sm font-medium">
          Parent (optional)
          <select value={parentId} onChange={(e) => setParentId(e.target.value)} className={selectClass}>
            <option value="">— Top level —</option>
            {roots.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1.5 text-sm font-medium">
          For
          <select value={gender} onChange={(e) => setGender(e.target.value)} className={selectClass}>
            <option value="">Any</option>
            <option value="WOMEN">Women</option>
            <option value="MEN">Men</option>
            <option value="UNISEX">Unisex</option>
          </select>
        </label>
        <Button type="submit" disabled={busy || name.trim().length < 2} className="h-10">
          Add
        </Button>
      </form>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Parent</TableHead>
              <TableHead className="text-right">Products</TableHead>
              <TableHead>State</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ordered.map((c) => (
              <TableRow key={c.id} className={c.isActive ? undefined : "opacity-60"}>
                <TableCell className={c.parentId ? "pl-8" : "font-medium"}>{c.name}</TableCell>
                <TableCell className="text-muted-foreground">{c.parentId ? byId.get(c.parentId)?.name : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{c.productCount}</TableCell>
                <TableCell>
                  <StatusBadge status={c.isActive ? "ACTIVE" : "ARCHIVED"} label={c.isActive ? "Visible" : "Hidden"} />
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => run(() => authedApi(`/admin/categories/${c.id}`, { method: "PATCH", body: { isActive: !c.isActive } }))}
                    >
                      {c.isActive ? "Hide" : "Show"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${c.name}`}
                      disabled={busy || c.productCount > 0 || c.childCount > 0}
                      title={c.productCount > 0 || c.childCount > 0 ? "Move its products or sub-categories first" : undefined}
                      onClick={() => {
                        if (window.confirm(`Delete category “${c.name}”?`)) run(() => authedApi(`/admin/categories/${c.id}`, { method: "DELETE" }));
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
    </div>
  );
}
