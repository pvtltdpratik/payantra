"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { describeError } from "@/components/admin/api-error-message";
import { StatusBadge } from "@/components/admin/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authedApi } from "@/lib/client-api";
import type { AdminBanner, BannerPlacement } from "@/types/analytics";

const PLACEMENT_LABEL: Record<BannerPlacement, string> = { HOME_HERO: "Home page — hero", HOME_STRIP: "Home page — strip", CATEGORY: "Category pages" };
const input = "h-10 font-normal";
const label = "space-y-1.5 text-sm font-medium";

const blank = { title: "", subtitle: "", imageUrl: "", linkUrl: "", placement: "HOME_HERO" as BannerPlacement, sortOrder: "0", startsAt: "", endsAt: "" };

/** Homepage banners and sections. Images and links are site paths (/shop) or https URLs; the server refuses anything else. */
export function BannersManager({ banners }: { banners: AdminBanner[] }) {
  const router = useRouter();
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function run(key: string, call: () => Promise<unknown>, ok: string) {
    setBusy(key);
    setMsg(null);
    try {
      await call();
      setMsg({ kind: "ok", text: ok });
      router.refresh();
      return true;
    } catch (err) {
      setMsg({ kind: "error", text: describeError(err) });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const sort = Number(f.sortOrder);
    if (!Number.isInteger(sort) || sort < 0) return setMsg({ kind: "error", text: "Sort order must be a whole number, 0 or more." });
    const ok = await run(
      "create",
      () =>
        authedApi("/admin/banners", {
          method: "POST",
          body: {
            title: f.title.trim(),
            subtitle: f.subtitle.trim() || null,
            imageUrl: f.imageUrl.trim(),
            linkUrl: f.linkUrl.trim() || null,
            placement: f.placement,
            sortOrder: sort,
            startsAt: f.startsAt ? new Date(`${f.startsAt}T00:00:00+05:30`).toISOString() : null,
            endsAt: f.endsAt ? new Date(`${f.endsAt}T23:59:59+05:30`).toISOString() : null,
          },
        }),
      "Banner added.",
    );
    if (ok) setF(blank);
  }

  // Read once on mount: the clock is impure, and "live / scheduled / expired" only needs to be right as of this view.
  const [now] = useState(() => Date.now());
  const state = (b: AdminBanner) => (!b.isActive ? "Off" : b.startsAt && new Date(b.startsAt).getTime() > now ? "Scheduled" : b.endsAt && new Date(b.endsAt).getTime() <= now ? "Expired" : "Live");

  return (
    <div className="space-y-8">
      {msg && (
        <p role={msg.kind === "error" ? "alert" : "status"} className={msg.kind === "error" ? "rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" : "rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-success"}>
          {msg.text}
        </p>
      )}

      <form onSubmit={create} className="space-y-4 rounded-xl border bg-card p-5" aria-label="New banner">
        <h2 className="text-2xl font-semibold">New banner</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={label}>Title<Input value={f.title} onChange={set("title")} className={input} /></label>
          <label className={label}>Subtitle (optional)<Input value={f.subtitle} onChange={set("subtitle")} className={input} /></label>
          <label className={label}>Image<Input value={f.imageUrl} onChange={set("imageUrl")} className={input} placeholder="/placeholder/5c1a2b?label=Diwali or https://…" /></label>
          <label className={label}>Links to (optional)<Input value={f.linkUrl} onChange={set("linkUrl")} className={input} placeholder="/shop or /category/silk-sarees" /></label>
          <label className={label}>
            Where it appears
            <select value={f.placement} onChange={set("placement")} className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm font-normal">
              {(Object.keys(PLACEMENT_LABEL) as BannerPlacement[]).map((p) => (
                <option key={p} value={p}>
                  {PLACEMENT_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
          <label className={label}>Order (lower shows first)<Input value={f.sortOrder} onChange={set("sortOrder")} inputMode="numeric" className={input} /></label>
          <label className={label}>Starts (optional)<Input type="date" value={f.startsAt} onChange={set("startsAt")} className={input} /></label>
          <label className={label}>Ends (optional)<Input type="date" value={f.endsAt} onChange={set("endsAt")} className={input} /></label>
        </div>
        <Button type="submit" className="h-10" disabled={busy === "create" || f.title.trim().length < 2 || !f.imageUrl.trim()}>
          {busy === "create" ? "Adding…" : "Add banner"}
        </Button>
      </form>

      {banners.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-card p-8 text-center text-muted-foreground">No banners yet.</p>
      ) : (
        <ul className="space-y-3">
          {banners.map((b) => {
            const s = state(b);
            return (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4" data-testid="banner-row">
                <div className="min-w-0">
                  <p className="font-medium">{b.title}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {PLACEMENT_LABEL[b.placement]} · order {b.sortOrder} · {b.linkUrl ?? "no link"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={s === "Live" ? "ACTIVE" : s === "Off" ? "ARCHIVED" : "DRAFT"} label={s} />
                  <Button size="sm" variant="outline" disabled={busy === b.id} onClick={() => run(b.id, () => authedApi(`/admin/banners/${b.id}`, { method: "PATCH", body: { isActive: !b.isActive } }), b.isActive ? "Banner switched off." : "Banner switched on.")}>
                    {b.isActive ? "Turn off" : "Turn on"}
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete ${b.title}`}
                    disabled={busy === b.id}
                    onClick={() => window.confirm(`Delete the banner "${b.title}"?`) && run(b.id, () => authedApi(`/admin/banners/${b.id}`, { method: "DELETE" }), "Banner deleted.")}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
