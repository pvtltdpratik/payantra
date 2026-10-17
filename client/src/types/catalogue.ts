export type Gender = "WOMEN" | "MEN" | "UNISEX";
export type StockStatus = "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";
export type ProductSort = "newest" | "price_asc" | "price_desc" | "popularity" | "rating";

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface MediaImage {
  url: string;
  alt: string | null;
}

/** Prices are integer paise. */
export interface ProductCardData {
  id: string;
  name: string;
  slug: string;
  gender: Gender;
  fabric: string | null;
  category: { name: string; slug: string };
  basePrice: number;
  salePrice: number | null;
  price: number;
  discountPercent: number;
  isFeatured: boolean;
  isNewArrival: boolean;
  ratingAverage: number;
  ratingCount: number;
  image: MediaImage | null;
  hoverImage: MediaImage | null;
  colours: string[];
  inStock: boolean;
}

export interface ProductVariantData {
  id: string;
  sku: string;
  size: string | null;
  colour: string | null;
  fabric: string | null;
  design: string | null;
  price: number;
  available: number;
  stockStatus: StockStatus;
}

export interface ProductDetailData extends ProductCardData {
  description: string;
  careNotes: string | null;
  occasion: string | null;
  taxRatePercent: number;
  images: (MediaImage & { id: string })[];
  variants: ProductVariantData[];
  options: { sizes: string[]; colours: string[]; fabrics: string[] };
  collections: { name: string; slug: string }[];
  breadcrumb: { name: string; slug: string }[];
}

export interface CategoryNode {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  gender: Gender | null;
  productCount: number;
  children: CategoryNode[];
}

export interface CategoryDetail {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  gender: Gender | null;
  breadcrumb: { name: string; slug: string }[];
  children: { id: string; name: string; slug: string; imageUrl: string | null; productCount: number }[];
}

export interface Facets {
  sizes: string[];
  colours: string[];
  fabrics: string[];
  /** paise */
  price: { min: number; max: number };
}

export interface Suggestions {
  products: { name: string; slug: string; price: number; image: MediaImage | null }[];
  categories: { name: string; slug: string }[];
}
