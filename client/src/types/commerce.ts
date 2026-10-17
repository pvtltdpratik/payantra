import type { MediaImage } from "./catalogue";
import type { CustomerDelivery } from "./delivery";

/** All money is integer paise. */

export type LineIssue = "UNAVAILABLE" | "OUT_OF_STOCK" | "INSUFFICIENT_STOCK";

export interface CartItem {
  variantId: string;
  productId: string;
  slug: string;
  name: string;
  image: MediaImage | null;
  sku: string;
  size: string | null;
  colour: string | null;
  fabric: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  available: number;
  maxQuantity: number;
  issue: LineIssue | null;
  pricedQuantity: number;
}

export interface CartPricing {
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  taxTotal: number;
  grandTotal: number;
  couponCode: string | null;
  couponNote: string | null;
  freeShippingRemaining: number;
}

export interface CartView {
  items: CartItem[];
  itemCount: number;
  canCheckout: boolean;
  pricing: CartPricing;
}

export interface Address {
  id: string;
  label: string | null;
  fullName: string;
  phone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  postalCode: string;
  isDefault: boolean;
}

export interface CheckoutOptions {
  razorpayKeyId: string;
  codEnabled: boolean;
  codMaxOrder: number;
  reservationMinutes: number;
}

export interface RazorpayCheckoutParams {
  keyId: string;
  razorpayOrderId: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  prefill: { name: string; email: string; contact: string };
}

export type PaymentMethod = "RAZORPAY" | "COD";
export type PaymentStatus = "PENDING" | "AUTHORIZED" | "CAPTURED" | "FAILED" | "REFUNDED" | "PARTIALLY_REFUNDED";
export type FulfilmentStatus =
  | "PLACED"
  | "PAYMENT_CONFIRMED"
  | "PROCESSING"
  | "PACKED"
  | "SHIPPED"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "CANCELLED"
  | "RETURN_REQUESTED"
  | "RETURNED";

export interface CheckoutResult {
  order: {
    id: string;
    orderNumber: string;
    grandTotal: number;
    paymentMethod: PaymentMethod;
    paymentStatus: PaymentStatus;
    fulfilmentStatus: FulfilmentStatus;
    stockExpiresAt: string | null;
  };
  payment: RazorpayCheckoutParams | null;
}

export interface OrderListItem {
  id: string;
  orderNumber: string;
  createdAt: string;
  grandTotal: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  fulfilmentStatus: FulfilmentStatus;
  stockExpiresAt: string | null;
  itemCount: number;
  preview: { name: string; image: string | null }[];
}

export interface OrderView {
  id: string;
  orderNumber: string;
  createdAt: string;
  paidAt: string | null;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  fulfilmentStatus: FulfilmentStatus;
  cancelReason: string | null;
  stockExpiresAt: string | null;
  couponCode: string | null;
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  taxTotal: number;
  grandTotal: number;
  address: {
    fullName: string;
    phone: string;
    line1: string;
    line2: string | null;
    landmark: string | null;
    city: string;
    state: string;
    postalCode: string;
  };
  items: {
    id: string;
    productId: string;
    name: string;
    sku: string;
    image: string | null;
    size: string | null;
    colour: string | null;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
  }[];
  payment: { status: PaymentStatus; method: string | null; amount: number; refundedAmount: number; failureReason: string | null } | null;
  refunds: { id: string; amount: number; status: string; reason: string | null; createdAt: string; processedAt: string | null }[];
  timeline: { status: FulfilmentStatus; note: string | null; at: string }[];
  /** The delivery partner's progress and, while out for delivery, the code the customer reads to them. */
  delivery: CustomerDelivery | null;
  returns: { id: string; type: "RETURN" | "REPLACEMENT"; status: string; reason: string; adminNote: string | null; refundAmount: number | null; createdAt: string }[];
  actions: {
    canCancel: boolean;
    canRetryPayment: boolean;
    canReturn: boolean;
    returnWindowEndsAt: string | null;
    canViewInvoice: boolean;
  };
}

export interface Invoice {
  invoiceNumber: string;
  orderNumber: string;
  issuedAt: string;
  seller: { legalName: string; note: string };
  billTo: OrderView["address"];
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  lines: {
    description: string;
    sku: string;
    quantity: number;
    unitPrice: number;
    discount: number;
    taxableValue: number;
    gstRate: number;
    gst: number;
    total: number;
  }[];
  totals: { subtotal: number; discount: number; shipping: number; taxableValue: number; gst: number; grandTotal: number; couponCode: string | null };
}

/** Customer-facing wording for each stage of the fulfilment pipeline. */
export const STATUS_LABEL: Record<FulfilmentStatus, string> = {
  PLACED: "Order placed",
  PAYMENT_CONFIRMED: "Payment confirmed",
  PROCESSING: "Processing",
  PACKED: "Packed",
  SHIPPED: "Shipped",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  RETURN_REQUESTED: "Return requested",
  RETURNED: "Returned",
};

/** The happy-path stages shown as the tracking timeline. */
export const TIMELINE_STAGES: FulfilmentStatus[] = [
  "PLACED",
  "PAYMENT_CONFIRMED",
  "PROCESSING",
  "PACKED",
  "SHIPPED",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
];
