"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { describeError } from "@/components/admin/api-error-message";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authedApi } from "@/lib/client-api";
import { addressSchema, addressToPayload, INDIAN_STATES, type AddressValues } from "@/lib/schemas/address";
import type { Address } from "@/types/commerce";

const selectClass = "h-11 w-full rounded-md border border-input bg-card px-3 text-sm";

/** Create or edit a delivery address. `idPrefix` keeps field ids unique when two forms share a page. */
export function AddressForm({
  initial,
  idPrefix = "addr",
  onSaved,
  onCancel,
  forceDefault = false,
}: {
  initial?: Address;
  idPrefix?: string;
  onSaved: (address: Address) => void;
  onCancel?: () => void;
  forceDefault?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AddressValues>({
    resolver: zodResolver(addressSchema),
    defaultValues: {
      label: initial?.label ?? "",
      fullName: initial?.fullName ?? "",
      phone: initial?.phone ?? "",
      line1: initial?.line1 ?? "",
      line2: initial?.line2 ?? "",
      landmark: initial?.landmark ?? "",
      city: initial?.city ?? "",
      state: initial?.state ?? "",
      postalCode: initial?.postalCode ?? "",
      isDefault: forceDefault || (initial?.isDefault ?? false),
    },
  });
  const id = (n: string) => `${idPrefix}-${n}`;

  async function onSubmit(values: AddressValues) {
    setError(null);
    try {
      const payload = addressToPayload(values);
      const res = initial
        ? await authedApi<Address>(`/addresses/${initial.id}`, { method: "PATCH", body: payload })
        : await authedApi<Address>("/addresses", { method: "POST", body: payload });
      onSaved(res.data);
    } catch (err) {
      setError(describeError(err, "We couldn't save that address. Please try again."));
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4" aria-label={initial ? "Edit address" : "New address"}>
      {error && (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={id("fullName")} label="Full name" error={errors.fullName?.message}>
          <Input id={id("fullName")} autoComplete="name" className="h-11" aria-invalid={!!errors.fullName} {...register("fullName")} />
        </Field>
        <Field id={id("phone")} label="Mobile number" error={errors.phone?.message}>
          <Input id={id("phone")} type="tel" inputMode="numeric" autoComplete="tel-national" className="h-11" aria-invalid={!!errors.phone} {...register("phone")} />
        </Field>
      </div>
      <Field id={id("line1")} label="Address" error={errors.line1?.message}>
        <Input id={id("line1")} autoComplete="address-line1" className="h-11" placeholder="House no., building, street" aria-invalid={!!errors.line1} {...register("line1")} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={id("line2")} label="Apartment, area (optional)">
          <Input id={id("line2")} autoComplete="address-line2" className="h-11" {...register("line2")} />
        </Field>
        <Field id={id("landmark")} label="Landmark (optional)">
          <Input id={id("landmark")} className="h-11" {...register("landmark")} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id={id("city")} label="City" error={errors.city?.message}>
          <Input id={id("city")} autoComplete="address-level2" className="h-11" aria-invalid={!!errors.city} {...register("city")} />
        </Field>
        <Field id={id("state")} label="State" error={errors.state?.message}>
          <select id={id("state")} autoComplete="address-level1" className={selectClass} aria-invalid={!!errors.state} {...register("state")}>
            <option value="">Select…</option>
            {INDIAN_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field id={id("postalCode")} label="PIN code" error={errors.postalCode?.message}>
          <Input id={id("postalCode")} inputMode="numeric" autoComplete="postal-code" maxLength={6} className="h-11" aria-invalid={!!errors.postalCode} {...register("postalCode")} />
        </Field>
      </div>
      <Field id={id("label")} label="Label (optional)" hint="e.g. Home, Office">
        <Input id={id("label")} className="h-11 sm:max-w-xs" {...register("label")} />
      </Field>
      {!forceDefault && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-[var(--primary)]" {...register("isDefault")} /> Make this my default address
        </label>
      )}
      <div className="flex gap-2">
        <Button type="submit" className="h-11 px-6" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : initial ? "Save address" : "Add address"}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" className="h-11" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
