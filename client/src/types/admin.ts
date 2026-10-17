import type { Gender } from "./catalogue";
import type { FulfilmentStatus, OrderView, PaymentMethod, PaymentStatus } from "./commerce";
import type { AdminAssignment } from "./delivery";

export interface AdminOrderRow {
  id: string;
  orderNumber: string;
  createdAt: string;
  grandTotal: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  fulfilmentStatus: FulfilmentStatus;
  shipFullName: string;
  shipCity: string;
  customerEmail: string;
  itemCount: number;
}

/** Admins never receive the customer's delivery code: they see the operational assignment instead. */
export interface AdminOrderView extends Omit<OrderView, "delivery"> {
  customer: { id: string; email: string; fullName: string | null; phone: string | null };
  /** The statuses an admin may move this order to right now. */
  nextStatuses: FulfilmentStatus[];
  assignment: AdminAssignment | null;
}

export interface AdminReturnRow {
  id: string;
  type: "RETURN" | "REPLACEMENT";
  status: "REQUESTED" | "APPROVED" | "REJECTED" | "COMPLETED";
  reason: string;
  details: string | null;
  adminNote: string | null;
  refundAmount: number | null;
  createdAt: string;
  order: { id: string; orderNumber: string; grandTotal: number; paymentMethod: PaymentMethod; user: { email: string } };
}

export interface AdminCoupon {
  id: string;
  code: string;
  description: string | null;
  discountType: "PERCENTAGE" | "FLAT";
  discountValue: number;
  maxDiscount: number | null;
  minOrderValue: number;
  usageLimit: number | null;
  perUserLimit: number;
  usedCount: number;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
}

export interface AppSettings {
  shipping: { flatRate: number; freeThreshold: number };
  payments: { codEnabled: boolean; codMaxOrder: number; reservationMinutes: number };
  returns: { returnWindowDays: number; replacementEnabled: boolean };
  delivery: { defaultPayout: number; requireVehicle: boolean; requireIdDocument: boolean };
}

export type ProductStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

export interface AdminProductRow {
  id: string;
  name: string;
  slug: string;
  status: ProductStatus;
  gender: Gender;
  basePrice: number;
  salePrice: number | null;
  effectivePrice: number;
  isFeatured: boolean;
  isNewArrival: boolean;
  updatedAt: string;
  category: string;
  image: string | null;
  variantCount: number;
  available: number;
}

export interface AdminVariant {
  id: string;
  sku: string;
  size: string | null;
  colour: string | null;
  fabric: string | null;
  design: string | null;
  priceOverride: number | null;
  isActive: boolean;
  inventory: { onHand: number; reserved: number; lowStockThreshold: number } | null;
}

export interface AdminImage {
  id: string;
  url: string;
  alt: string | null;
  sortOrder: number;
  isPrimary: boolean;
}

export interface AdminProduct {
  id: string;
  name: string;
  slug: string;
  description: string;
  categoryId: string;
  gender: Gender;
  fabric: string | null;
  occasion: string | null;
  careNotes: string | null;
  basePrice: number;
  salePrice: number | null;
  effectivePrice: number;
  taxRatePercent: string | number;
  hsnCode: string | null;
  status: ProductStatus;
  isFeatured: boolean;
  isNewArrival: boolean;
  images: AdminImage[];
  variants: AdminVariant[];
  collections: { id: string; name: string; slug: string }[];
}

export interface AdminCategory {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  gender: Gender | null;
  isActive: boolean;
  sortOrder: number;
  productCount: number;
  childCount: number;
}

export interface InventoryRow {
  variantId: string;
  sku: string;
  size: string | null;
  colour: string | null;
  productId: string;
  productName: string;
  productStatus: ProductStatus;
  onHand: number;
  reserved: number;
  available: number;
  lowStockThreshold: number;
  isLow: boolean;
}

export interface AdminUser {
  id: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  role: "CUSTOMER" | "DELIVERY_PARTNER" | "ADMIN";
  status: "ACTIVE" | "SUSPENDED";
  createdAt: string;
}
