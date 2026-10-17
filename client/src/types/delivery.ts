export type DeliveryStatus = "ASSIGNED" | "ACCEPTED" | "PICKED_UP" | "OUT_FOR_DELIVERY" | "DELIVERED" | "FAILED" | "RETURNED_TO_ORIGIN" | "REJECTED";
export type PartnerStatus = "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED";

/** The statuses a partner can move a job to (the server decides which are allowed from here). */
export type PartnerTarget = Exclude<DeliveryStatus, "ASSIGNED">;

export const DELIVERY_LABEL: Record<DeliveryStatus, string> = {
  ASSIGNED: "New delivery",
  ACCEPTED: "Accepted",
  PICKED_UP: "Picked up",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  FAILED: "Delivery failed",
  RETURNED_TO_ORIGIN: "Returned to origin",
  REJECTED: "Rejected",
};

/** Quick reasons a rider can pick in a tap. "Other" asks for a note. */
export const FAILURE_REASONS = [
  "Customer not available",
  "Customer unreachable by phone",
  "Address not found",
  "Customer refused the order",
  "Customer asked to reschedule",
  "Payment (cash) not available",
  "Other",
] as const;

/** What a customer sees about the delivery on their order page. */
export interface CustomerDelivery {
  status: DeliveryStatus;
  partnerName: string | null;
  partnerPhone: string | null;
  failureReason: string | null;
  /** Six digits, shown only to the order's owner while the parcel is out for delivery. */
  code: string | null;
  codeLocked: boolean;
  codeExpired: boolean;
}

export interface PartnerSelf {
  id: string;
  status: PartnerStatus;
  isOnline: boolean;
  vehicleType: string | null;
  vehicleNumber: string | null;
  serviceCity: string | null;
  idDocumentType: string | null;
  rejectionReason: string | null;
  perDeliveryPayout: number;
  approvedAt: string | null;
  createdAt: string;
}

export interface PartnerMe {
  profile: { fullName: string | null; phone: string | null; email: string; role: "CUSTOMER" | "DELIVERY_PARTNER" | "ADMIN" };
  partner: PartnerSelf | null;
  requirements: { vehicle: boolean; idDocument: boolean };
}

export interface DeliveryJob {
  id: string;
  status: DeliveryStatus;
  assignedAt: string;
  acceptedAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  failureReason: string | null;
  notes: string | null;
  payoutAmount: number | null;
  nextStatuses: DeliveryStatus[];
  order: {
    orderNumber: string;
    paymentMethod: "RAZORPAY" | "COD";
    collectCash: number;
    itemCount: number;
    items: { name: string; size: string | null; colour: string | null; quantity: number }[];
  };
  address: {
    city: string;
    state: string;
    postalCode: string;
    fullName: string | null;
    line1: string | null;
    line2: string | null;
    landmark: string | null;
  };
  customerPhone: string | null;
  otp: { attemptsLeft: number; locked: boolean; expired: boolean; expiresAt: string | null } | null;
  history: { status: DeliveryStatus; reason: string | null; at: string }[];
}

export interface DeliveryStats {
  today: { assigned: number; delivered: number; failed: number };
  pending: number;
  failedAwaitingAction: number;
  deliveredAllTime: number;
  averageMinutesPickupToDoor: number | null;
  earnings: { ratePerDelivery: number; today: number; last30Days: number; allTime: number };
  performance: { date: string; delivered: number; failed: number }[];
}

// ── Admin ──

export interface AdminPartnerRow {
  id: string;
  status: PartnerStatus;
  isOnline: boolean;
  serviceCity: string | null;
  vehicleType: string | null;
  perDeliveryPayout: number;
  createdAt: string;
  user: { id: string; fullName: string | null; email: string; phone: string | null; role: string; status: string };
  active: number;
  delivered: number;
  failed: number;
}

export interface AdminPartnerDetail {
  id: string;
  status: PartnerStatus;
  isOnline: boolean;
  user: AdminPartnerRow["user"];
  serviceCity: string | null;
  vehicleType: string | null;
  vehicleNumber: string | null;
  idDocumentType: string | null;
  idDocumentRef: string | null;
  applicationNote: string | null;
  rejectionReason: string | null;
  perDeliveryPayout: number;
  approvedAt: string | null;
  createdAt: string;
  stats: { delivered: number; failed: number; returnedToOrigin: number; rejected: number; inProgress: number; earningsAllTime: number };
  recent: { id: string; status: DeliveryStatus; assignedAt: string; deliveredAt: string | null; failureReason: string | null; payoutAmount: number; orderId: string; orderNumber: string; city: string }[];
}

export interface AssignablePartner {
  id: string;
  name: string | null;
  phone: string | null;
  isOnline: boolean;
  serviceCity: string | null;
  vehicleType: string | null;
  activeJobs: number;
}

export interface AdminAssignment {
  id: string;
  status: DeliveryStatus;
  partner: { id: string; name: string | null; phone: string | null; vehicleType: string | null; vehicleNumber: string | null };
  assignedAt: string;
  acceptedAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  failureReason: string | null;
  notes: string | null;
  otp: { attemptsLeft: number; locked: boolean; expiresAt: string | null };
  payoutAmount: number;
  history: { status: DeliveryStatus; reason: string | null; at: string }[];
  canReassign: boolean;
  canReissueCode: boolean;
}
