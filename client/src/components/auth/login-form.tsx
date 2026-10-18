"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { loginSchema, type LoginInput } from "@/lib/schemas/auth";
import { isNetworkAuthError } from "@/lib/auth-errors";
import { createClient } from "@/lib/supabase/client";
import { announceAuthChange } from "@/lib/supabase/lazy";
import { GoogleButton } from "./google-button";

export function LoginForm({ next, notice }: { next: string; notice?: string }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(notice ?? null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });

  async function onSubmit(values: LoginInput) {
    setFormError(null);
    try {
      const { error } = await createClient().auth.signInWithPassword(values);
      if (error) {
        if (isNetworkAuthError(error)) {
          setFormError("We couldn't reach the sign-in service. Check your connection and try again.");
        } else if (error.status === 429) {
          setFormError("Too many attempts. Please wait a few minutes and try again.");
        } else {
          // One message for wrong password and unknown email — no account enumeration.
          setFormError(
            error.message.toLowerCase().includes("confirm")
              ? "Please confirm your email address first — check your inbox for the link."
              : "Incorrect email or password.",
          );
        }
        return;
      }
      announceAuthChange(); // the header bag/bell and wishlist hearts only watch Supabase once a session exists
      router.push(next);
      router.refresh(); // re-render server components with the new session
    } catch {
      setFormError("We couldn't reach the sign-in service. Check your connection and try again.");
    }
  }

  return (
    <div className="space-y-5">
      <GoogleButton next={next} />
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or sign in with email
        <span className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        {formError && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {formError}
          </p>
        )}
        <Field id="email" label="Email" error={errors.email?.message}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? "email-error" : undefined}
            className="h-11"
            {...register("email")}
          />
        </Field>
        <Field id="password" label="Password" error={errors.password?.message}>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? "password-error" : undefined}
            className="h-11"
            {...register("password")}
          />
        </Field>
        <div className="text-right">
          <Link href="/auth/forgot-password" className="text-sm text-primary underline-offset-4 hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" className="h-11 w-full text-base" disabled={isSubmitting}>
          {isSubmitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
