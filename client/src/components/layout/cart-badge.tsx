"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ShoppingBag } from "lucide-react";
import { authedApi } from "@/lib/client-api";
import { onCartChanged } from "@/lib/cart-events";
import { createClient } from "@/lib/supabase/client";

/** Shopping-bag link with a live item count. Signed-out visitors simply see the bag without a count. */
export function CartBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const { data } = await createClient().auth.getSession();
        if (!data.session) return setCount(0);
        const res = await authedApi<{ count: number }>("/cart/summary");
        if (!cancelled) setCount(res.data.count);
      } catch {
        /* the badge is decoration; never surface an error for it */
      }
    }
    void refresh();
    const off = onCartChanged(() => void refresh());
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  return (
    <Link
      href="/cart"
      className="relative inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-muted"
      aria-label={count > 0 ? `Shopping bag, ${count} item${count === 1 ? "" : "s"}` : "Shopping bag"}
    >
      <ShoppingBag aria-hidden className="size-5" />
      {count > 0 && (
        <span
          aria-hidden
          data-testid="cart-count"
          className="absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] font-semibold leading-5 text-primary-foreground"
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
