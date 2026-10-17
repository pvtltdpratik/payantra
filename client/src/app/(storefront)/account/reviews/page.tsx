import type { Metadata } from "next";
import { Suspense } from "react";
import { MyReviewsView } from "@/components/reviews/my-reviews";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { requireSession } from "@/lib/server-session";
import type { MyReviews } from "@/types/reviews";

export const metadata: Metadata = { title: "My reviews", robots: { index: false } };

async function Body() {
  const { token } = await requireSession("/account/reviews");
  const { data } = await api<MyReviews>("/reviews/mine", { token, cache: "no-store" });
  return <MyReviewsView data={data} />;
}

export default function AccountReviewsPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-4xl font-semibold text-primary">My reviews</h1>
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Body />
      </Suspense>
    </div>
  );
}
