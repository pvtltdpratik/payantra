"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { authedApi } from "@/lib/client-api";
import { paiseToRupees } from "@/lib/money";
import {
  detailsToPayload,
  productCreateSchema,
  productEditSchema,
  variantToPayload,
  type ProductCreateValues,
  type ProductEditValues,
} from "@/lib/schemas/product";
import type { AdminCategory, AdminProduct } from "@/types/admin";
import { describeError } from "./api-error-message";

const selectClass = "h-11 w-full rounded-md border border-input bg-card px-3 text-sm";

function CategoryOptions({ categories }: { categories: AdminCategory[] }) {
  const roots = categories.filter((c) => !c.parentId);
  return (
    <>
      <option value="">Choose a category…</option>
      {roots.map((r) => {
        const kids = categories.filter((c) => c.parentId === r.id);
        return kids.length ? (
          <optgroup key={r.id} label={r.name}>
            <option value={r.id}>{r.name} (general)</option>
            {kids.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </optgroup>
        ) : (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        );
      })}
    </>
  );
}

type Values = ProductCreateValues;

export function ProductForm({
  categories,
  product,
}: {
  categories: AdminCategory[];
  /** Present when editing; absent when creating. */
  product?: AdminProduct;
}) {
  const router = useRouter();
  const editing = !!product;
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
    reset,
  } = useForm<Values>({
    resolver: zodResolver(editing ? (productEditSchema as never) : productCreateSchema),
    defaultValues: {
      name: product?.name ?? "",
      description: product?.description ?? "",
      categoryId: product?.categoryId ?? "",
      gender: product?.gender ?? "WOMEN",
      fabric: product?.fabric ?? "",
      occasion: product?.occasion ?? "",
      careNotes: product?.careNotes ?? "",
      hsnCode: product?.hsnCode ?? "",
      basePrice: paiseToRupees(product?.basePrice),
      salePrice: paiseToRupees(product?.salePrice),
      taxRatePercent: product ? String(Number(product.taxRatePercent)) : "5",
      status: product?.status ?? "DRAFT",
      isFeatured: product?.isFeatured ?? false,
      isNewArrival: product?.isNewArrival ?? false,
      images: [{ url: "", alt: "" }],
      variants: [{ sku: "", size: "", colour: "", fabric: "", design: "", stock: "0", lowStockThreshold: "5" }],
    },
  });

  const images = useFieldArray({ control, name: "images" });
  const variants = useFieldArray({ control, name: "variants" });

  async function onSubmit(values: Values) {
    setMessage(null);
    try {
      if (editing) {
        await authedApi(`/admin/products/${product!.id}`, {
          method: "PATCH",
          body: detailsToPayload(values as ProductEditValues),
        });
        reset(values);
        setMessage({ kind: "ok", text: "Product saved." });
        router.refresh();
      } else {
        const { data } = await authedApi<{ id: string }>("/admin/products", {
          method: "POST",
          body: {
            ...detailsToPayload(values),
            images: values.images.filter((i) => i.url.trim() !== "").map((i) => ({ url: i.url, alt: i.alt.trim() || null })),
            variants: values.variants.map(variantToPayload),
          },
        });
        router.push(`/admin/products/${data.id}`);
        router.refresh();
      }
    } catch (err) {
      setMessage({ kind: "error", text: describeError(err) });
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-8">
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

      <section className="space-y-4 rounded-xl border bg-card p-5 sm:p-6" aria-labelledby="basics">
        <h2 id="basics" className="text-2xl font-semibold">
          Basics
        </h2>
        <Field id="name" label="Product name" error={errors.name?.message}>
          <Input id="name" className="h-11" aria-invalid={!!errors.name} {...register("name")} />
        </Field>
        <Field id="description" label="Description" error={errors.description?.message}>
          <Textarea id="description" rows={5} aria-invalid={!!errors.description} {...register("description")} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="categoryId" label="Category" error={errors.categoryId?.message}>
            <select id="categoryId" className={selectClass} aria-invalid={!!errors.categoryId} {...register("categoryId")}>
              <CategoryOptions categories={categories} />
            </select>
          </Field>
          <Field id="gender" label="Shop for">
            <select id="gender" className={selectClass} {...register("gender")}>
              <option value="WOMEN">Women</option>
              <option value="MEN">Men</option>
              <option value="UNISEX">Unisex</option>
            </select>
          </Field>
          <Field id="fabric" label="Fabric" error={errors.fabric?.message}>
            <Input id="fabric" className="h-11" {...register("fabric")} />
          </Field>
          <Field id="occasion" label="Occasion" error={errors.occasion?.message}>
            <Input id="occasion" className="h-11" {...register("occasion")} />
          </Field>
        </div>
        <Field id="careNotes" label="Care instructions" error={errors.careNotes?.message}>
          <Textarea id="careNotes" rows={2} {...register("careNotes")} />
        </Field>
      </section>

      <section className="space-y-4 rounded-xl border bg-card p-5 sm:p-6" aria-labelledby="pricing">
        <h2 id="pricing" className="text-2xl font-semibold">
          Pricing &amp; visibility
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="basePrice" label="MRP (₹)" error={errors.basePrice?.message} hint="Inclusive of GST">
            <Input id="basePrice" inputMode="decimal" className="h-11" aria-invalid={!!errors.basePrice} {...register("basePrice")} />
          </Field>
          <Field id="salePrice" label="Sale price (₹)" error={errors.salePrice?.message} hint="Leave empty for no discount">
            <Input id="salePrice" inputMode="decimal" className="h-11" aria-invalid={!!errors.salePrice} {...register("salePrice")} />
          </Field>
          <Field id="taxRatePercent" label="GST (%)" error={errors.taxRatePercent?.message}>
            <Input id="taxRatePercent" inputMode="decimal" className="h-11" {...register("taxRatePercent")} />
          </Field>
          <Field id="hsnCode" label="HSN code" error={errors.hsnCode?.message}>
            <Input id="hsnCode" className="h-11" {...register("hsnCode")} />
          </Field>
          <Field id="status" label="Status" hint="Only Active products are visible in the store">
            <select id="status" className={selectClass} {...register("status")}>
              <option value="DRAFT">Draft</option>
              <option value="ACTIVE">Active</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          </Field>
        </div>
        <div className="flex flex-wrap gap-6 pt-1 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" className="size-4 accent-[var(--primary)]" {...register("isFeatured")} /> Featured
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="size-4 accent-[var(--primary)]" {...register("isNewArrival")} /> New arrival
          </label>
        </div>
      </section>

      {!editing && (
        <>
          <section className="space-y-4 rounded-xl border bg-card p-5 sm:p-6" aria-labelledby="images">
            <h2 id="images" className="text-2xl font-semibold">
              Images
            </h2>
            <p className="text-sm text-muted-foreground">The first image is the primary one. More can be added after saving.</p>
            {images.fields.map((f, i) => (
              <div key={f.id} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <Field id={`images.${i}.url`} label={`Image ${i + 1} URL`} error={errors.images?.[i]?.url?.message}>
                  <Input id={`images.${i}.url`} className="h-11" placeholder="https://…" {...register(`images.${i}.url`)} />
                </Field>
                <Field id={`images.${i}.alt`} label="Alt text">
                  <Input id={`images.${i}.alt`} className="h-11" {...register(`images.${i}.alt`)} />
                </Field>
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove image ${i + 1}`} onClick={() => images.remove(i)}>
                  <Trash2 aria-hidden />
                </Button>
              </div>
            ))}
            {images.fields.length < 10 && (
              <Button type="button" variant="outline" onClick={() => images.append({ url: "", alt: "" })}>
                <Plus aria-hidden /> Add image
              </Button>
            )}
          </section>

          <section className="space-y-4 rounded-xl border bg-card p-5 sm:p-6" aria-labelledby="variants">
            <h2 id="variants" className="text-2xl font-semibold">
              Variants &amp; opening stock
            </h2>
            {errors.variants?.root?.message && (
              <p role="alert" className="text-sm text-destructive">
                {errors.variants.root.message}
              </p>
            )}
            {variants.fields.map((f, i) => {
              const e = errors.variants?.[i];
              return (
                <fieldset key={f.id} className="space-y-3 rounded-lg border p-4">
                  <legend className="px-1 text-sm font-semibold">Variant {i + 1}</legend>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field id={`v${i}-sku`} label="SKU" error={e?.sku?.message}>
                      <Input id={`v${i}-sku`} className="h-10 uppercase" {...register(`variants.${i}.sku`)} />
                    </Field>
                    <Field id={`v${i}-size`} label="Size">
                      <Input id={`v${i}-size`} className="h-10" {...register(`variants.${i}.size`)} />
                    </Field>
                    <Field id={`v${i}-colour`} label="Colour">
                      <Input id={`v${i}-colour`} className="h-10" {...register(`variants.${i}.colour`)} />
                    </Field>
                    <Field id={`v${i}-fabric`} label="Fabric">
                      <Input id={`v${i}-fabric`} className="h-10" {...register(`variants.${i}.fabric`)} />
                    </Field>
                    <Field id={`v${i}-stock`} label="Opening stock" error={e?.stock?.message}>
                      <Input id={`v${i}-stock`} inputMode="numeric" className="h-10" {...register(`variants.${i}.stock`)} />
                    </Field>
                    <Field id={`v${i}-low`} label="Low-stock alert at" error={e?.lowStockThreshold?.message}>
                      <Input id={`v${i}-low`} inputMode="numeric" className="h-10" {...register(`variants.${i}.lowStockThreshold`)} />
                    </Field>
                  </div>
                  {variants.fields.length > 1 && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => variants.remove(i)}>
                      <Trash2 aria-hidden /> Remove variant
                    </Button>
                  )}
                </fieldset>
              );
            })}
            <Button
              type="button"
              variant="outline"
              onClick={() => variants.append({ sku: "", size: "", colour: "", fabric: "", design: "", stock: "0", lowStockThreshold: "5" })}
            >
              <Plus aria-hidden /> Add variant
            </Button>
          </section>
        </>
      )}

      <div className="sticky bottom-0 -mx-4 flex items-center gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8">
        <Button type="submit" className="h-11 px-6" disabled={isSubmitting || (editing && !isDirty)}>
          {isSubmitting ? "Saving…" : editing ? "Save changes" : "Create product"}
        </Button>
        {editing && !isDirty && <span className="text-sm text-muted-foreground">No unsaved changes</span>}
      </div>
    </form>
  );
}
