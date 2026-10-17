"use client";

import { useState } from "react";
import { ZoomIn } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ProductImage } from "./product-image";

interface Img {
  id: string;
  url: string;
  alt: string | null;
}

export function ProductGallery({ images, name }: { images: Img[]; name: string }) {
  const [active, setActive] = useState(0);
  const [origin, setOrigin] = useState("50% 50%");

  if (images.length === 0) {
    return <div className="grid aspect-[4/5] place-items-center rounded-lg bg-muted text-sm text-muted-foreground">No image</div>;
  }
  const current = images[Math.min(active, images.length - 1)];
  const altFor = (img: Img, i: number) => img.alt ?? `${name} — view ${i + 1}`;

  return (
    <div className="flex flex-col-reverse gap-3 sm:flex-row">
      {images.length > 1 && (
        <ul className="flex gap-2 sm:w-20 sm:flex-col" aria-label="Product images">
          {images.map((img, i) => (
            <li key={img.id} className="w-16 shrink-0 sm:w-full">
              <button
                type="button"
                onClick={() => setActive(i)}
                aria-label={`Show image ${i + 1} of ${images.length}`}
                aria-pressed={i === active}
                className={cn(
                  "relative block aspect-[4/5] w-full overflow-hidden rounded-md border-2 bg-muted",
                  i === active ? "border-primary" : "border-transparent hover:border-border",
                )}
              >
                <ProductImage src={img.url} alt="" sizes="80px" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <Dialog>
        <DialogTrigger
          className="group relative block aspect-[4/5] w-full cursor-zoom-in overflow-hidden rounded-lg bg-muted"
          aria-label="Open image in full size"
          onMouseMove={(e: React.MouseEvent<HTMLElement>) => {
            const r = e.currentTarget.getBoundingClientRect();
            setOrigin(`${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`);
          }}
        >
          <div
            className="absolute inset-0 transition-transform duration-200 ease-out lg:group-hover:scale-[1.8]"
            style={{ transformOrigin: origin }}
          >
            <ProductImage
              src={current.url}
              alt={altFor(current, active)}
              sizes="(min-width:1024px) 40vw, 90vw"
              priority
            />
          </div>
          <span className="pointer-events-none absolute bottom-3 right-3 grid size-9 place-items-center rounded-full bg-background/90 shadow">
            <ZoomIn aria-hidden className="size-4" />
          </span>
        </DialogTrigger>

        <DialogContent className="max-w-3xl p-2 sm:max-w-3xl">
          <DialogTitle className="sr-only">{name}</DialogTitle>
          <div className="relative mx-auto aspect-[4/5] max-h-[85vh] w-full overflow-hidden rounded-md">
            <ProductImage src={current.url} alt={altFor(current, active)} sizes="(min-width:768px) 48rem, 100vw" className="object-contain" />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
