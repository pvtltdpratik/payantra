"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import { authedApi } from "@/lib/client-api";
import { createClient } from "@/lib/supabase/client";

const schema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name").max(100),
  phone: z
    .string()
    .trim()
    .refine((v) => v === "" || /^[6-9]\d{9}$/.test(v), "Enter a valid 10-digit Indian mobile number"),
});
type Values = z.infer<typeof schema>;

export function AccountForm({ me }: { me: { fullName: string | null; phone: string | null; email: string } }) {
  const router = useRouter();
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { fullName: me.fullName ?? "", phone: me.phone ?? "" },
  });

  async function onSubmit(values: Values) {
    setMessage(null);
    try {
      await authedApi("/users/me", {
        method: "PATCH",
        // Only send the phone when set: the API validates it as a mobile number.
        body: { fullName: values.fullName, ...(values.phone ? { phone: values.phone } : {}) },
      });
      reset(values);
      setMessage({ kind: "ok", text: "Your details have been saved." });
      router.refresh();
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof ApiError ? err.message : "Could not save your details." });
    }
  }

  async function signOut() {
    await createClient().auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4 rounded-xl border bg-card p-6">
        <h2 className="text-2xl font-semibold">Personal details</h2>
        {message && (
          <p
            role={message.kind === "error" ? "alert" : "status"}
            className={
              message.kind === "error"
                ? "rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                : "rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-success"
            }
          >
            {message.text}
          </p>
        )}
        <Field id="fullName" label="Full name" error={errors.fullName?.message}>
          <Input id="fullName" autoComplete="name" className="h-11" aria-invalid={!!errors.fullName} {...register("fullName")} />
        </Field>
        <Field id="phone" label="Mobile number" error={errors.phone?.message} hint="Used only for delivery updates.">
          <Input id="phone" type="tel" inputMode="numeric" autoComplete="tel-national" className="h-11" aria-invalid={!!errors.phone} {...register("phone")} />
        </Field>
        <Button type="submit" disabled={isSubmitting || !isDirty} className="h-10">
          {isSubmitting ? "Saving…" : "Save changes"}
        </Button>
      </form>

      <Button variant="outline" className="h-10" onClick={signOut}>
        Sign out
      </Button>
    </div>
  );
}
