"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { describeError } from "@/components/admin/api-error-message";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { authedApi } from "@/lib/client-api";
import type { PartnerMe } from "@/types/delivery";

type Values = {
  fullName: string;
  phone: string;
  serviceCity: string;
  vehicleType: string;
  vehicleNumber: string;
  idDocumentType: string;
  idDocumentRef: string;
  applicationNote: string;
};

/** Application to become a delivery partner. An administrator reviews it; applying does not change the applicant's access. */
export function ApplyForm({ me }: { me: PartnerMe }) {
  const router = useRouter();
  const [v, setV] = useState<Values>({
    fullName: me.profile.fullName ?? "",
    phone: me.profile.phone ?? "",
    serviceCity: me.partner?.serviceCity ?? "",
    vehicleType: me.partner?.vehicleType ?? "",
    vehicleNumber: me.partner?.vehicleNumber ?? "",
    idDocumentType: me.partner?.idDocumentType ?? "",
    idDocumentRef: "",
    applicationNote: "",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof Values, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setV((s) => ({ ...s, [k]: e.target.value }));

  function validate(): boolean {
    const e: Partial<Record<keyof Values, string>> = {};
    if (v.fullName.trim().length < 2) e.fullName = "Enter your full name";
    if (!/^[6-9]\d{9}$/.test(v.phone.trim())) e.phone = "Enter a valid 10-digit mobile number";
    if (v.serviceCity.trim().length < 2) e.serviceCity = "Which city will you deliver in?";
    if (me.requirements.vehicle && !v.vehicleType.trim()) e.vehicleType = "Tell us what you ride";
    if (me.requirements.idDocument && !v.idDocumentType.trim()) e.idDocumentType = "Choose a document type";
    if (me.requirements.idDocument && !v.idDocumentRef.trim()) e.idDocumentRef = "Add the verification reference";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setFormError(null);
    if (!validate()) return;
    setBusy(true);
    const clean = (s: string) => (s.trim() === "" ? undefined : s.trim());
    try {
      await authedApi("/delivery/apply", {
        method: "POST",
        body: {
          fullName: v.fullName.trim(),
          phone: v.phone.trim(),
          serviceCity: v.serviceCity.trim(),
          vehicleType: clean(v.vehicleType),
          vehicleNumber: clean(v.vehicleNumber),
          idDocumentType: clean(v.idDocumentType),
          idDocumentRef: clean(v.idDocumentRef),
          applicationNote: clean(v.applicationNote),
        },
      });
      router.push("/delivery");
      router.refresh();
    } catch (err) {
      setFormError(describeError(err, "We couldn't send your application. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  const select = "h-11 w-full rounded-md border border-input bg-card px-3 text-sm";
  return (
    <form onSubmit={submit} noValidate className="space-y-5" aria-label="Delivery partner application">
      {formError && (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {formError}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="fullName" label="Full name" error={errors.fullName}>
          <Input id="fullName" value={v.fullName} onChange={set("fullName")} autoComplete="name" className="h-11" aria-invalid={!!errors.fullName} />
        </Field>
        <Field id="phone" label="Mobile number" error={errors.phone} hint="Customers are shown this number while you are out for delivery.">
          <Input id="phone" value={v.phone} onChange={set("phone")} type="tel" inputMode="numeric" autoComplete="tel-national" className="h-11" aria-invalid={!!errors.phone} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="serviceCity" label="City you will deliver in" error={errors.serviceCity}>
          <Input id="serviceCity" value={v.serviceCity} onChange={set("serviceCity")} className="h-11" aria-invalid={!!errors.serviceCity} />
        </Field>
        <Field id="vehicleType" label={`Vehicle${me.requirements.vehicle ? "" : " (optional)"}`} error={errors.vehicleType}>
          <select id="vehicleType" value={v.vehicleType} onChange={set("vehicleType")} className={select} aria-invalid={!!errors.vehicleType}>
            <option value="">Select…</option>
            {["Bicycle", "Scooter", "Motorcycle", "Van"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field id="vehicleNumber" label="Vehicle registration (optional)">
        <Input id="vehicleNumber" value={v.vehicleNumber} onChange={set("vehicleNumber")} className="h-11 sm:max-w-xs" />
      </Field>
      <fieldset className="space-y-4 rounded-lg border p-4">
        <legend className="px-1 text-sm font-semibold">Identity verification{me.requirements.idDocument ? "" : " (optional)"}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="idDocumentType" label="Document" error={errors.idDocumentType}>
            <select id="idDocumentType" value={v.idDocumentType} onChange={set("idDocumentType")} className={select} aria-invalid={!!errors.idDocumentType}>
              <option value="">Select…</option>
              {["Driving licence", "Aadhaar", "Voter ID", "PAN"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field id="idDocumentRef" label="Verification reference" error={errors.idDocumentRef} hint="Only the last 4 digits or a reference — never the full number.">
            <Input id="idDocumentRef" value={v.idDocumentRef} onChange={set("idDocumentRef")} className="h-11" aria-invalid={!!errors.idDocumentRef} />
          </Field>
        </div>
      </fieldset>
      <Field id="applicationNote" label="Anything we should know? (optional)">
        <Textarea id="applicationNote" value={v.applicationNote} onChange={set("applicationNote")} rows={3} maxLength={500} />
      </Field>
      <Button type="submit" className="h-12 px-8 text-base" disabled={busy}>
        {busy ? "Sending…" : me.partner?.status === "REJECTED" ? "Apply again" : "Send application"}
      </Button>
    </form>
  );
}
