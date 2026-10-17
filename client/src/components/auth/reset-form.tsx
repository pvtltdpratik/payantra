"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { resetSchema, type ResetInput } from "@/lib/schemas/auth";
import { createClient } from "@/lib/supabase/client";

export function ResetForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetInput>({ resolver: zodResolver(resetSchema), defaultValues: { password: "", confirmPassword: "" } });

  async function onSubmit({ password }: ResetInput) {
    setFormError(null);
    try {
      const { error } = await createClient().auth.updateUser({ password });
      if (error) {
        setFormError(
          error.message.toLowerCase().includes("session")
            ? "This reset link has expired. Request a new one."
            : error.message,
        );
        return;
      }
      router.push("/account");
      router.refresh();
    } catch {
      setFormError("We couldn't reach the service. Check your connection and try again.");
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      {formError && (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {formError}
        </p>
      )}
      <Field id="password" label="New password" error={errors.password?.message} hint="At least 8 characters, with a letter and a number.">
        <Input id="password" type="password" autoComplete="new-password" aria-invalid={!!errors.password} className="h-11" {...register("password")} />
      </Field>
      <Field id="confirmPassword" label="Confirm new password" error={errors.confirmPassword?.message}>
        <Input id="confirmPassword" type="password" autoComplete="new-password" aria-invalid={!!errors.confirmPassword} className="h-11" {...register("confirmPassword")} />
      </Field>
      <Button type="submit" className="h-11 w-full text-base" disabled={isSubmitting}>
        {isSubmitting ? "Saving…" : "Set new password"}
      </Button>
    </form>
  );
}
