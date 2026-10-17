/**
 * Business flows the specs set up through the real API (the same calls the UI makes), so a spec can focus on the
 * screen it is testing instead of re-driving checkout every time.
 */

/** A product whose default variant has at least `min` units, because the seed gives each variant random stock. */
export async function findStockedProduct(stack, min = 4) {
  const list = await (await fetch(`${stack.api}/products?pageSize=48`)).json();
  for (const item of list.data) {
    const d = (await (await fetch(`${stack.api}/products/${item.slug}`)).json()).data;
    const v = d.variants.find((x) => x.stockStatus !== 'OUT_OF_STOCK') ?? d.variants[0];
    if (v && v.available >= min) return { id: d.id, slug: d.slug, name: d.name, variantId: v.id, price: v.price };
  }
  throw new Error(`the seeded catalogue has no product with ${min}+ units of its default variant`);
}

const ADDRESS = { fullName: 'Asha Rao', phone: '9876543210', line1: '12 Lotus Apartments, MG Road', city: 'Pune', state: 'Maharashtra', postalCode: '411001' };

async function addressFor(stack, who) {
  const existing = (await stack.apiAs(who, 'GET', '/addresses')).body.data;
  if (existing.length) return existing[0].id;
  return (await stack.apiAs(who, 'POST', '/addresses', { ...ADDRESS, fullName: stack.accounts[who].fullName, isDefault: true })).body.data.id;
}

let keySeq = 0;

/** A customer buys `product` and the order is paid (online) or placed (COD). Returns the order's id and number. */
export async function placeOrder(stack, who, product, { cod = false, quantity = 1 } = {}) {
  await stack.apiAs(who, 'DELETE', '/cart');
  const added = await stack.apiAs(who, 'POST', '/cart/items', { variantId: product.variantId, quantity });
  if (added.status >= 300) throw new Error(`could not add to bag: ${JSON.stringify(added.body)}`);
  const addressId = await addressFor(stack, who);
  const placed = await stack.apiAs(who, 'POST', '/checkout', { addressId, paymentMethod: cod ? 'COD' : 'RAZORPAY', idempotencyKey: `e2e-${Date.now()}-${++keySeq}-${who}` });
  if (placed.status >= 300) throw new Error(`checkout failed: ${JSON.stringify(placed.body)}`);
  const order = placed.body.data.order;
  if (!cod) {
    const paid = await stack.razorpaySim('pay', { order_id: placed.body.data.payment.razorpayOrderId, outcome: 'captured' });
    const verified = await stack.apiAs(who, 'POST', '/payments/verify', {
      razorpay_order_id: paid.razorpay_order_id,
      razorpay_payment_id: paid.razorpay_payment_id,
      razorpay_signature: paid.razorpay_signature,
    });
    if (verified.body?.data?.status !== 'PAID') throw new Error(`payment did not verify: ${JSON.stringify(verified.body)}`);
  }
  return { id: order.id, orderNumber: order.orderNumber, grandTotal: order.grandTotal };
}

/** Walks an order, as an admin would, up to PACKED (ready for a delivery partner). COD orders are confirmed first. */
export async function packOrder(stack, orderId, { cod = false } = {}) {
  const steps = [...(cod ? ['PAYMENT_CONFIRMED'] : []), 'PROCESSING', 'PACKED'];
  for (const status of steps) {
    const r = await stack.apiAs('admin', 'PATCH', `/admin/orders/${orderId}/status`, { status });
    if (r.status !== 200) throw new Error(`could not move the order to ${status}: ${JSON.stringify(r.body)}`);
  }
}

export const orderStatus = async (stack, id) => (await stack.apiAs('admin', 'GET', `/admin/orders/${id}`)).body.data;

/** Polls until `fn` returns something truthy (or gives up and returns the last value). */
export async function eventually(fn, { timeout = 8000, every = 250 } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, every));
  }
}

/** Moves an order, as an admin would, all the way to DELIVERED (no delivery partner involved). */
export async function deliverOrder(stack, orderId, { cod = false } = {}) {
  await packOrder(stack, orderId, { cod });
  for (const status of ['SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
    const r = await stack.apiAs('admin', 'PATCH', `/admin/orders/${orderId}/status`, { status });
    if (r.status !== 200) throw new Error(`could not move the order to ${status}: ${JSON.stringify(r.body)}`);
  }
}
