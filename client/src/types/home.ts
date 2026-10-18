export interface PublicBanner {
  id: string;
  title: string;
  subtitle: string | null;
  imageUrl: string;
  linkUrl: string | null;
  placement: "ANNOUNCEMENT" | "HOME_HERO" | "HOME_STRIP" | "CATEGORY";
}

export interface PublicCollection {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  isSeasonal: boolean;
}

export interface FeaturedReview {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  createdAt: string;
  reviewer: string;
  productName: string;
  productSlug: string;
}

/** The store rules a shopper may read; the policy pages and the home page quote exactly these. */
export interface PublicSettings {
  shipping: { flatRate: number; freeThreshold: number };
  returns: { returnWindowDays: number; replacementEnabled: boolean };
  payments: { codEnabled: boolean; codMaxOrder: number };
}
