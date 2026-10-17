"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { describeError } from "@/components/admin/api-error-message";
import { SupportStatusBadge } from "@/components/support/support-status-badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { authedApi } from "@/lib/client-api";
import type { AdminSupportRow, SupportStatus } from "@/types/analytics";

function Item({ row }: { row: AdminSupportRow }) {
  const router = useRouter();
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function send(body: { reply?: string; status?: SupportStatus }, key: string, ok: string) {
    setBusy(key);
    setMsg(null);
    try {
      await authedApi(`/admin/support/${row.id}`, { method: "PATCH", body });
      setMsg({ kind: "ok", text: ok });
      if (body.reply) setReply("");
      router.refresh();
    } catch (err) {
      setMsg({ kind: "error", text: describeError(err) });
    } finally {
      setBusy(null);
    }
  }

  const closed = row.status === "RESOLVED" || row.status === "CLOSED";
  return (
    <li className="space-y-3 rounded-xl border bg-card p-5" data-testid="support-item">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold leading-snug">{row.subject}</h2>
          <p className="text-sm text-muted-foreground">
            <Link href={`/admin/customers/${row.user.id}`} className="text-primary hover:underline">
              {row.user.fullName ?? row.user.email}
            </Link>
            {row.orderNumber && (
              <>
                {" · "}
                <Link href={`/admin/orders/${row.orderId}`} className="text-primary hover:underline">
                  {row.orderNumber}
                </Link>
              </>
            )}
            {" · "}
            {new Date(row.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })}
          </p>
        </div>
        <SupportStatusBadge status={row.status} />
      </div>

      <p className="whitespace-pre-wrap rounded-md bg-muted/50 px-3 py-2 text-sm">{row.message}</p>
      {row.reply && (
        <p className="whitespace-pre-wrap rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm">
          <strong>Your reply:</strong> {row.reply}
        </p>
      )}

      {msg && (
        <p role={msg.kind === "error" ? "alert" : "status"} className={msg.kind === "error" ? "text-sm text-destructive" : "text-sm text-success"}>
          {msg.text}
        </p>
      )}

      <div className="space-y-2">
        <label htmlFor={`reply-${row.id}`} className="text-sm font-medium">
          {row.reply ? "Send another reply" : "Reply to the customer"}
        </label>
        <Textarea id={`reply-${row.id}`} value={reply} onChange={(e) => setReply(e.target.value)} rows={3} maxLength={2000} placeholder="They receive this as a notification and can read it on their support page." />
        <div className="flex flex-wrap gap-2">
          <Button disabled={reply.trim().length < 2 || busy !== null} onClick={() => send({ reply: reply.trim() }, "reply", "Reply sent.")}>
            {busy === "reply" ? "Sending…" : "Send reply"}
          </Button>
          {!closed && (
            <Button variant="outline" disabled={busy !== null} onClick={() => send({ status: "RESOLVED" }, "resolve", "Marked as resolved.")}>
              Mark resolved
            </Button>
          )}
          {closed && (
            <Button variant="outline" disabled={busy !== null} onClick={() => send({ status: "OPEN" }, "reopen", "Reopened.")}>
              Reopen
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}

export function SupportInbox({ rows }: { rows: AdminSupportRow[] }) {
  return (
    <ul className="space-y-4">
      {rows.map((r) => (
        <Item key={r.id} row={r} />
      ))}
    </ul>
  );
}
