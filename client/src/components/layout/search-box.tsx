"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Search } from "lucide-react";
import { formatINR } from "@/lib/utils";
import { fetchSuggestions } from "@/services/search";
import type { Suggestions } from "@/types/catalogue";

export function SearchBox() {
  const router = useRouter();
  const listId = useId();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Suggestions | null>(null);
  const boxRef = useRef<HTMLFormElement>(null);

  // Debounced, cancellable lookup — an older response can never overwrite a newer one.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return; // results are hidden below 2 characters (see `hasResults`)
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetchSuggestions(term, controller.signal)
        .then((d) => setData(d))
        .catch(() => {
          /* aborted or offline: suggestions are optional */
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const hasResults =
    q.trim().length >= 2 && !!data && (data.products.length > 0 || data.categories.length > 0);
  const close = () => {
    setOpen(false);
    setQ("");
  };

  return (
    <form
      ref={boxRef}
      role="search"
      action="/search"
      className="relative w-full"
      onSubmit={(e) => {
        e.preventDefault();
        const term = q.trim();
        if (term) {
          setOpen(false);
          router.push(`/search?q=${encodeURIComponent(term)}`);
        }
      }}
    >
      <label htmlFor={`${listId}-input`} className="sr-only">
        Search products
      </label>
      <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        id={`${listId}-input`}
        name="q"
        type="search"
        autoComplete="off"
        placeholder="Search sarees, kurtas…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && hasResults}
        aria-controls={listId}
        className="h-10 w-full rounded-full border border-input bg-card pl-9 pr-4 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
      />

      {open && hasResults && (
        <div
          id={listId}
          className="absolute left-0 right-0 top-12 z-50 max-h-[70vh] overflow-auto rounded-lg border bg-popover p-2 shadow-lg"
        >
          {data!.categories.length > 0 && (
            <div className="mb-2">
              <p className="px-2 py-1 text-[11px] uppercase tracking-widest text-muted-foreground">Categories</p>
              <ul>
                {data!.categories.map((c) => (
                  <li key={c.slug}>
                    <Link href={`/category/${c.slug}`} onClick={close} className="block rounded px-2 py-2 text-sm hover:bg-muted">
                      {c.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data!.products.length > 0 && (
            <div>
              <p className="px-2 py-1 text-[11px] uppercase tracking-widest text-muted-foreground">Products</p>
              <ul>
                {data!.products.map((p) => (
                  <li key={p.slug}>
                    <Link
                      href={`/product/${p.slug}`}
                      onClick={close}
                      className="flex items-center gap-3 rounded px-2 py-2 hover:bg-muted"
                    >
                      {p.image && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.image.url} alt="" className="size-10 shrink-0 rounded object-cover" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{p.name}</span>
                        <span className="block text-xs text-muted-foreground">{formatINR(p.price)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Link
            href={`/search?q=${encodeURIComponent(q.trim())}`}
            onClick={() => setOpen(false)}
            className="mt-1 block rounded px-2 py-2 text-center text-sm font-medium text-primary hover:bg-muted"
          >
            See all results for “{q.trim()}”
          </Link>
        </div>
      )}
    </form>
  );
}
