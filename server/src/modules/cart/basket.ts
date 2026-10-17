import { prisma, Prisma } from '../../config/prisma.js';
import { computePricing, type PricingCoupon, type PricingResult, type ShippingRule } from '../../lib/pricing.js';
import { tryResolveCoupon } from '../coupons/coupons.service.js';

type Db = Prisma.TransactionClient | typeof prisma;

export const MAX_PER_LINE = 10;

export type LineIssue = 'UNAVAILABLE' | 'OUT_OF_STOCK' | 'INSUFFICIENT_STOCK';

export interface BasketLine {
  variantId: string;
  productId: string;
  slug: string;
  name: string;
  image: { url: string; alt: string | null } | null;
  sku: string;
  size: string | null;
  colour: string | null;
  fabric: string | null;
  /** Tax-inclusive price of one unit, resolved on the server (variant override, else product price). */
  unitPrice: number;
  taxRatePercent: number;
  quantity: number;
  /** Units currently free to buy: onHand − reserved. Zero when the product is not on sale. */
  available: number;
  purchasable: boolean;
  issue: LineIssue | null;
}

export interface Basket {
  cartId: string | null;
  couponCode: string | null;
  lines: BasketLine[];
}

const lineInclude = {
  variant: {
    include: {
      inventory: true,
      product: {
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          effectivePrice: true,
          taxRatePercent: true,
          category: { select: { isActive: true } },
          images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }], take: 1, select: { url: true, alt: true } },
        },
      },
    },
  },
} satisfies Prisma.CartItemInclude;

/** Loads the user's cart with live price and stock for every line. Never mutates. */
export async function loadBasket(db: Db, userId: string): Promise<Basket> {
  const cart = await db.cart.findUnique({
    where: { userId },
    include: { items: { include: lineInclude, orderBy: { createdAt: 'asc' } } },
  });
  if (!cart) return { cartId: null, couponCode: null, lines: [] };

  const lines: BasketLine[] = cart.items.map((item) => {
    const v = item.variant;
    const p = v.product;
    const purchasable = p.status === 'ACTIVE' && p.category.isActive && v.isActive;
    const available = purchasable ? Math.max(0, (v.inventory?.onHand ?? 0) - (v.inventory?.reserved ?? 0)) : 0;
    const issue: LineIssue | null = !purchasable
      ? 'UNAVAILABLE'
      : available === 0
        ? 'OUT_OF_STOCK'
        : item.quantity > available
          ? 'INSUFFICIENT_STOCK'
          : null;

    return {
      variantId: v.id,
      productId: p.id,
      slug: p.slug,
      name: p.name,
      image: p.images[0] ?? null,
      sku: v.sku,
      size: v.size,
      colour: v.colour,
      fabric: v.fabric,
      unitPrice: v.priceOverride ?? p.effectivePrice,
      taxRatePercent: Number(p.taxRatePercent),
      quantity: item.quantity,
      available,
      purchasable,
      issue,
    };
  });

  return { cartId: cart.id, couponCode: cart.couponCode, lines };
}

export interface PricedBasket {
  /** Lines that can be bought right now, quantities clamped to available stock. */
  payable: BasketLine[];
  pricing: PricingResult | null;
  coupon: PricingCoupon | null;
  couponNote: string | null;
  /** True only when every line is purchasable in full — the gate for checkout. */
  canCheckout: boolean;
}

/** Prices what can actually be bought. A coupon that has gone stale is dropped, with an explanation. */
export async function priceBasket(db: Db, userId: string, basket: Basket, shipping: ShippingRule): Promise<PricedBasket> {
  const payable = basket.lines
    .filter((l) => l.purchasable && l.available > 0)
    .map((l) => ({ ...l, quantity: Math.min(l.quantity, l.available) }));

  let coupon: PricingCoupon | null = null;
  let couponNote: string | null = null;
  if (basket.couponCode) {
    const r = await tryResolveCoupon(db, basket.couponCode, userId);
    coupon = r.coupon;
    couponNote = r.note;
  }

  const pricing =
    payable.length > 0
      ? computePricing(
          payable.map((l) => ({ variantId: l.variantId, unitPrice: l.unitPrice, quantity: l.quantity, taxRatePercent: l.taxRatePercent })),
          coupon,
          shipping,
        )
      : null;

  if (pricing?.couponNote) couponNote = pricing.couponNote;

  return {
    payable,
    pricing,
    coupon,
    couponNote,
    canCheckout: basket.lines.length > 0 && basket.lines.every((l) => l.issue === null),
  };
}
