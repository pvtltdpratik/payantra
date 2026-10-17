"use client";

import { SORT_LABELS } from "@/lib/catalogue-params";
import type { ProductSort } from "@/types/catalogue";

/**
 * Sort control inside a plain GET <form>. With JavaScript it submits on change;
 * without it, the form still works through its submit button.
 */
export function SortSelect({ value }: { value: ProductSort }) {
  return (
    <select
      name="sort"
      defaultValue={value}
      aria-label="Sort products"
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
      className="h-10 rounded-md border border-input bg-card px-3 text-sm"
    >
      {(Object.keys(SORT_LABELS) as ProductSort[]).map((s) => (
        <option key={s} value={s}>
          {SORT_LABELS[s]}
        </option>
      ))}
    </select>
  );
}
