import { Skeleton } from "@/components/ui/skeleton";

export function ListingSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid gap-8 lg:grid-cols-[17rem_1fr]" aria-busy="true" aria-label="Loading products">
      <div className="hidden space-y-4 lg:block">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: count }, (_, i) => (
          <li key={i} className="space-y-3">
            <Skeleton className="aspect-[4/5] w-full" />
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-5 w-4/5" />
            <Skeleton className="h-4 w-1/4" />
          </li>
        ))}
      </ul>
    </div>
  );
}
