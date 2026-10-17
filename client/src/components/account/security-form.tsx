"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

type Msg = { kind: "ok" | "error"; text: string } | null;
const note = (m: Msg) =>
  m && (
    <p role={m.kind === "error" ? "alert" : "status"} className={m.kind === "error" ? "rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" : "rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-success"}>
      {m.text}
    </p>
  );

/**
 * Change password and sign out other devices. Both go to the identity provider directly (Supabase) — Payantra never
 * sees or stores a password. The current password is asked for again before a new one is accepted.
 */
export function SecurityForm({ email, hasPassword }: { email: string; hasPassword: boolean }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ current?: string; next?: string; confirm?: string }>({});
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [others, setOthers] = useState<Msg>(null);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const v: typeof errors = {};
    if (!current) v.current = "Enter your current password.";
    if (next.length < 8) v.next = "Use at least 8 characters.";
    else if (!/[A-Za-z]/.test(next) || !/\d/.test(next)) v.next = "Include at least one letter and one number.";
    else if (next === current) v.next = "Choose a password you haven't used here before.";
    if (confirm !== next) v.confirm = "The passwords do not match.";
    setErrors(v);
    if (Object.keys(v).length) return;

    setBusy(true);
    const supabase = createClient();
    try {
      // Prove it is really the account owner (a stolen, still-signed-in browser must not be able to take over the account).
      const check = await supabase.auth.signInWithPassword({ email, password: current });
      if (check.error) {
        setErrors({ current: "That isn't your current password." });
        return;
      }
      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) {
        setMsg({ kind: "error", text: error.message.includes("different") ? "Choose a password you haven't used here before." : "We couldn't change your password. Please try again." });
        return;
      }
      setCurrent("");
      setNext("");
      setConfirm("");
      setMsg({ kind: "ok", text: "Password changed." });
    } finally {
      setBusy(false);
    }
  }

  async function signOutOthers() {
    setOthers(null);
    const { error } = await createClient().auth.signOut({ scope: "others" });
    setOthers(error ? { kind: "error", text: "We couldn't sign out your other devices." } : { kind: "ok", text: "Signed out everywhere else. This device stays signed in." });
  }

  return (
    <div className="space-y-8">
      {hasPassword ? (
        <form onSubmit={changePassword} noValidate className="space-y-4 rounded-xl border bg-card p-5" aria-label="Change password">
          <h2 className="text-2xl font-semibold">Change password</h2>
          {note(msg)}
          <Field id="current-password" label="Current password" error={errors.current}>
            <Input id="current-password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className="h-11" aria-invalid={!!errors.current} />
          </Field>
          <Field id="new-password" label="New password" error={errors.next} hint="At least 8 characters, with a letter and a number.">
            <Input id="new-password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className="h-11" aria-invalid={!!errors.next} />
          </Field>
          <Field id="confirm-new-password" label="Confirm new password" error={errors.confirm}>
            <Input id="confirm-new-password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="h-11" aria-invalid={!!errors.confirm} />
          </Field>
          <Button type="submit" className="h-11 px-6" disabled={busy}>
            {busy ? "Saving…" : "Change password"}
          </Button>
        </form>
      ) : (
        <section className="rounded-xl border bg-card p-5">
          <h2 className="text-2xl font-semibold">Password</h2>
          <p className="mt-2 text-sm text-muted-foreground">You sign in with Google, so there is no Payantra password to change. Manage your sign-in security in your Google account.</p>
        </section>
      )}

      <section className="space-y-3 rounded-xl border bg-card p-5">
        <h2 className="text-2xl font-semibold">Devices</h2>
        <p className="text-sm text-muted-foreground">Signed in on a shared or lost device? End every session except this one.</p>
        {note(others)}
        <Button variant="outline" className="h-11" onClick={signOutOthers}>
          Sign out other devices
        </Button>
      </section>
    </div>
  );
}
