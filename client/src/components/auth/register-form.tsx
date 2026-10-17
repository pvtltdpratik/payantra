"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { registerSchema, type RegisterInput } from "@/lib/schemas/auth";
import { isNetworkAuthError } from "@/lib/auth-errors";
import { createClient } from "@/lib/supabase/client";
import { GoogleButton } from "./google-button";

export function RegisterForm({ next }: { next: string }) {
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { fullName: "", email: "", password: "", confirmPassword: "" },
  });

  async function onSubmit(values: RegisterInput) {
    setFormError(null);
    try {
      const { error } = await createClient().auth.signUp({
        email: values.email,
        password: values.password,
        options: {
          data: { full_name: values.fullName },
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      if (error) {
        setFormError(
          isNetworkAuthError(error)
            ? "We couldn't reach the sign-up service. Check your connection and try again."
            : error.message || "We couldn't create your account. Please try again.",
        );
        return;
      }
      // Same screen whether or not the address was already registered (no account enumeration).
      setSentTo(values.email);
    } catch {
      setFormError("We couldn't reach the sign-up service. Check your connection and try again.");
    }
  }

  if (sentTo) {
    return (
      <div role="status" className="space-y-3 text-center">
        <MailCheck aria-hidden className="mx-auto size-10 text-success" />
        <h2 className="text-2xl font-semibold">Check your inbox</h2>
        <p className="text-sm text-muted-foreground">
          We sent a confirmation link to <strong className="text-foreground">{sentTo}</strong>. Open it to activate your
          account.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <GoogleButton next={next} />
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or register with email
        <span className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        {formError && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {formError}
          </p>
        )}
        <Field id="fullName" label="Full name" error={errors.fullName?.message}>
          <Input id="fullName" autoComplete="name" aria-invalid={!!errors.fullName} className="h-11" {...register("fullName")} />
        </Field>
        <Field id="email" label="Email" error={errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" inputMode="email" aria-invalid={!!errors.email} className="h-11" {...register("email")} />
        </Field>
        <Field id="password" label="Password" error={errors.password?.message} hint="At least 8 characters, with a letter and a number.">
          <Input id="password" type="password" autoComplete="new-password" aria-invalid={!!errors.password} className="h-11" {...register("password")} />
        </Field>
        <Field id="confirmPassword" label="Confirm password" error={errors.confirmPassword?.message}>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            aria-invalid={!!errors.confirmPassword}
            className="h-11"
            {...register("confirmPassword")}
          />
        </Field>
        <Button type="submit" className="h-11 w-full text-base" disabled={isSubmitting}>
          {isSubmitting ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </div>
  );
}
