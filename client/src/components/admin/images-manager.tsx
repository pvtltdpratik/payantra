"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authedApi } from "@/lib/client-api";
import type { AdminImage } from "@/types/admin";
import { describeError } from "./api-error-message";

export function ImagesManager({ productId, images }: { productId: string; images: AdminImage[] }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [alt, setAlt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-xl border bg-card p-5 sm:p-6" aria-labelledby="img-heading">
      <h2 id="img-heading" className="text-2xl font-semibold">
        Images <span className="text-base font-normal text-muted-foreground">({images.length}/10)</span>
      </h2>
      {error && (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {images.length === 0 ? (
        <p className="text-sm text-muted-foreground">No images yet. A product needs at least one to go live.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {images.map((img) => (
            <li key={img.id} className="space-y-2">
              <div className="relative aspect-[4/5] overflow-hidden rounded-md border bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt={img.alt ?? ""} className="h-full w-full object-cover" />
                {img.isPrimary && (
                  <span className="absolute left-1.5 top-1.5 rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary-foreground">
                    Primary
                  </span>
                )}
              </div>
              <div className="flex gap-1">
                {!img.isPrimary && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => run(() => authedApi(`/admin/images/${img.id}`, { method: "PATCH", body: { isPrimary: true } }))}
                  >
                    <Star aria-hidden /> Make primary
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Delete image"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm("Delete this image?")) run(() => authedApi(`/admin/images/${img.id}`, { method: "DELETE" }));
                  }}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {images.length < 10 && (
        <form
          className="grid gap-3 border-t pt-4 sm:grid-cols-[2fr_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (!url.trim()) return;
            run(async () => {
              await authedApi(`/admin/products/${productId}/images`, {
                method: "POST",
                body: { url: url.trim(), alt: alt.trim() || null, isPrimary: false },
              });
              setUrl("");
              setAlt("");
            });
          }}
        >
          <label className="space-y-1.5 text-sm font-medium">
            Image URL
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className="h-10 font-normal" />
          </label>
          <label className="space-y-1.5 text-sm font-medium">
            Alt text
            <Input value={alt} onChange={(e) => setAlt(e.target.value)} className="h-10 font-normal" />
          </label>
          <Button type="submit" disabled={busy || !url.trim()} className="h-10">
            Add image
          </Button>
        </form>
      )}
    </section>
  );
}
