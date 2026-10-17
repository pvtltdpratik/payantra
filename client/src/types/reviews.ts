export interface ReviewSummary {
  average: number;
  count: number;
  histogram: Record<1 | 2 | 3 | 4 | 5, number>;
}

export interface PublicReview {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  createdAt: string;
  /** "Asha R." — never a full name, e-mail or id. */
  reviewer: string;
  verifiedPurchase: boolean;
}

export interface ProductReviews {
  summary: ReviewSummary;
  items: PublicReview[];
  total: number;
}

export interface ToReview {
  orderId: string;
  orderNumber: string;
  productId: string;
  name: string;
  slug: string;
  image: string | null;
}

export interface MyReview {
  id: string;
  productId: string;
  orderId: string;
  rating: number;
  title: string | null;
  body: string | null;
  isVisible: boolean;
  createdAt: string;
  name: string;
  slug: string | null;
}

export interface MyReviews {
  toReview: ToReview[];
  reviewed: MyReview[];
}

export interface RecentlyViewedProduct {
  id: string;
}
