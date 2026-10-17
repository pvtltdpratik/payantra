/**
 * Tiny pub/sub so any component that changes the cart (add to cart, quantity, checkout) can tell the
 * header badge to refresh, without threading state through every page.
 */
const EVENT = "payantra:cart-changed";

export function notifyCartChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

export function onCartChanged(handler: () => void): () => void {
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
