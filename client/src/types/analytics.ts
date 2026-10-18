/** Money is integer paise throughout. Days are India (IST) calendar days, as "YYYY-MM-DD". */

export interface PeriodTotals {
  grossSales: number;
  refunds: number;
  netRevenue: number;
  paidOrders: number;
  averageOrderValue: number;
  taxCollected: number;
  discountsGiven: number;
  shippingCollected: number;
}

export interface Overview {
  range: { from: string; to: string; days: number };
  totals: PeriodTotals;
  previous: { from: string; to: string; totals: PeriodTotals };
  ordersPlaced: number;
  orderStatus: Record<string, number>;
  salesByDay: { date: string; gross: number; refunds: number; net: number; orders: number }[];
  customers: { total: number; new: number };
  partners: { approved: number; online: number; pendingApplications: number };
  lowStock: {
    count: number;
    items: { variantId: string; productId: string; sku: string; name: string; size: string | null; colour: string | null; onHand: number; reserved: number; available: number; lowStockThreshold: number }[];
  };
  pending: { returnRequests: number; returnsAwaitingCompletion: number; refundsAwaitingConfirmation: number; supportRequests: number };
  recentTransactions: { id: string; type: "PAYMENT" | "REFUND"; amount: number; method: string | null; at: string; orderId: string; orderNumber: string }[];
}

export type ReportName = "sales" | "products" | "inventory" | "payments" | "delivery";
export type ColumnType = "text" | "int" | "money" | "date" | "datetime" | "percent";

export interface Report {
  name: ReportName;
  title: string;
  columns: { key: string; label: string; type: ColumnType }[];
  rows: Record<string, string | number | null>[];
  totals?: Record<string, string | number | null>;
  truncated: boolean;
  range: { from: string; to: string; days: number };
}

export interface AdminCustomerRow {
  id: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  status: "ACTIVE" | "SUSPENDED";
  createdAt: string;
  orders: number;
  lastOrderAt: string | null;
  totalSpent: number;
}

export interface AdminCustomerDetail {
  id: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  status: "ACTIVE" | "SUSPENDED";
  createdAt: string;
  stats: {
    orders: number;
    paidOrders: number;
    totalSpent: number;
    refunded: number;
    netSpent: number;
    averageOrder: number;
    firstOrderAt: string | null;
    lastOrderAt: string | null;
    wishlistItems: number;
    reviews: number;
  };
  recentOrders: { id: string; orderNumber: string; createdAt: string; grandTotal: number; paymentMethod: "RAZORPAY" | "COD"; paymentStatus: string; fulfilmentStatus: string }[];
  addresses: { id: string; label: string | null; fullName: string; line1: string; city: string; state: string; postalCode: string; isDefault: boolean }[];
  supportRequests: { id: string; subject: string; status: SupportStatus; createdAt: string }[];
}

export type SupportStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";

export interface SupportRequestRow {
  id: string;
  subject: string;
  message: string;
  status: SupportStatus;
  reply: string | null;
  repliedAt: string | null;
  orderId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminSupportRow extends SupportRequestRow {
  user: { id: string; email: string; fullName: string | null };
  orderNumber: string | null;
}

export type BannerPlacement = "ANNOUNCEMENT" | "HOME_HERO" | "HOME_STRIP" | "CATEGORY";

export interface AdminBanner {
  id: string;
  title: string;
  subtitle: string | null;
  imageUrl: string;
  linkUrl: string | null;
  placement: BannerPlacement;
  sortOrder: number;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
}

export interface Subscriber {
  id: string;
  email: string;
  subscribedAt: string;
  unsubscribedAt: string | null;
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: unknown;
  ip: string | null;
  createdAt: string;
  actor: { email: string; fullName: string | null } | null;
}
