import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PrintButton } from "@/components/orders/print-button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError } from "@/lib/api";
import { requireSession } from "@/lib/server-session";
import { formatINR } from "@/lib/utils";
import type { Invoice } from "@/types/commerce";

export const metadata: Metadata = { title: "Invoice", robots: { index: false } };

async function Body({ params }: Pick<PageProps<"/account/orders/[id]/invoice">, "params">) {
  const { id } = await params;
  const { token } = await requireSession(`/account/orders/${id}/invoice`);

  let inv: Invoice;
  try {
    inv = (await api<Invoice>(`/orders/${encodeURIComponent(id)}/invoice`, { token, cache: "no-store" })).data;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) notFound();
    if (err instanceof ApiError && err.status === 409) {
      return (
        <p className="rounded-lg border border-dashed bg-card p-8 text-center text-muted-foreground">
          {err.message}.{" "}
          <Link href={`/account/orders/${id}`} className="text-primary underline">
            Back to the order
          </Link>
        </p>
      );
    }
    throw err;
  }

  return (
    <article className="mx-auto max-w-3xl rounded-xl border bg-card p-8 print:border-0 print:p-0" aria-label={`Invoice ${inv.invoiceNumber}`}>
      <header className="flex flex-wrap items-start justify-between gap-6 border-b pb-6">
        <div>
          <p className="font-serif text-2xl font-semibold tracking-[0.28em] text-primary">PAYANTRA</p>
          <p className="mt-1 text-sm text-muted-foreground">{inv.seller.legalName}</p>
        </div>
        <div className="text-right text-sm">
          <h1 className="text-3xl font-semibold">Tax invoice</h1>
          <p className="mt-1">
            <span className="text-muted-foreground">Invoice no.</span> {inv.invoiceNumber}
          </p>
          <p>
            <span className="text-muted-foreground">Order</span> {inv.orderNumber}
          </p>
          <p>
            <span className="text-muted-foreground">Date</span> {new Date(inv.issuedAt).toLocaleDateString("en-IN", { dateStyle: "long" })}
          </p>
        </div>
      </header>

      <section className="grid gap-6 border-b py-6 text-sm sm:grid-cols-2">
        <div>
          <h2 className="mb-1 font-sans text-xs font-semibold uppercase tracking-widest text-muted-foreground">Bill to</h2>
          <address className="not-italic">
            <strong>{inv.billTo.fullName}</strong>
            <br />
            {[inv.billTo.line1, inv.billTo.line2, inv.billTo.landmark].filter(Boolean).join(", ")}
            <br />
            {inv.billTo.city}, {inv.billTo.state} {inv.billTo.postalCode}
          </address>
        </div>
        <div>
          <h2 className="mb-1 font-sans text-xs font-semibold uppercase tracking-widest text-muted-foreground">Payment</h2>
          <p>{inv.paymentMethod === "COD" ? "Cash on delivery" : "Paid online"}</p>
          {inv.totals.couponCode && <p className="text-muted-foreground">Coupon: {inv.totals.couponCode}</p>}
        </div>
      </section>

      <div className="overflow-x-auto py-6">
        <table className="w-full text-sm">
          <caption className="sr-only">Invoice lines</caption>
          <thead className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="py-2 pr-3 font-medium">Item</th>
              <th className="px-3 py-2 text-right font-medium">Qty</th>
              <th className="px-3 py-2 text-right font-medium">Rate</th>
              <th className="px-3 py-2 text-right font-medium">Taxable value</th>
              <th className="px-3 py-2 text-right font-medium">GST</th>
              <th className="py-2 pl-3 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((l) => (
              <tr key={l.sku} className="border-b align-top" data-testid="invoice-line">
                <td className="py-3 pr-3">
                  {l.description}
                  <span className="block text-xs text-muted-foreground">SKU {l.sku}</span>
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{l.quantity}</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatINR(l.unitPrice)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatINR(l.taxableValue)}</td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {formatINR(l.gst)}
                  <span className="block text-xs text-muted-foreground">@ {l.gstRate}%</span>
                </td>
                <td className="py-3 pl-3 text-right tabular-nums">{formatINR(l.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="ml-auto max-w-xs space-y-1 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Subtotal</dt>
          <dd className="tabular-nums">{formatINR(inv.totals.subtotal)}</dd>
        </div>
        {inv.totals.discount > 0 && (
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Discount</dt>
            <dd className="tabular-nums">−{formatINR(inv.totals.discount)}</dd>
          </div>
        )}
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Delivery</dt>
          <dd className="tabular-nums">{inv.totals.shipping ? formatINR(inv.totals.shipping) : "Free"}</dd>
        </div>
        <div className="flex justify-between border-t pt-2 text-base font-semibold">
          <dt>Total</dt>
          <dd className="tabular-nums" data-testid="invoice-total">
            {formatINR(inv.totals.grandTotal)}
          </dd>
        </div>
        <p className="pt-1 text-right text-xs text-muted-foreground">Includes GST of {formatINR(inv.totals.gst)} on goods.</p>
      </dl>

      <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-xs text-muted-foreground print:hidden">
        <span>{inv.seller.note}</span>
        <PrintButton />
      </footer>
    </article>
  );
}

export default function InvoicePage({ params }: PageProps<"/account/orders/[id]/invoice">) {
  return (
    <>
      <Link href={`/account/orders`} className="mb-4 inline-block text-sm text-muted-foreground hover:text-primary print:hidden">
        ← All orders
      </Link>
      <Suspense fallback={<Skeleton className="h-[40rem]" />}>
        <Body params={params} />
      </Suspense>
    </>
  );
}
