import { z } from "zod";

/** Mirrors the API's validation so errors show before a round-trip; the server remains the authority. */
export const addressSchema = z.object({
  label: z.string().trim().max(30),
  fullName: z.string().trim().min(2, "Enter the recipient's full name").max(100),
  phone: z.string().trim().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number"),
  line1: z.string().trim().min(3, "Enter the street address").max(200),
  line2: z.string().trim().max(200),
  landmark: z.string().trim().max(100),
  city: z.string().trim().min(2, "Enter the city").max(80),
  state: z.string().trim().min(2, "Choose the state").max(80),
  postalCode: z.string().trim().regex(/^[1-9]\d{5}$/, "Enter a valid 6-digit PIN code"),
  isDefault: z.boolean(),
});

export type AddressValues = z.infer<typeof addressSchema>;

export const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana",
  "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur",
  "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana",
  "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal", "Andaman and Nicobar Islands", "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
] as const;

/** Blank strings become null: the API stores "not provided" as null. */
export function addressToPayload(v: AddressValues) {
  const blank = (s: string) => (s === "" ? null : s);
  return { ...v, label: blank(v.label), line2: blank(v.line2), landmark: blank(v.landmark) };
}
