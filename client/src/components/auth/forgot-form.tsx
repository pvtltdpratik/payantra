"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { forgotSchema, type ForgotInput } from "@/lib/schemas/auth";
import { isNetworkAuthError } from "@/lib/auth-errors";
import { createClient } from "@/lib/supabase/client";

export function ForgotForm() {
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotInput>({ resolver: zodResolver(forgotSchema), defaultValues: { email: "" } });

  async function onSubmit({ email }: ForgotInput) {
    setFormError(null);
    try {
      const { error } = await createClient().auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset-password`,
      });
      if (error && isNetworkAuthError(error)) {
        setFormError("We couldn't reach the service. Check your connection and try again.");
        return;
      }
      if (error?.status === 429) {
        setFormError("Too many requests. Please wait a few minutes before trying again.");
        return;
      }
      // Identical outcome whether or not the account exists, so the form cannot be used to probe emails.
      setSent(true);
    } catch {
      setFormError("We couldn't reach the service. Check your connection and try again.");
    }
  }

  if (sent) {
    return (
      <div role="status" className="space-y-3 text-center">
        <MailCheck aria-hidden className="mx-auto size-10 text-success" />
        <p className="text-sm text-muted-foreground">
          If an account exists for that address, a reset link is on its way. It may take a minute to arrive.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      {formError && (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {formError}
        </p>
      )}
      <Field id="email" label="Email" error={errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" inputMode="email" aria-invalid={!!errors.email} className="h-11" {...register("email")} />
      </Field>
      <Button type="submit" className="h-11 w-full text-base" disabled={isSubmitting}>
        {isSubmitting ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  );
}
