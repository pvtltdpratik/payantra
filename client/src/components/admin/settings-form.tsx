"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { describeError } from "@/components/admin/api-error-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authedApi } from "@/lib/client-api";
import { paiseToRupees, rupeesToPaise } from "@/lib/money";
import type { AppSettings } from "@/types/admin";

type Msg = { kind: "ok" | "error"; text: string } | null;

function Notice({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <p role={msg.kind === "error" ? "alert" : "status"} className={msg.kind === "error" ? "rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" : "rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-success"}>
      {msg.text}
    </p>
  );
}

function useSave(key: "shipping" | "payments" | "returns") {
  const router = useRouter();
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  async function save(body: object) {
    setBusy(true);
    setMsg(null);
    try {
      await authedApi(`/admin/settings/${key}`, { method: "PUT", body });
      setMsg({ kind: "ok", text: "Saved." });
      router.refresh();
    } catch (err) {
      setMsg({ kind: "error", text: describeError(err) });
    } finally {
      setBusy(false);
    }
  }
  return { msg, busy, save, setMsg };
}

const card = "space-y-4 rounded-xl border bg-card p-5";
const field = "block space-y-1.5 text-sm font-medium";

export function SettingsForms({ settings }: { settings: AppSettings }) {
  // Shipping
  const ship = useSave("shipping");
  const [flat, setFlat] = useState(paiseToRupees(settings.shipping.flatRate) || "0");
  const [free, setFree] = useState(paiseToRupees(settings.shipping.freeThreshold) || "0");
  // Payments
  const pay = useSave("payments");
  const [cod, setCod] = useState(settings.payments.codEnabled);
  const [codMax, setCodMax] = useState(paiseToRupees(settings.payments.codMaxOrder) || "0");
  const [minutes, setMinutes] = useState(String(settings.payments.reservationMinutes));
  // Returns
  const ret = useSave("returns");
  const [days, setDays] = useState(String(settings.returns.returnWindowDays));
  const [repl, setRepl] = useState(settings.returns.replacementEnabled);

  return (
    <div className="space-y-8">
      <form
        className={card}
        aria-label="Delivery charges"
        onSubmit={(e) => {
          e.preventDefault();
          const a = rupeesToPaise(flat);
          const b = rupeesToPaise(free);
          if (a === null || b === null) return ship.setMsg({ kind: "error", text: "Enter both amounts in rupees, like 99 or 2999." });
          void ship.save({ flatRate: a, freeThreshold: b });
        }}
      >
        <h2 className="text-2xl font-semibold">Delivery charges</h2>
        <Notice msg={ship.msg} />
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={field}>Delivery charge (₹)<Input value={flat} onChange={(e) => setFlat(e.target.value)} inputMode="decimal" className="h-10 font-normal" /></label>
          <label className={field}>Free delivery above (₹) — 0 means always free<Input value={free} onChange={(e) => setFree(e.target.value)} inputMode="decimal" className="h-10 font-normal" /></label>
        </div>
        <Button type="submit" disabled={ship.busy} className="h-10">Save delivery charges</Button>
      </form>

      <form
        className={card}
        aria-label="Payments"
        onSubmit={(e) => {
          e.preventDefault();
          const max = rupeesToPaise(codMax);
          const mins = Number(minutes);
          if (max === null) return pay.setMsg({ kind: "error", text: "Enter the COD limit in rupees." });
          if (!Number.isInteger(mins) || mins < 5 || mins > 120) return pay.setMsg({ kind: "error", text: "The reservation window must be 5–120 minutes." });
          void pay.save({ codEnabled: cod, codMaxOrder: max, reservationMinutes: mins });
        }}
      >
        <h2 className="text-2xl font-semibold">Payments</h2>
        <Notice msg={pay.msg} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={cod} onChange={(e) => setCod(e.target.checked)} className="size-4 accent-[var(--primary)]" />
          Offer Cash on Delivery
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={field}>Largest COD order (₹)<Input value={codMax} onChange={(e) => setCodMax(e.target.value)} inputMode="decimal" className="h-10 font-normal" /></label>
          <label className={field}>Hold stock for online payment (minutes)<Input value={minutes} onChange={(e) => setMinutes(e.target.value)} inputMode="numeric" className="h-10 font-normal" /></label>
        </div>
        <p className="text-xs text-muted-foreground">Online payments use Razorpay and are always on. Unpaid online orders release their stock after the window above.</p>
        <Button type="submit" disabled={pay.busy} className="h-10">Save payment settings</Button>
      </form>

      <form
        className={card}
        aria-label="Returns"
        onSubmit={(e) => {
          e.preventDefault();
          const d = Number(days);
          if (!Number.isInteger(d) || d < 0 || d > 90) return ret.setMsg({ kind: "error", text: "The return window must be 0–90 days." });
          void ret.save({ returnWindowDays: d, replacementEnabled: repl });
        }}
      >
        <h2 className="text-2xl font-semibold">Returns &amp; replacements</h2>
        <Notice msg={ret.msg} />
        <label className={field}>Return window (days after delivery)<Input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" className="h-10 font-normal sm:max-w-xs" /></label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={repl} onChange={(e) => setRepl(e.target.checked)} className="size-4 accent-[var(--primary)]" />
          Allow replacement requests
        </label>
        <Button type="submit" disabled={ret.busy} className="h-10">Save return policy</Button>
      </form>
    </div>
  );
}
