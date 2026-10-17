import { z } from "zod";
import { rupeesToPaise } from "@/lib/money";

const amount = (label: string) =>
  z.string().refine((v) => rupeesToPaise(v) !== null && rupeesToPaise(v)! <= 100_000_000, `${label}: enter an amount like 1499 or 1499.50`);

const optionalAmount = z
  .string()
  .refine((v) => v.trim() === "" || (rupeesToPaise(v) !== null && rupeesToPaise(v)! <= 100_000_000), "Enter an amount like 1499 or 1499.50");

const intString = (label: string, max: number) =>
  z.string().refine((v) => /^\d+$/.test(v.trim()) && Number(v) <= max, `${label}: whole number from 0 to ${max.toLocaleString("en-IN")}`);

export const variantFormSchema = z.object({
  sku: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/, "SKU: 2–40 letters, digits, . _ or -"),
  size: z.string().trim().max(30),
  colour: z.string().trim().max(40),
  fabric: z.string().trim().max(40),
  design: z.string().trim().max(60),
  stock: intString("Stock", 1_000_000),
  lowStockThreshold: intString("Low-stock alert", 10_000),
});

const detailsShape = {
  name: z.string().trim().min(2, "Enter a product name").max(150),
  description: z.string().trim().min(10, "Describe the product (at least 10 characters)").max(5000),
  categoryId: z.string().min(1, "Choose a category"),
  gender: z.enum(["WOMEN", "MEN", "UNISEX"]),
  fabric: z.string().trim().max(60),
  occasion: z.string().trim().max(60),
  careNotes: z.string().trim().max(1000),
  hsnCode: z.string().trim().max(12),
  basePrice: amount("MRP"),
  salePrice: optionalAmount,
  taxRatePercent: z
    .string()
    .refine((v) => v.trim() !== "" && Number(v) >= 0 && Number(v) <= 28, "GST must be between 0 and 28"),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]),
  isFeatured: z.boolean(),
  isNewArrival: z.boolean(),
};

const salePriceCheck = (v: { basePrice: string; salePrice: string }) => {
  const sale = v.salePrice.trim() === "" ? null : rupeesToPaise(v.salePrice);
  const base = rupeesToPaise(v.basePrice);
  return sale === null || base === null || sale <= base;
};
const saleMessage = { message: "Sale price cannot exceed the MRP", path: ["salePrice"] };

export const productEditSchema = z.object(detailsShape).refine(salePriceCheck, saleMessage);

export const productCreateSchema = z
  .object({
    ...detailsShape,
    images: z
      .array(
        z.object({
          url: z
            .string()
            .trim()
            .refine((u) => u === "" || /^https:\/\/\S+$/.test(u) || /^\/(?!\/)\S*$/.test(u), "Use an https:// URL or a site path"),
          alt: z.string().trim().max(160),
        }),
      )
      .max(10),
    variants: z.array(variantFormSchema).min(1, "Add at least one variant").max(100),
  })
  .refine(salePriceCheck, saleMessage);

export type ProductEditValues = z.infer<typeof productEditSchema>;
export type ProductCreateValues = z.infer<typeof productCreateSchema>;
export type VariantFormValues = z.infer<typeof variantFormSchema>;

/** Form strings → the exact payload the API validates (money in integer paise). */
export function detailsToPayload(v: ProductEditValues) {
  const blank = (s: string) => (s.trim() === "" ? null : s.trim());
  return {
    name: v.name,
    description: v.description,
    categoryId: v.categoryId,
    gender: v.gender,
    fabric: blank(v.fabric),
    occasion: blank(v.occasion),
    careNotes: blank(v.careNotes),
    hsnCode: blank(v.hsnCode),
    basePrice: rupeesToPaise(v.basePrice)!,
    salePrice: v.salePrice.trim() === "" ? null : rupeesToPaise(v.salePrice)!,
    taxRatePercent: Number(v.taxRatePercent),
    status: v.status,
    isFeatured: v.isFeatured,
    isNewArrival: v.isNewArrival,
  };
}

export function variantToPayload(v: VariantFormValues) {
  const blank = (s: string) => (s.trim() === "" ? null : s.trim());
  return {
    sku: v.sku,
    size: blank(v.size),
    colour: blank(v.colour),
    fabric: blank(v.fabric),
    design: blank(v.design),
    stock: Number(v.stock),
    lowStockThreshold: Number(v.lowStockThreshold),
  };
}
