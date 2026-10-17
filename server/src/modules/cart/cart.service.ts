import { prisma } from '../../config/prisma.js';
import { AppError } from '../../lib/errors.js';
import { getSettings } from '../settings/settings.service.js';
import { resolveCoupon } from '../coupons/coupons.service.js';
import { loadBasket, MAX_PER_LINE, priceBasket } from './basket.js';

/** The shopper-facing cart: lines with live stock, plus server-computed totals. */
export async function getCartView(userId: string) {
  const settings = await getSettings();
  const basket = await loadBasket(prisma, userId);
  const priced = await priceBasket(prisma, userId, basket, settings.shipping);
  const p = priced.pricing;

  const payableQty = new Map(priced.payable.map((l) => [l.variantId, l.quantity]));
  const items = basket.lines.map((l) => {
    const qty = payableQty.get(l.variantId) ?? 0;
    return {
      variantId: l.variantId,
      productId: l.productId,
      slug: l.slug,
      name: l.name,
      image: l.image,
      sku: l.sku,
      size: l.size,
      colour: l.colour,
      fabric: l.fabric,
      unitPrice: l.unitPrice,
      quantity: l.quantity,
      lineTotal: l.unitPrice * l.quantity,
      available: Math.min(l.available, MAX_PER_LINE),
      maxQuantity: Math.min(l.available, MAX_PER_LINE),
      issue: l.issue,
      /** Quantity actually priced (differs from `quantity` when stock has dropped). */
      pricedQuantity: qty,
    };
  });

  const merchandise = p ? p.subtotal - p.discountTotal : 0;
  return {
    items,
    itemCount: basket.lines.reduce((n, l) => n + l.quantity, 0),
    canCheckout: priced.canCheckout,
    pricing: {
      subtotal: p?.subtotal ?? 0,
      discountTotal: p?.discountTotal ?? 0,
      shippingTotal: p?.shippingTotal ?? 0,
      taxTotal: p?.taxTotal ?? 0,
      grandTotal: p?.grandTotal ?? 0,
      couponCode: priced.coupon?.code ?? null,
      couponNote: priced.couponNote,
      /** How much more to spend for free shipping; 0 when already free. */
      freeShippingRemaining: p && p.shippingTotal > 0 ? Math.max(0, settings.shipping.freeThreshold - merchandise) : 0,
    },
  };
}

export async function cartCount(userId: string): Promise<number> {
  const agg = await prisma.cartItem.aggregate({ where: { cart: { userId } }, _sum: { quantity: true } });
  return agg._sum.quantity ?? 0;
}

/** Looks up a variant a shopper may buy right now, with its free stock. */
async function buyableVariant(variantId: string) {
  const v = await prisma.productVariant.findUnique({
    where: { id: variantId },
    include: { inventory: true, product: { select: { status: true, category: { select: { isActive: true } } } } },
  });
  if (!v || !v.isActive || v.product.status !== 'ACTIVE' || !v.product.category.isActive) {
    throw AppError.unprocessable('This item is no longer available');
  }
  return { id: v.id, available: Math.max(0, (v.inventory?.onHand ?? 0) - (v.inventory?.reserved ?? 0)) };
}

function assertQuantityAllowed(quantity: number, available: number) {
  if (available === 0) throw AppError.conflict('This item is sold out', { available: 0 });
  if (quantity > MAX_PER_LINE) throw AppError.unprocessable(`You can order at most ${MAX_PER_LINE} of one item`);
  if (quantity > available) {
    throw AppError.conflict(`Only ${available} left in stock`, { available });
  }
}

async function cartIdFor(userId: string): Promise<string> {
  const cart = await prisma.cart.upsert({ where: { userId }, create: { userId }, update: {}, select: { id: true } });
  return cart.id;
}

/** Adds to the quantity already in the cart. */
export async function addItem(userId: string, variantId: string, quantity: number) {
  const variant = await buyableVariant(variantId);
  const cartId = await cartIdFor(userId);
  const existing = await prisma.cartItem.findUnique({ where: { cartId_variantId: { cartId, variantId } } });
  const next = (existing?.quantity ?? 0) + quantity;
  assertQuantityAllowed(next, variant.available);

  await prisma.cartItem.upsert({
    where: { cartId_variantId: { cartId, variantId } },
    create: { cartId, variantId, quantity: next },
    update: { quantity: next },
  });
}

/** Sets an exact quantity for a line already in the cart. */
export async function setQuantity(userId: string, variantId: string, quantity: number) {
  const cart = await prisma.cart.findUnique({ where: { userId }, select: { id: true } });
  const item = cart && (await prisma.cartItem.findUnique({ where: { cartId_variantId: { cartId: cart.id, variantId } } }));
  if (!cart || !item) throw AppError.notFound('That item is not in your cart');

  const variant = await buyableVariant(variantId);
  assertQuantityAllowed(quantity, variant.available);
  await prisma.cartItem.update({ where: { id: item.id }, data: { quantity } });
}

export async function removeItem(userId: string, variantId: string) {
  await prisma.cartItem.deleteMany({ where: { variantId, cart: { userId } } });
}

export async function clearCart(userId: string) {
  await prisma.$transaction([
    prisma.cartItem.deleteMany({ where: { cart: { userId } } }),
    prisma.cart.updateMany({ where: { userId }, data: { couponCode: null } }),
  ]);
}

export async function applyCoupon(userId: string, code: string) {
  const coupon = await resolveCoupon(prisma, code, userId);
  const cartId = await cartIdFor(userId);
  await prisma.cart.update({ where: { id: cartId }, data: { couponCode: coupon.code } });
}

export async function removeCoupon(userId: string) {
  await prisma.cart.updateMany({ where: { userId }, data: { couponCode: null } });
}
