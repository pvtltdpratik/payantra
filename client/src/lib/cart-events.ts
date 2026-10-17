/**
 * Tiny pub/sub so any component that changes something a header badge displays (the cart, the unread
 * notifications) can tell the badge to refresh, without threading state through every page.
 */
const CART = "payantra:cart-changed";
const NOTIFICATIONS = "payantra:notifications-changed";

function emit(name: string) {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(name));
}
function listen(name: string, handler: () => void): () => void {
  window.addEventListener(name, handler);
  return () => window.removeEventListener(name, handler);
}

export const notifyCartChanged = () => emit(CART);
export const onCartChanged = (handler: () => void) => listen(CART, handler);

export const notifyNotificationsChanged = () => emit(NOTIFICATIONS);
export const onNotificationsChanged = (handler: () => void) => listen(NOTIFICATIONS, handler);
