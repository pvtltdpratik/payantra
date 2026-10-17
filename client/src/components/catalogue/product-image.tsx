import Image from "next/image";
import { cn } from "@/lib/utils";

const CDN_HOST = process.env.NEXT_PUBLIC_IMAGE_HOST;

interface Props {
  src: string;
  alt: string;
  sizes: string;
  className?: string;
  priority?: boolean;
}

/**
 * Renders a product image inside a `relative` parent.
 *  - site placeholders (SVG)        → next/image, unoptimised (SVG needs no resizing)
 *  - the configured CDN host         → next/image with full optimisation
 *  - any other absolute https URL    → plain <img>, so an unexpected host never crashes a page
 */
export function ProductImage({ src, alt, sizes, className, priority }: Props) {
  const base = cn("object-cover", className);

  if (src.startsWith("/")) {
    return (
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        priority={priority}
        unoptimized={src.startsWith("/placeholder")}
        className={base}
      />
    );
  }

  let host = "";
  try {
    host = new URL(src).hostname;
  } catch {
    /* fall through to <img> */
  }

  if (CDN_HOST && host === CDN_HOST) {
    return <Image src={src} alt={alt} fill sizes={sizes} priority={priority} className={base} />;
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading={priority ? "eager" : "lazy"} className={cn("absolute inset-0 h-full w-full", base)} />;
}
