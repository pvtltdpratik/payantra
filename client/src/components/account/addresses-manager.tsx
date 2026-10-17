"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { describeError } from "@/components/admin/api-error-message";
import { Button } from "@/components/ui/button";
import { authedApi } from "@/lib/client-api";
import type { Address } from "@/types/commerce";
import { AddressForm } from "./address-form";

export function AddressesManager({ initial }: { initial: Address[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function act(id: string, call: () => Promise<unknown>) {
    setBusy(id);
    setError(null);
    try {
      await call();
      router.refresh();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(null);
    }
  }
  const done = () => {
    setEditing(null);
    router.refresh();
  };

  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {initial.length === 0 && editing !== "new" && (
        <div className="rounded-xl border border-dashed bg-card px-6 py-12 text-center">
          <MapPin aria-hidden className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 text-muted-foreground">You haven&apos;t saved an address yet.</p>
        </div>
      )}

      <ul className="grid gap-4 sm:grid-cols-2">
        {initial.map((a) =>
          editing === a.id ? (
            <li key={a.id} className="rounded-xl border bg-card p-5 sm:col-span-2">
              <AddressForm initial={a} idPrefix={`edit-${a.id.slice(0, 6)}`} onSaved={done} onCancel={() => setEditing(null)} />
            </li>
          ) : (
            <li key={a.id} className="flex flex-col rounded-xl border bg-card p-5" data-testid="address-card">
              <div className="flex items-center gap-2">
                <p className="font-semibold">{a.fullName}</p>
                {a.label && <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{a.label}</span>}
                {a.isDefault && <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">Default</span>}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {[a.line1, a.line2, a.landmark].filter(Boolean).join(", ")}
                <br />
                {a.city}, {a.state} {a.postalCode}
                <br />
                +91 {a.phone}
              </p>
              <div className="mt-4 flex flex-wrap gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={() => setEditing(a.id)}>
                  <Pencil aria-hidden /> Edit
                </Button>
                {!a.isDefault && (
                  <Button size="sm" variant="outline" disabled={busy === a.id} onClick={() => act(a.id, () => authedApi(`/addresses/${a.id}`, { method: "PATCH", body: { isDefault: true } }))}>
                    Make default
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy === a.id}
                  aria-label={`Delete address for ${a.fullName}`}
                  onClick={() => {
                    if (window.confirm("Delete this address? Past orders keep their own copy.")) act(a.id, () => authedApi(`/addresses/${a.id}`, { method: "DELETE" }));
                  }}
                >
                  <Trash2 aria-hidden /> Delete
                </Button>
              </div>
            </li>
          ),
        )}
      </ul>

      {editing === "new" ? (
        <div className="rounded-xl border bg-card p-5">
          <h2 className="mb-4 text-2xl font-semibold">New address</h2>
          <AddressForm idPrefix="new" forceDefault={initial.length === 0} onSaved={done} onCancel={() => setEditing(null)} />
        </div>
      ) : (
        initial.length < 10 && (
          <Button variant="outline" className="h-11" onClick={() => setEditing("new")}>
            <Plus aria-hidden /> Add a new address
          </Button>
        )
      )}
    </div>
  );
}
