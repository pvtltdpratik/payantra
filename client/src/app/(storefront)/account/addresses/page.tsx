import type { Metadata } from "next";
import { Suspense } from "react";
import { AddressesManager } from "@/components/account/addresses-manager";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { requireSession } from "@/lib/server-session";
import type { Address } from "@/types/commerce";

export const metadata: Metadata = { title: "My addresses", robots: { index: false } };

async function Body() {
  const { token } = await requireSession("/account/addresses");
  const { data } = await api<Address[]>("/addresses", { token, cache: "no-store" });
  return <AddressesManager initial={data} />;
}

export default function AddressesPage() {
  return (
    <>
      <h1 className="mb-6 text-4xl font-semibold text-primary">Addresses</h1>
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Body />
      </Suspense>
    </>
  );
}
