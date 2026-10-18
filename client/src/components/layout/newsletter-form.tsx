"use client";

import { useState } from "react";
import { api } from "@/lib/api";

/**
 * Newsletter sign-up. Works for anyone; the server answers identically whether or not the address was already
 * subscribed. The page can hold two of them (the home band and the footer), so each takes its own input id.
 */
export function NewsletterForm({ id = "newsletter-email", label = "New arrivals and festive edits, once in a while." }: { id?: string; label?: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setState("error");
      return setError("Enter a valid email address.");
    }
    setState("busy");
    try {
      await api("/newsletter/subscribe", { method: "POST", body: { email: email.trim() } });
      setState("done");
      setEmail("");
    } catch {
      setState("error");
      setError("We couldn't sign you up just now. Please try again.");
    }
  }

  if (state === "done") {
    return (
      <p role="status" className="text-sm text-primary-foreground/90" data-testid="newsletter-done">
        Thank you — you&apos;re on the list.
      </p>
    );
  }
  return (
    <form onSubmit={submit} noValidate aria-label="Newsletter" className="space-y-2">
      <label htmlFor={id} className="text-sm text-primary-foreground/80">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          aria-invalid={state === "error"}
          className="h-10 min-w-0 flex-1 rounded-md border border-primary-foreground/30 bg-primary-foreground/10 px-3 text-sm text-primary-foreground placeholder:text-primary-foreground/50"
        />
        <button type="submit" disabled={state === "busy"} className="h-10 shrink-0 rounded-md bg-gold px-4 text-sm font-semibold text-primary disabled:opacity-60">
          {state === "busy" ? "…" : "Subscribe"}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-primary-foreground">
          {error}
        </p>
      )}
    </form>
  );
}
