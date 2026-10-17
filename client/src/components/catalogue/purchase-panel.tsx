"use client";

import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { swatchFor } from "@/lib/colours";
import { cn } from "@/lib/utils";
import type { ProductDetailData, ProductVariantData } from "@/types/catalogue";
import { AddToBag } from "./add-to-bag";
import { Price } from "./price";
import { WishlistButton } from "./wishlist-button";

const norm = (v: string | null) => v ?? "";

function pickInitial(variants: ProductVariantData[]): ProductVariantData | undefined {
  return variants.find((v) => v.stockStatus !== "OUT_OF_STOCK") ?? variants[0];
}

export function PurchasePanel({ product }: { product: ProductDetailData }) {
  const { variants, options } = product;
  const initial = useMemo(() => pickInitial(variants), [variants]);
  const [colour, setColour] = useState<string | null>(initial?.colour ?? null);
  const [size, setSize] = useState<string | null>(initial?.size ?? null);

  const forColour = (c: string | null) => variants.filter((v) => norm(v.colour) === norm(c));
  const selected = variants.find((v) => norm(v.colour) === norm(colour) && norm(v.size) === norm(size));

  // A colour is "available" if any of its sizes can be bought.
  const colourAvailable = (c: string) => forColour(c).some((v) => v.stockStatus !== "OUT_OF_STOCK");
  const sizeVariant = (s: string) => forColour(colour).find((v) => norm(v.size) === s);

  function chooseColour(c: string) {
    setColour(c);
    // Keep the size when the new colour has it; otherwise move to its first buyable size.
    const next = forColour(c);
    if (!next.some((v) => norm(v.size) === norm(size))) {
      setSize((next.find((v) => v.stockStatus !== "OUT_OF_STOCK") ?? next[0])?.size ?? null);
    }
  }

  const price = selected?.price ?? product.price;
  const showSale = selected ? selected.price === product.price : true;

  return (
    <div className="space-y-6">
      <div>
        <Price
          size="lg"
          price={price}
          basePrice={showSale ? product.basePrice : undefined}
          salePrice={showSale ? product.salePrice : undefined}
          discountPercent={showSale ? product.discountPercent : undefined}
        />
        <p className="mt-1 text-xs text-muted-foreground">Inclusive of all taxes</p>
      </div>

      {options.colours.length > 0 && (
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">
            Colour: <span className="font-normal text-muted-foreground">{colour}</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {options.colours.map((c) => {
              const swatch = swatchFor(c);
              const available = colourAvailable(c);
              const isSelected = c === colour;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => chooseColour(c)}
                  aria-pressed={isSelected}
                  aria-label={`${c}${available ? "" : " (sold out)"}`}
                  title={c}
                  className={cn(
                    "relative inline-flex h-10 min-w-10 items-center justify-center rounded-full border-2 px-3 text-sm",
                    isSelected ? "border-primary" : "border-input hover:border-foreground/40",
                    !available && "opacity-50",
                  )}
                >
                  {swatch ? (
                    <span
                      aria-hidden
                      className="size-6 rounded-full border border-black/10"
                      style={{ backgroundColor: swatch }}
                    />
                  ) : (
                    c
                  )}
                  {isSelected && swatch && (
                    <Check aria-hidden className={cn("absolute size-3.5", swatch && "text-white mix-blend-difference")} />
                  )}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      {options.sizes.length > 0 && (
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">
            Size: <span className="font-normal text-muted-foreground">{size}</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {options.sizes.map((s) => {
              const v = sizeVariant(s);
              const soldOut = !v || v.stockStatus === "OUT_OF_STOCK";
              return (
                <button
                  key={s}
                  type="button"
                  disabled={!v}
                  onClick={() => setSize(s)}
                  aria-pressed={s === size}
                  aria-label={`Size ${s}${soldOut ? " (sold out)" : ""}`}
                  className={cn(
                    "h-10 min-w-12 rounded-md border px-3 text-sm",
                    s === size ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card hover:border-foreground/40",
                    soldOut && s !== size && "text-muted-foreground line-through",
                    !v && "cursor-not-allowed opacity-40",
                  )}
                >
                  {s}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      <div role="status" aria-live="polite" className="min-h-6 text-sm">
        {!selected ? (
          <span className="text-muted-foreground">This combination is not available.</span>
        ) : selected.stockStatus === "OUT_OF_STOCK" ? (
          <span className="font-medium text-destructive">Sold out in this size</span>
        ) : selected.stockStatus === "LOW_STOCK" ? (
          <span className="font-medium text-warning">Only {selected.available} left — order soon</span>
        ) : (
          <span className="font-medium text-success">In stock</span>
        )}
      </div>

      <AddToBag variant={selected} productName={product.name} />
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        {selected ? <span>SKU: {selected.sku}</span> : <span />}
        <span className="inline-flex items-center gap-2">
          Save for later
          <WishlistButton productId={product.id} productName={product.name} className="border" />
        </span>
      </div>
    </div>
  );
}
